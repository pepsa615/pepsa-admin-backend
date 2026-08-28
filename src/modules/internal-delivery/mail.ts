import nodemailer from 'nodemailer';
import type { AppConfig } from '../../core/config.js';
import { AppError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

type IdentityEmailInput = {
  to: string;
  purpose: 'admin-invitation' | 'password-recovery';
  actionUrl: string;
  expiresInMinutes: number;
  requestId: string;
};

export async function sendIdentityEmail(config: AppConfig, input: IdentityEmailInput) {
  if (!config.email.configured) {
    logger.error(
      {
        event: 'IDENTITY_EMAIL_SKIPPED',
        purpose: input.purpose,
        requestId: input.requestId,
      },
      'SMTP is not configured; cannot deliver admin identity email',
    );
    throw new AppError(
      503,
      'DELIVERY_NOT_CONFIGURED',
      'SMTP is not configured for admin identity delivery',
    );
  }

  const subject =
    input.purpose === 'admin-invitation'
      ? 'You are invited to Pepsa Admin'
      : 'Reset your Pepsa Admin password';
  const intro =
    input.purpose === 'admin-invitation'
      ? 'You have been invited to Pepsa Admin.'
      : 'We received a request to reset your Pepsa Admin password.';

  const transport = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: config.email.user ? { user: config.email.user, pass: config.email.password } : undefined,
  });

  await transport.sendMail({
    from: config.email.from,
    to: input.to,
    subject,
    text: `${intro}\n\nOpen this link within ${input.expiresInMinutes} minutes:\n${input.actionUrl}\n\nIf you did not expect this message, ignore it.`,
    html: `<p>${intro}</p><p><a href="${input.actionUrl}">Continue</a></p><p>This link expires in ${input.expiresInMinutes} minutes.</p>`,
  });

  logger.info(
    {
      event: 'IDENTITY_EMAIL_SENT',
      purpose: input.purpose,
      requestId: input.requestId,
    },
    'Admin identity email sent',
  );
}
