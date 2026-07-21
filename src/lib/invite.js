// Invite code + email for new staff. The admin sends this; the code is stored
// on the staff row and confirmed at the start of the onboarding wizard.

const esc = (s = '') => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const genInviteCode = () => String(Math.floor(100000 + Math.random() * 900000));

/** Clean, centered transactional email with the confirmation code. */
export function buildInviteHtml(user, code, org = 'Bethesda Baptist Church') {
  const first = (user?.name || '').trim().split(/\s+/)[0] || 'there';
  const spaced = String(code).split('').join('&nbsp;&nbsp;');
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#ffffff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
    <tr><td align="center" style="padding:56px 20px;">
      <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="max-width:440px;width:100%;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr><td style="padding-bottom:30px;"><span style="font-size:26px;font-weight:800;color:#0B3558;letter-spacing:-1px;">pillar</span></td></tr>
        <tr><td style="font-size:22px;font-weight:700;color:#111111;padding-bottom:22px;">Set up your Pillar account</td></tr>
        <tr><td style="font-size:15px;color:#333333;line-height:1.6;padding-bottom:6px;">Hi <strong>${esc(first)}</strong>,</td></tr>
        <tr><td style="font-size:15px;color:#333333;line-height:1.6;padding-bottom:24px;">An account was created for you at <strong>${esc(org)}</strong>. Use the code below to confirm your details and finish setting up.</td></tr>
        <tr><td style="padding-bottom:24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F3F3;border-radius:8px;">
            <tr><td align="center" style="padding:28px 10px;font-size:34px;font-weight:700;letter-spacing:2px;color:#111111;">${spaced}</td></tr>
          </table>
        </td></tr>
        <tr><td style="font-size:14px;color:#555555;line-height:1.6;padding-bottom:28px;">Enter this code at the start of your account setup, then confirm your info and choose your preferences.</td></tr>
        <tr><td style="border-top:1px solid #eaeaea;padding-top:22px;font-size:12.5px;color:#888888;line-height:1.6;">If you weren’t expecting this, you can safely ignore this email. Pillar will never ask for this code by phone or text.</td></tr>
        <tr><td style="font-size:12.5px;color:#aaaaaa;padding-top:14px;">${esc(org)}</td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
}
