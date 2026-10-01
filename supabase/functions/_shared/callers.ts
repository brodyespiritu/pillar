/*
 * Who is allowed to make Pillar send a text.
 *
 * send-prospect-sms texts anyone, from the church's number, on the church's
 * bill. It used to check nothing: deployed with verify_jwt off and no check of
 * its own, its public URL sent whatever any stranger posted to it.
 *
 * Exactly two kinds of caller are legitimate:
 *
 *   SYSTEM  Pillar's own edge functions — the care digest, deacon alerts,
 *           reminders, poll and dinner acknowledgements, care-intake replies.
 *           Every one of them sends the service-role key, read from the same
 *           environment variable, so it is matched exactly, in constant time.
 *
 *   STAFF   Someone signed in to the app. Their session token is VERIFIED with
 *           the auth server, not merely decoded, and must belong to an active
 *           row in staff. There are more sign-in accounts than staff, so being
 *           signed in is not enough on its own.
 *
 * Deliberately refused:
 *   - The anon key. It ships in the public browser bundle and it is a validly
 *     signed JWT — which is exactly why switching verify_jwt on could never have
 *     fixed this. The gateway would have waved it through.
 *   - A token that merely CLAIMS role "service_role". A JWT's payload is plain
 *     base64 that anyone can write; only a verified signature means anything.
 *   - The cron secret. Nothing that calls this needs it.
 *   - A signed-in account with no staff row, or an inactive one.
 */

const enc = new TextEncoder();

/* Constant-time, so a wrong key cannot be found a character at a time. */
export function timingSafeEqual(a: string, b: string) {
  const x = enc.encode(a), y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/* The bearer token on a request, or '' when there is none. */
export function bearerToken(req: Request) {
  return (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

/*
 * Pillar's own machinery and nothing else — for functions no person calls. The
 * service-role key or the cron secret, each matched EXACTLY, in constant time.
 *
 * It never decodes a token to read the role it claims. cares-recap and
 * send-scheduled-sms both used to accept anything whose payload said
 * "service_role", having only base64-decoded it. Nothing checked a signature —
 * both run with verify_jwt off — so a token typed by hand passed as the system,
 * and cares-recap would return the full care digest (names, hospitals, medical
 * notes) to anyone who asked it for a dry run.
 *
 * Says WHICH secret matched, so a function can grant the cron less than the
 * service role: the scheduler may trigger a send but must not read care data.
 */
export function systemCaller(
  req: Request,
  keys: { serviceRole?: string; cronSecret?: string },
): 'service' | 'cron' | null {
  const token = bearerToken(req);
  if (!token) return null;
  if (keys.serviceRole && timingSafeEqual(token, keys.serviceRole)) return 'service';
  if (keys.cronSecret && timingSafeEqual(token, keys.cronSecret)) return 'cron';
  return null;
}

export type Caller =
  | { ok: true; kind: 'system' }
  | { ok: true; kind: 'staff'; staffId: string }
  | { ok: false; status: 401 | 403; error: string };

/*
 * Staff with Cares access, for functions that show or act on care details:
 * an admin, or someone given Cares view ('view') or edit ('edit'). The same
 * rule as can_read_cares() / can_edit_cares() in care-ai-writer.sql. A
 * member-app login is never staff. `supabase` must be a service-role client.
 */
export async function authorizeCares(
  req: Request, supabase: any, need: 'view' | 'edit',
): Promise<{ ok: true; staffId: string; name: string } | { ok: false; status: 401 | 403; error: string }> {
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, error: 'Sign in first.' };
  const { data, error } = await supabase.auth.getUser(token);
  const user = data?.user;
  if (error || !user?.id) return { ok: false, status: 401, error: 'Your session has expired. Sign in again.' };
  if (user.app_metadata?.bbc_member_id) return { ok: false, status: 403, error: 'This is for church staff.' };

  const { data: staff, error: staffErr } = await supabase
    .from('staff').select('id, name, role, active, permissions').eq('id', user.id).maybeSingle();
  if (staffErr) return { ok: false, status: 403, error: 'Could not confirm you are staff. Try again in a moment.' };
  if (!staff || staff.active === false) return { ok: false, status: 403, error: 'Only active staff can do this.' };

  const admin = /admin/i.test(String(staff.role || ''));
  const cares = String(staff.permissions?.cares || 'none');
  const allowed = admin || (need === 'view' ? ['view', 'edit'].includes(cares) : cares === 'edit');
  if (!allowed) {
    return { ok: false, status: 403,
      error: need === 'edit' ? 'You need Cares edit access for this.' : 'You need Cares access for this.' };
  }
  return { ok: true, staffId: staff.id, name: staff.name || '' };
}

/*
 * `supabase` must be a service-role client: it reads staff past row-level
 * security, and verifies the caller's token with the auth server.
 */
export async function authorizeSender(req: Request, supabase: any, serviceRole: string): Promise<Caller> {
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, error: 'Sign in to send texts.' };

  if (serviceRole && timingSafeEqual(token, serviceRole)) return { ok: true, kind: 'system' };

  /* getUser(token) asks the auth server to check the signature, expiry and
     revocation. The anon key and any forged token fail here. */
  const { data, error } = await supabase.auth.getUser(token);
  const user = data?.user;
  if (error || !user?.id) {
    return { ok: false, status: 401, error: 'Your session has expired. Sign in again to send texts.' };
  }

  const { data: staff, error: staffErr } = await supabase
    .from('staff').select('id, active').eq('id', user.id).maybeSingle();
  if (staffErr) {
    /* Refuse rather than guess. A failed read must never become permission to
       text the congregation. */
    console.error('staff lookup failed; refusing to send:', staffErr.message);
    return { ok: false, status: 403, error: 'Could not confirm you are staff. Try again in a moment.' };
  }
  if (!staff || staff.active === false) {
    return { ok: false, status: 403, error: 'Only active staff can send texts.' };
  }
  return { ok: true, kind: 'staff', staffId: staff.id };
}
