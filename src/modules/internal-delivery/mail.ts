import nodemailer from 'nodemailer';
import type { AppConfig } from '../../core/config.js';
import { AppError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { wrapPepsaEmail } from './pepsa-email-layout.js';

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

  const invited = input.purpose === 'admin-invitation';
  const message = wrapPepsaEmail({
    title: invited ? 'You are invited to Pepsa Admin' : 'Reset your Pepsa Admin password',
    greeting: 'Hello,',
    preheader: invited
      ? 'Complete your Pepsa Admin invitation'
      : 'Reset your Pepsa Admin password',
    paragraphs: invited
      ? [
          'You have been invited to Pepsa Admin.',
          `This secure link expires in ${input.expiresInMinutes} minutes.`,
          'If you did not expect this invitation, you can ignore this email.',
        ]
      : [
          'We received a request to reset your Pepsa Admin password.',
          `This secure link expires in ${input.expiresInMinutes} minutes.`,
          'If you did not request this, you can ignore this email.',
        ],
    cta: {
      label: invited ? 'Accept invitation' : 'Reset password',
      url: input.actionUrl,
    },
    footerNote: 'For security, never share this link with anyone.',
    textBody: '',
  });

  const transport = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: config.email.user ? { user: config.email.user, pass: config.email.password } : undefined,
  });

  await transport.sendMail({
    from: config.email.from,
    to: input.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
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
