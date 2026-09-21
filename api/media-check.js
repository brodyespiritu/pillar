// Vercel serverless function — did a video Pillar just uploaded arrive in the church's video storage?
//
// Pillar sends videos straight from the browser to Google Cloud Storage (bucket bethesdaonline), with
// a one-hour upload form the app server signs (/api/gcs-signed-url). Unless the bucket's CORS
// settings list Pillar's address, the browser can send the file but can't read Google's reply. So
// Pillar asks here instead: this function looks at the file from the server, where CORS doesn't
// apply, and says whether it is there and how big it is (src/lib/videoUpload.js).
//
// Signed-in active staff only, and only for the exact kind of address the signer hands out — it
// can't be pointed at anything else.
import { staffCaller } from './_staff.js';

// sermons/<Date.now()>-<12 hex><.ext> — the key bethesda-admin's /api/gcs-signed-url makes
const UPLOADED = /^https:\/\/storage\.googleapis\.com\/bethesdaonline\/sermons\/\d{10,16}-[0-9a-f]{12}(\.[A-Za-z0-9]{1,8})?$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await staffCaller(req))) {
    return res.status(401).json({ error: 'Please sign in to Pillar again, then try once more.' });
  }

  let b;
  try { b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { return res.status(400).json({ error: 'Malformed request.' }); }

  const url = String(b.url || '');
  if (!UPLOADED.test(url)) return res.status(400).json({ error: 'That isn’t an address Pillar uploads videos to.' });

  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'error' });
    const length = r.headers.get('content-length');
    const size = length == null ? null : Number(length);
    return res.status(200).json({
      ok: true,
      found: r.status === 200,
      status: r.status,
      size: Number.isFinite(size) ? size : null,   // no length header means "unknown", not zero
      type: r.headers.get('content-type') || null,
    });
  } catch {
    return res.status(504).json({ error: 'Couldn’t reach the video storage. Try again in a moment.' });
  }
}
