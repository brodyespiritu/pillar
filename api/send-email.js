// Vercel serverless function — sends email over SMTP with nodemailer.
// Runs in Node (raw TCP allowed), same-origin with the app, so email works in
// both the web app and the desktop app without a native bridge.
import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { host, port, user, pass, from, to, cc, subject, text, html, attachments } = b;
    if (!host || !user || !pass) return res.status(400).json({ error: 'Missing SMTP credentials.' });
    if (!to) return res.status(400).json({ error: 'No recipients.' });

    const p = Number(port) || 587;
    const transporter = nodemailer.createTransport({
      host,
      port: p,
      secure: p === 465,          // 465 = implicit TLS; 587 = STARTTLS
      auth: { user, pass },
    });

    await transporter.sendMail({
      from: from || user,
      to,
      cc: cc || undefined,
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

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(400).json({ error: String(e?.message || e) });
  }
}
