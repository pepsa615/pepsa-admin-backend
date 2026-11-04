/**
 * Shared Pepsa branded HTML email shell.
 * Keep this file in sync across backends (admin, bas, vendor, order, customer, rider).
 */
export type PepsaEmailCta = { label: string; url: string };

export type PepsaEmailContent = {
  preheader?: string;
  title: string;
  greeting?: string;
  bodyHtml: string;
  cta?: PepsaEmailCta;
  footerNote?: string;
};

const BRAND = '#9D0208';
const DEFAULT_LOGO_URL = 'https://pepsabas.pepsa.co/logo.png';

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      (
        {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          "'": '&#39;',
          '"': '&quot;',
        } as Record<string, string>
      )[character] ?? character,
  );
}

function logoSrc(): string {
  const fromEnv =
    (typeof process !== 'undefined' &&
      (process.env.EMAIL_BRAND_LOGO_URL ||
        process.env.PEPSA_EMAIL_LOGO_URL ||
        process.env.PUBLIC_BRAND_LOGO_URL)) ||
    '';
  return fromEnv.trim() || DEFAULT_LOGO_URL;
}

/** Full HTML document for transactional Pepsa emails. */
export function renderPepsaEmailHtml(content: PepsaEmailContent): string {
  const logo = escapeHtml(logoSrc());
  const title = escapeHtml(content.title);
  const greeting = content.greeting
    ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(content.greeting)}</p>`
    : '';
  const preheader = content.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(content.preheader)}</div>`
    : '';
  const cta = content.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
        <tr>
          <td style="border-radius:10px;background:${BRAND};">
            <a href="${escapeHtml(content.cta.url)}"
               style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">
              ${escapeHtml(content.cta.label)}
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#94a3b8;word-break:break-all;">
        Or open: <a href="${escapeHtml(content.cta.url)}" style="color:${BRAND};">${escapeHtml(content.cta.url)}</a>
      </p>`
    : '';
  const footerNote = content.footerNote
    ? `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#94a3b8;">${escapeHtml(content.footerNote)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND} 0%,#7f0106 100%);padding:22px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <img src="${logo}" width="40" height="40" alt="Pepsa" style="display:block;border:0;border-radius:999px;background:#ffffff;" />
                  </td>
                  <td style="vertical-align:middle;padding-left:12px;">
                    <div style="font-size:18px;font-weight:800;letter-spacing:0.02em;color:#ffffff;">Pepsa</div>
                    <div style="font-size:12px;color:rgba(255,255,255,0.85);">Secure logistics payments</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a;">${title}</h1>
              ${greeting}
              <div style="font-size:15px;line-height:1.65;color:#334155;">${content.bodyHtml}</div>
              ${cta}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 24px;border-top:1px solid #e2e8f0;background:#f8fafc;">
              ${footerNote}
              <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">
                © Pepsa · This is an automated message from no-reply@pepsa.co
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function wrapPepsaEmail(options: {
  title: string;
  textBody: string;
  greeting?: string;
  preheader?: string;
  cta?: PepsaEmailCta;
  footerNote?: string;
  paragraphs?: string[];
}): { subject: string; text: string; html: string } {
  const paragraphs = options.paragraphs?.length
    ? options.paragraphs
    : options.textBody
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean);
  const bodyHtml = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 14px;">${escapeHtml(p).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`,
    )
    .join('');
  const text = [
    options.greeting,
    ...paragraphs,
    options.cta ? `${options.cta.label}: ${options.cta.url}` : '',
    options.footerNote,
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    subject: options.title,
    text,
    html: renderPepsaEmailHtml({
      title: options.title,
      greeting: options.greeting,
      preheader: options.preheader ?? options.title,
      bodyHtml,
      cta: options.cta,
      footerNote: options.footerNote,
    }),
  };
}
