// Vercel serverless function — sends email over SMTP with nodemailer.
// Runs in Node (raw TCP allowed), same-origin with the app, so email works in
// both the web app and the desktop app without a native bridge.
import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { to, cc, bcc, subject, text, html, attachments } = b;

  // Use the sender's own connected account when there is one; otherwise fall
  // back to the church-wide account configured in the environment, so staff
  // don't each have to connect a personal mailbox.
  // Declared out here so the catch below can report which server we tried.
  const host = b.host || process.env.CHURCH_SMTP_HOST;
  const user = b.user || process.env.CHURCH_SMTP_USER;
  const pass = b.pass || process.env.CHURCH_SMTP_PASS;
  const port = b.port || process.env.CHURCH_SMTP_PORT;
  const from = b.from || process.env.CHURCH_FROM || user;
  const p = Number(port) || 587;

  if (!host || !user || !pass) {
    return res.status(400).json({
      error: 'No mail account configured. Connect an account, or set CHURCH_SMTP_HOST / CHURCH_SMTP_USER / CHURCH_SMTP_PASS.',
    });
  }
  if (!to && !bcc) return res.status(400).json({ error: 'No recipients.' });

  try {
    const transporter = nodemailer.createTransport({
      host,
      port: p,
      secure: p === 465,          // 465 = implicit TLS; 587 = STARTTLS
      auth: { user, pass },
    });

    /*
     * The result matters: SMTP can ACCEPT the message and still reject some
     * recipients, in which case sendMail resolves normally. Discarding `info`
     * is how a whole batch went missing while the app logged it as delivered.
     */
    const info = await transporter.sendMail({
      from: from || user,
      to: to || from || user,      // a message needs a To: header even when everyone is BCC'd
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject: subject || '',
      text: text || ' ',
      html: html || undefined,
      attachments: (attachments || []).map(a => ({
        filename: a.filename,
        content: a.content,       // base64 string
        encoding: 'base64',
        contentType: a.mime || 'application/octet-stream',
      })),
    });

    const accepted = info?.accepted || [];
    const rejected = info?.rejected || [];
    if (rejected.length && !accepted.length) {
      return res.status(400).json({ error: `All recipients rejected: ${rejected.join(', ')}`,
        via: `${host}:${p}`, accepted, rejected });
    }
    return res.status(200).json({ ok: true, via: `${host}:${p}`,
      accepted, rejected, response: info?.response });
  } catch (e) {
    // Echo the server + username we tried (never the password) — otherwise an
    // auth failure gives no way to tell which account is actually in use.
    return res.status(400).json({ error: String(e?.message || e), via: `${host}:${p}`, user });
  }
}
