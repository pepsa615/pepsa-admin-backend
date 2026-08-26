import type { AppConfig } from '../../core/config.js';
import {
  createTotpSecret,
  decrypt,
  encrypt,
  randomToken,
  sha256,
  verifyPassword,
  verifyTotp,
  hashPassword,
} from '../../core/crypto.js';
import type { Database } from '../../core/database.js';
import { AppError } from '../../core/errors.js';
import { deliverIdentityToken } from '../../core/identity-delivery.js';
import type { AuditService } from '../audit/service.js';

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  async login(input: {
    email: string;
    password: string;
    requestId: string;
    ipHash?: string;
    userAgent?: string;
  }) {
    const email = input.email.trim().toLowerCase();
    const user = await this.db.adminUser.findUnique({ where: { email } });
    const passwordValid = user ? await verifyPassword(input.password, user.passwordHash) : false;
    if (!user || !passwordValid || !['ACTIVE', 'INVITED'].includes(user.status)) {
      if (user) {
        const failures = user.failedLogins + 1;
        await this.db.adminUser.update({
          where: { id: user.id },
          data: {
            failedLogins: failures,
            lockedUntil: failures >= 5 ? new Date(Date.now() + 15 * 60_000) : undefined,
          },
        });
      }
      await this.audit.record({
        actorId: user?.id,
        action: 'auth.login',
        outcome: 'DENIED',
        requestId: input.requestId,
        ipHash: input.ipHash,
      });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (user.lockedUntil && user.lockedUntil > new Date())
      throw new AppError(429, 'ACCOUNT_LOCKED', 'Account is temporarily locked');

    const sessionToken = randomToken();
    const csrfToken = randomToken(24);
    const session = await this.db.adminSession.create({
      data: {
        adminUserId: user.id,
        tokenHash: sha256(`${sessionToken}:${this.config.session.secret}`),
        csrfHash: sha256(csrfToken),
        ipHash: input.ipHash,
        userAgent: input.userAgent?.slice(0, 500),
        expiresAt: new Date(Date.now() + this.config.session.ttlMs),
      },
    });
    let secret: string | undefined;
    if (user.mfaStatus === 'PENDING') {
      secret = createTotpSecret();
      await this.db.adminUser.update({
        where: { id: user.id },
        data: { mfaSecret: encrypt(secret, this.config.mfaEncryptionKey) },
      });
    }
    return {
      sessionToken,
      sessionId: session.id,
      requiresMfa: true,
      enrollment: secret
        ? {
            secret,
            uri: `otpauth://totp/${encodeURIComponent(`Pepsa Admin:${email}`)}?secret=${secret}&issuer=Pepsa%20Admin&digits=6&period=30`,
          }
        : undefined,
    };
  }

  async requestPasswordReset(input: { email: string; requestId: string }) {
    const user = await this.db.adminUser.findUnique({
      where: { email: input.email.trim().toLowerCase() },
    });
    if (!user || user.status === 'DEACTIVATED') return {};
    const token = randomToken(32);
    await this.db.$transaction([
      this.db.passwordResetToken.updateMany({
        where: { adminUserId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.db.passwordResetToken.create({
        data: {
          adminUserId: user.id,
          tokenHash: sha256(`${token}:${this.config.session.secret}`),
          expiresAt: new Date(Date.now() + 15 * 60_000),
        },
      }),
    ]);
    await deliverIdentityToken(this.config.recoveryDelivery, {
      email: user.email,
      token,
      purpose: 'password-recovery',
      expiresInMinutes: 15,
      requestId: input.requestId,
      failureCode: 'RECOVERY_DELIVERY_FAILED',
      failureMessage: 'Recovery delivery failed',
    });
    await this.audit.record({
      actorId: user.id,
      action: 'auth.password_reset.requested',
      outcome: 'SUCCESS',
      requestId: input.requestId,
    });
    return this.config.environment === 'production' ? {} : { developmentToken: token };
  }

  async resetPassword(input: {
    token: string;
    password: string;
    mfaCode: string;
    requestId: string;
  }) {
    const reset = await this.db.passwordResetToken.findUnique({
      where: { tokenHash: sha256(`${input.token}:${this.config.session.secret}`) },
      include: { user: true },
    });
    if (!reset || reset.consumedAt || reset.expiresAt <= new Date())
      throw new AppError(401, 'RESET_TOKEN_INVALID', 'Recovery token is invalid or expired');
    if (
      reset.user.mfaStatus === 'ENABLED' &&
      (!reset.user.mfaSecret ||
        !verifyTotp(decrypt(reset.user.mfaSecret, this.config.mfaEncryptionKey), input.mfaCode))
    )
      throw new AppError(401, 'INVALID_MFA_CODE', 'Invalid verification code');
    await this.db.$transaction([
      this.db.adminUser.update({
        where: { id: reset.adminUserId },
        data: {
          passwordHash: await hashPassword(input.password),
          failedLogins: 0,
          lockedUntil: null,
        },
      }),
      this.db.passwordResetToken.update({
        where: { id: reset.id },
        data: { consumedAt: new Date() },
      }),
      this.db.adminSession.updateMany({
        where: { adminUserId: reset.adminUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      actorId: reset.adminUserId,
      action: 'auth.password_reset.completed',
      outcome: 'SUCCESS',
      requestId: input.requestId,
    });
  }

  async verifyMfa(input: { sessionToken: string; code: string; requestId: string }) {
    const session = await this.db.adminSession.findUnique({
      where: { tokenHash: sha256(`${input.sessionToken}:${this.config.session.secret}`) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date())
      throw new AppError(401, 'SESSION_EXPIRED', 'Session expired');
    if (
      !session.user.mfaSecret ||
      !verifyTotp(decrypt(session.user.mfaSecret, this.config.mfaEncryptionKey), input.code)
    ) {
      await this.audit.record({
        actorId: session.adminUserId,
        action: 'auth.mfa.verify',
        outcome: 'DENIED',
        requestId: input.requestId,
      });
      throw new AppError(401, 'INVALID_MFA_CODE', 'Invalid verification code');
    }
    const csrfToken = randomToken(24);
    const recoveryCodes =
      session.user.mfaStatus === 'PENDING'
        ? Array.from({ length: 8 }, () => {
            const raw = randomToken(9)
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, '')
              .padEnd(12, 'X');
            return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
          })
        : [];
    await this.db.$transaction([
      this.db.adminSession.update({
        where: { id: session.id },
        data: { mfaVerifiedAt: new Date(), stepUpAt: new Date(), csrfHash: sha256(csrfToken) },
      }),
      this.db.adminUser.update({
        where: { id: session.adminUserId },
        data: {
          mfaStatus: 'ENABLED',
          status: 'ACTIVE',
          failedLogins: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
        },
      }),
      ...(recoveryCodes.length
        ? [
            this.db.adminRecoveryCode.deleteMany({ where: { adminUserId: session.adminUserId } }),
            this.db.adminRecoveryCode.createMany({
              data: recoveryCodes.map((code) => ({
                adminUserId: session.adminUserId,
                codeHash: sha256(`${code}:${this.config.session.secret}`),
              })),
            }),
          ]
        : []),
    ]);
    await this.audit.record({
      actorId: session.adminUserId,
      action: 'auth.login',
      outcome: 'SUCCESS',
      requestId: input.requestId,
    });
    return { csrfToken, recoveryCodes };
  }

  async recoverMfa(input: { sessionToken: string; code: string; requestId: string }) {
    const session = await this.db.adminSession.findUnique({
      where: {
        tokenHash: sha256(`${input.sessionToken}:${this.config.session.secret}`),
      },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date())
      throw new AppError(401, 'SESSION_EXPIRED', 'Session expired');
    const normalized = input.code.trim().toUpperCase();
    const recovery = await this.db.adminRecoveryCode.findUnique({
      where: { codeHash: sha256(`${normalized}:${this.config.session.secret}`) },
    });
    if (!recovery || recovery.adminUserId !== session.adminUserId || recovery.usedAt) {
      await this.audit.record({
        actorId: session.adminUserId,
        action: 'auth.mfa.recovery',
        outcome: 'DENIED',
        requestId: input.requestId,
      });
      throw new AppError(401, 'INVALID_RECOVERY_CODE', 'Recovery code is invalid or already used');
    }
    const csrfToken = randomToken(24);
    await this.db.$transaction([
      this.db.adminRecoveryCode.update({
        where: { id: recovery.id },
        data: { usedAt: new Date() },
      }),
      this.db.adminSession.update({
        where: { id: session.id },
        data: { mfaVerifiedAt: new Date(), stepUpAt: new Date(), csrfHash: sha256(csrfToken) },
      }),
    ]);
    await this.audit.record({
      actorId: session.adminUserId,
      action: 'auth.mfa.recovery',
      outcome: 'SUCCESS',
      requestId: input.requestId,
    });
    return { csrfToken, recoveryCodes: [] as string[] };
  }

  async logout(sessionId: string, actorId: string, requestId: string) {
    await this.db.adminSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({ actorId, action: 'auth.logout', outcome: 'SUCCESS', requestId });
  }

  async stepUp(input: { sessionId: string; actorId: string; code: string; requestId: string }) {
    const user = await this.db.adminUser.findUnique({ where: { id: input.actorId } });
    if (
      !user?.mfaSecret ||
      !verifyTotp(decrypt(user.mfaSecret, this.config.mfaEncryptionKey), input.code)
    ) {
      await this.audit.record({
        actorId: input.actorId,
        action: 'auth.step_up',
        outcome: 'DENIED',
        requestId: input.requestId,
      });
      throw new AppError(401, 'INVALID_MFA_CODE', 'Invalid verification code');
    }
    await this.db.adminSession.update({
      where: { id: input.sessionId },
      data: { stepUpAt: new Date() },
    });
    await this.audit.record({
      actorId: input.actorId,
      action: 'auth.step_up',
      outcome: 'SUCCESS',
      requestId: input.requestId,
    });
  }

  async issueCsrf(sessionId: string) {
    const csrfToken = randomToken(24);
    await this.db.adminSession.update({
      where: { id: sessionId },
      data: { csrfHash: sha256(csrfToken) },
    });
    return csrfToken;
  }
}
