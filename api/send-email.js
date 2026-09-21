// Vercel serverless function — sends email over SMTP with nodemailer.
// Runs in Node (raw TCP allowed), same-origin with the app, so email works in
// both the web app and the desktop app without a native bridge.
import nodemailer from 'nodemailer';

// Pillar's Supabase project. Public values (the browser app ships them too); they only let this
// function ask Supabase who the caller is.
const SUPABASE_URL  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://dxiqhequrfdodeyqzowz.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4aXFoZXF1cmZkb2RleXF6b3d6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMDUyMTgsImV4cCI6MjA5OTc4MTIxOH0.z429W6SKsjtTwaPjkb9cMGtSrWoBJQdABukPO92aII4';

// Only signed-in, active Pillar staff may send. Returns the staff id, or null.
async function staffCaller(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return null;
  const headers = { apikey: SUPABASE_ANON, Authorization: `Bearer ${m[1]}` };
  try {
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers });
    if (!u.ok) return null;
    const { id } = await u.json();
    if (!id) return null;
    const s = await fetch(`${SUPABASE_URL}/rest/v1/staff?select=id,active&id=eq.${encodeURIComponent(id)}`, { headers });
    if (!s.ok) return null;
    const rows = await s.json();
    return Array.isArray(rows) && rows[0] && rows[0].active !== false ? id : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Without this check anyone on the internet could send mail as the church — or point `host`
  // at their own server and receive the church mailbox's username and password.
  if (!(await staffCaller(req))) {
    return res.status(401).json({ error: 'Please sign in to Pillar again, then resend. (If this keeps happening, reload Pillar.)' });
  }

  let b;
  try { b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { return res.status(400).json({ error: 'Malformed request.' }); }
  const { to, cc, bcc, subject, text, html, attachments } = b;

  // Either the sender's OWN connected account (all of host, user and password come from the
  // request), or the church-wide account from the environment (all of it). Never a mix: a
  // request-supplied server must never be handed the church account's credentials.
  const own = Boolean(b.host || b.user || b.pass);
  if (own && !(b.host && b.user && b.pass)) {
    return res.status(400).json({ error: 'That mail account is missing its server, address or app password. Reconnect it in Pillar.' });
  }
  const host = own ? b.host : process.env.CHURCH_SMTP_HOST;
  const user = own ? b.user : process.env.CHURCH_SMTP_USER;
  const pass = own ? b.pass : process.env.CHURCH_SMTP_PASS;
  const port = own ? b.port : process.env.CHURCH_SMTP_PORT;
  const from = own ? (b.from || user) : (process.env.CHURCH_FROM || user);
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
      return res.status(400).json({ error: `All recipients rejected: ${rejected.join(', ')}`, accepted, rejected });
    }
    return res.status(200).json({ ok: true, accepted, rejected });
  } catch (e) {
    // Say which kind of account failed, never the server or username.
    const which = own ? 'your connected mail account' : "the church's mail account";
    return res.status(400).json({ error: `Couldn't send with ${which}: ${String(e?.message || e)}` });
  }
}
