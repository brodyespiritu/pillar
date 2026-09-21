// Who is calling a Pillar serverless function? Only a signed-in, ACTIVE staff member counts.
// Files under /api starting with "_" are not routes, so this is a shared helper, not an endpoint.
//
// Public values (the browser app ships them too); they only let a function ask Supabase who the caller is.
const SUPABASE_URL  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://dxiqhequrfdodeyqzowz.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4aXFoZXF1cmZkb2RleXF6b3d6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMDUyMTgsImV4cCI6MjA5OTc4MTIxOH0.z429W6SKsjtTwaPjkb9cMGtSrWoBJQdABukPO92aII4';

/** The staff member's id, or null. Never throws. */
export async function staffCaller(req) {
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
