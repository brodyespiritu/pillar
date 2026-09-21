// Vercel serverless function — Pillar's writes to the mobile app's admin server.
//
// The app server (bethesda-admin) requires a key on every write. That key must never reach a
// browser: anything the web app ships is public, and the key edits what the whole congregation
// sees. So it lives here, in the APP_API_KEY environment variable, and staff never type it:
// Pillar sends { path, method, body } with the signed-in staff member's Supabase token, this
// function checks that token against the staff table, then forwards the write with the key.
//
// Set it once: Vercel → the Pillar project → Settings → Environment Variables → APP_API_KEY
// (the same value as API_KEY on the Render service), then redeploy.
import { staffCaller } from './_staff.js';

const APP_API_BASE = process.env.APP_API_BASE || 'https://bethesda-admin.onrender.com';

// Only the app-content endpoints Pillar actually writes, and only a plain id after them.
const ALLOWED = new RegExp(
  '^/api/(livestream|sermons|announcements|events|media-layout|custom-blocks|resources'
  + '|live-card-templates|live-card|settings|page-blocks|blocks|ministry-cards|gcs-signed-url'
  + '|notifications/send)(/[A-Za-z0-9._~-]{1,64})?$',
);
const METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Render's free tier sleeps: the first write after idle can take ~30-60s to wake.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await staffCaller(req))) {
    return res.status(401).json({ error: 'Please sign in to Pillar again, then try once more. (If this keeps happening, reload Pillar.)' });
  }

  // trimmed: a value pasted with a stray space or newline would never match the server's
  const raw = process.env.APP_API_KEY || '';
  const key = raw.trim();
  if (!key) {
    return res.status(503).json({
      error: 'Pillar\'s server has no app key yet. Add APP_API_KEY (the Render service\'s API_KEY) in Vercel → Settings → Environment Variables, then redeploy.',
    });
  }

  let b;
  try { b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { return res.status(400).json({ error: 'Malformed request.' }); }

  // { check: true } — is the key Pillar holds the one the app server wants? The probe is a write to a
  // route that doesn't exist: refused (401) means the key is wrong, "not found" (404) means it's right.
  if (b.check) {
    let probe = null;
    try {
      const r = await fetch(`${APP_API_BASE}/api/sermons/__pillar-key-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, Authorization: `Bearer ${key}` },
        body: '{}',
      });
      probe = r.status;
    } catch { /* the server didn't answer */ }
    return res.status(200).json({
      ok: true,
      check: {
        keyLength: key.length,               // never the key itself
        hadWhitespace: raw !== key,
        upstream: probe,
        accepted: probe !== null && probe !== 401 && probe !== 403,
      },
    });
  }

  const path   = String(b.path || '');
  const method = String(b.method || '').toUpperCase();
  if (!METHODS.has(method))  return res.status(400).json({ error: 'Unsupported method.' });
  if (!ALLOWED.test(path))   return res.status(400).json({ error: `That app endpoint can't be written through Pillar: ${path}` });

  try {
    const upstream = await fetch(`${APP_API_BASE}${path}`, {
      method,
      headers: {
        ...(b.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        // the server takes either scheme; both carry the same key
        'x-api-key': key,
        Authorization: `Bearer ${key}`,
      },
      body: b.body === undefined ? undefined : JSON.stringify(b.body),
    });
    const text = await upstream.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }

    if (upstream.status === 401 || upstream.status === 403) {
      // the key reached the server and was refused — say so without repeating it
      return res.status(502).json({ error: 'The app server refused Pillar\'s key. Check APP_API_KEY in Vercel against API_KEY on Render.' });
    }
    if (!upstream.ok) {
      const msg = (data && (data.error || data.message)) || `The app server refused this change (${upstream.status}).`;
      return res.status(upstream.status).json({ error: String(msg).slice(0, 300) });
    }
    return res.status(200).json({ ok: true, data });
  } catch {
    return res.status(504).json({ error: 'The app server didn\'t answer. It may be waking up — try again in a moment.' });
  }
}
