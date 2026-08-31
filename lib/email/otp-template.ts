/**
 * The sign-in code email.
 *
 * Sent bilingually (English + 简体中文) in one message rather than picking a
 * language: sign-in happens before we know who the user is, so there is no
 * stored preference to read yet, and a Zhejiang plant manager and a Lagos
 * plant owner may both belong to the same customer account.
 *
 * A plain-text alternative is always included — Chinese corporate mail hosts
 * (QQ, 163, 126) score HTML-only mail more harshly, and some factory mail
 * clients render text only.
 */

export const OTP_LENGTH = 6;
/** Codes are short, so they must be short-lived. */
export const OTP_TTL_MINUTES = 10;

export function otpSubject(code: string): string {
  // Leading code serves the common case: reading it off a phone notification
  // without opening the mail at all.
  return `${code} — ZemaInspect sign-in code / 登录验证码`;
}

export function otpText(code: string): string {
  return [
    `Your ZemaInspect sign-in code is: ${code}`,
    ``,
    `It expires in ${OTP_TTL_MINUTES} minutes and can be used once.`,
    `If you did not request it, you can ignore this email.`,
    ``,
    `————————`,
    ``,
    `您的 ZemaInspect 登录验证码是：${code}`,
    ``,
    `验证码 ${OTP_TTL_MINUTES} 分钟内有效，仅可使用一次。`,
    `如果这不是您本人的操作，请忽略此邮件。`,
    ``,
    `ZemaInspect · Zema AI Labs`,
  ].join("\n");
}

export function otpHtml(code: string): string {
  // Table-based with inline styles: Outlook and Chinese webmail strip <style>
  // blocks and handle flex/grid inconsistently.
  const spaced = code.split("").join("&nbsp;&nbsp;");
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td style="font-size:15px;font-weight:600;color:#0f172a;padding-bottom:4px;">ZemaInspect</td></tr>
        <tr><td style="font-size:13px;color:#64748b;padding-bottom:24px;">See every defect. Speak every language.</td></tr>

        <tr><td style="font-size:14px;color:#0f172a;padding-bottom:12px;">Your sign-in code</td></tr>
        <tr><td align="center" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px;font-size:30px;font-weight:700;letter-spacing:2px;color:#0f172a;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${spaced}</td></tr>
        <tr><td style="font-size:12px;color:#64748b;padding-top:12px;padding-bottom:22px;">Expires in ${OTP_TTL_MINUTES} minutes. Can be used once. If you didn't request it, ignore this email.</td></tr>

        <tr><td style="border-top:1px solid #e2e8f0;padding-top:22px;font-size:14px;color:#0f172a;padding-bottom:8px;">您的登录验证码</td></tr>
        <tr><td style="font-size:12px;color:#64748b;padding-bottom:20px;">验证码 ${OTP_TTL_MINUTES} 分钟内有效，仅可使用一次。如果这不是您本人的操作，请忽略此邮件。</td></tr>

        <tr><td style="font-size:11px;color:#94a3b8;">ZemaInspect · Zema AI Labs</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
