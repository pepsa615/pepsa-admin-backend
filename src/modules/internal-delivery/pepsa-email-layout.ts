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
const LOGO_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACkAAAAoCAYAAABjPNNTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAVmSURBVHgBxVhPTFxFGP9mFsvT0LBConjprpomNSZ01wu9lIIxaTzwT5N6sUGsbWI8tJjYSxsBk15s0kKtB23iltITl0JIGtHG7sJBPBigCaaKxt0mTfEgLimJr8DO+H2z7PYBM2/erqC/5OXtvpk37zffn998MwzKRALC4TVwY5yzNpAiCsBiwGQY7+F8D5llkqcliLRgkJJCJE/A6gyUAQYl4go4TYoYiHceEwqMNAfZ7wo2+j646aAvBSaZACcqGSTwaoJtAAfoBeEMdEE2a+sbiGSCV54UNGjplrMhLQR0HQc36dfJlyTFnWTuje2ynglk1S7h9pnaQ6YGcq/ga9/jNGKww5AATR0sFB6VuXFdu5ZkniDcxp9R+I8ggR0wEdW6+yvm3C7FxVWRCETaWqAmVg+7wmG8qmE5nYHFmTvwIDUBi7N3IDhk9zHxqN+XZII7PfkksaPu0EGI95yF5w41+vYjwtOfnIP5wSEIAkymZm8ybSC57ubfIQCIXPzjM1AKiOQPH56GFbvqpLlw4gV54t4W0kEIgHIIEvZ2HoXXvxtXIWFBdI27pwp/iolDKwnjdjfv7XwbGi6ch3LxVN2zEHqyEu6Pf+vbj4GMdcjdX4yC6xZJtrEnLjIG+8CC124MGy1Bbrz/9TewdPdnJOIY+z3T0KASajlzD3xoOjm2+seYzE0pd1MsMibbwQKyImWyDnMDl2H4xZfg1ptvqWv4hX0w1X3aZ6yjYENIUo2wHpMi5C83VdGIyuQ9ra3a9nxCfLQlIX669BlM953TvhNp04/lBckgrXqKpBR5xiZQkqxkl2B3VG/FzOiY8d05JKoDaSnBZtHVkNuez25G9aAeZEXSQRJkEmsdFlKTptfV5Pzw8skPfNu5ZDFFklHBakCktUUFeWHmeiJm3auzCD0lF4WSEVhQc0oa8MGe9hblzqqIvtvi7KzxXfJCY+JLbdtCckLdMyNjULt/v3EMtGKEgwWV1WG1rJksufLXVneSdeI9Z6D9xymjGvxy7bq609hVhlgnSMbCFWDBrqerVVyZNO9hJqOI1DUdVBapa2rEe73vmETs1/V1fGUpi2P797eSVER94pGqnyCa5yV489XDxf80QXpmgpS4jndZNkQPMHZqY+aZBliHiyCFIILLmcekatD6f1pKuUJMpo0DY01oy1AbKPtJ1DcTJNTG69U3jGBsVrkby/cUM1Th89eGIB49C6WA3EcXWYiUYSE1oe1Hyyx5ajPxDRC5ZEWeLCSRaaeuDyXN3KXLKOh6LSMrzQ9ez1fgaBHfD3pAGU0l383mw779VoHPKJI8544I7hhrSRXYGpJUVFDFHaCI3YKGC5/C/NUh30lh0iTpEEHFZBcAHomgNQOikKG6oiIQwYvnlYdogn5AToN0L4p5TkIflEDQFGd+IBeryry6GibfPeHfGaXnGLhXN5CkjU8Qa95644gqNI78djewPhZWICJ4D5dBK8E8yaLRNoj5msx1h1ho2vQe1Y2kdYWLSrgYfpwShtZiWn0K7ier0QpEE6IVaG7gcxh95UCw8PBYkbBlS3uFO71o3p7Nz/NyMakNdNLRGiRC9Wbl+ur0CGPuIYbGQsn7blQMAc97T90CHw6Qy8pJklKBe/6+48Lt9T7TVkFMuh1kcu+z/4sgQUuSJIlLaN5MdCeBZ0EDOoIEYz1JhQeXbhwVdQR2GGTB98Tfp0ztgQ5RTcn0r4GeEtJ+iGqtzAnkBo4Zh4XIIGwHpMyS9bh04jaChJIP9mlPlMPjGCZlG1YmpR1Pk+UYDFYIpz/IWXnZJL3Inx+xdrQM7qRkmDHPrhOthcNn8QtJISTu1thMEKvp8A9UOFuThFOHIgAAAABJRU5ErkJggg==';base64,iVBORw0KGgoAAAANSUhEUgAAACkAAAAoCAYAAABjPNNTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAVmSURBVHgBxVhPTFxFGP9mFsvT0LBConjprpomNSZ01wu9lIIxaTzwT5N6sUGsbWI8tJjYSxsBk15s0kKtB23iltITl0JIGtHG7sJBPBigCaaKxt0mTfEgLimJr8DO+H2z7PYBM2/erqC/5OXtvpk37zffn998MwzKRALC4TVwY5yzNpAiCsBiwGQY7+F8D5llkqcliLRgkJJCJE/A6gyUAQYl4go4TYoYiHceEwqMNAfZ7wo2+j646aAvBSaZACcqGSTwaoJtAAfoBeEMdEE2a+sbiGSCV54UNGjplrMhLQR0HQc36dfJlyTFnWTuje2ynglk1S7h9pnaQ6YGcq/ga9/jNGKww5AATR0sFB6VuXFdu5ZkniDcxp9R+I8ggR0wEdW6+yvm3C7FxVWRCETaWqAmVg+7wmG8qmE5nYHFmTvwIDUBi7N3IDhk9zHxqN+XZII7PfkksaPu0EGI95yF5w41+vYjwtOfnIP5wSEIAkymZm8ybSC57ubfIQCIXPzjM1AKiOQPH56GFbvqpLlw4gV54t4W0kEIgHIIEvZ2HoXXvxtXIWFBdI27pwp/iolDKwnjdjfv7XwbGi6ch3LxVN2zEHqyEu6Pf+vbj4GMdcjdX4yC6xZJtrEnLjIG+8CC124MGy1Bbrz/9TewdPdnJOIY+z3T0KASajlzD3xoOjm2+seYzE0pd1MsMibbwQKyImWyDnMDl2H4xZfg1ptvqWv4hX0w1X3aZ6yjYENIUo2wHpMi5C83VdGIyuQ9ra3a9nxCfLQlIX669BlM953TvhNp04/lBckgrXqKpBR5xiZQkqxkl2B3VG/FzOiY8d05JKoDaSnBZtHVkNuez25G9aAeZEXSQRJkEmsdFlKTptfV5Pzw8skPfNu5ZDFFklHBakCktUUFeWHmeiJm3auzCD0lF4WSEVhQc0oa8MGe9hblzqqIvtvi7KzxXfJCY+JLbdtCckLdMyNjULt/v3EMtGKEgwWV1WG1rJksufLXVneSdeI9Z6D9xymjGvxy7bq609hVhlgnSMbCFWDBrqerVVyZNO9hJqOI1DUdVBapa2rEe73vmETs1/V1fGUpi2P797eSVER94pGqnyCa5yV489XDxf80QXpmgpS4jndZNkQPMHZqY+aZBliHiyCFIILLmcekatD6f1pKuUJMpo0DY01oy1AbKPtJ1DcTJNTG69U3jGBsVrkby/cUM1Th89eGIB49C6WA3EcXWYiUYSE1oe1Hyyx5ajPxDRC5ZEWeLCSRaaeuDyXN3KXLKOh6LSMrzQ9ez1fgaBHfD3pAGU0l383mw779VoHPKJI8544I7hhrSRXYGpJUVFDFHaCI3YKGC5/C/NUh30lh0iTpEEHFZBcAHomgNQOikKG6oiIQwYvnlYdogn5AToN0L4p5TkIflEDQFGd+IBeryry6GibfPeHfGaXnGLhXN5CkjU8Qa95644gqNI78djewPhZWICJ4D5dBK8E8yaLRNoj5msx1h1ho2vQe1Y2kdYWLSrgYfpwShtZiWn0K7ier0QpEE6IVaG7gcxh95UCw8PBYkbBlS3uFO71o3p7Nz/NyMakNdNLRGiRC9Wbl+ur0CGPuIYbGQsn7blQMAc97T90CHw6Qy8pJklKBe/6+48Lt9T7TVkFMuh1kcu+z/4sgQUuSJIlLaN5MdCeBZ0EDOoIEYz1JhQeXbhwVdQR2GGTB98Tfp0ztgQ5RTcn0r4GeEtJ+iGqtzAnkBo4Zh4XIIGwHpMyS9bh04jaChJIP9mlPlMPjGCZlG1YmpR1Pk+UYDFYIpz/IWXnZJL3Inx+xdrQM7qRkmDHPrhOthcNn8QtJISTu1thMEKvp8A9UOFuThFOHIgAAAABJRU5ErkJggg==;

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
  return fromEnv.trim() || LOGO_DATA_URI;
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
    : options.textBody.split(/\n+/).map((p) => p.trim()).filter(Boolean);
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
