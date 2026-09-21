/*
 * Keys and random values for member sign-in.
 *
 * MEMBER_AUTH_KEY (Edge Function secret, 32 random bytes, base64) never leaves the functions.
 * Separate sub-keys are derived for contacts, codes and IP addresses, so the database only ever
 * holds HMACs: a copy of the database can't be brute-forced back into phone numbers or live codes.
 * Set it from the Pillar folder in your own terminal (never paste it anywhere):
 *   npx supabase secrets set MEMBER_AUTH_KEY="$(openssl rand -base64 32)"
 */

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer | Uint8Array) =>
  [...(buf instanceof Uint8Array ? buf : new Uint8Array(buf))].map((b) => b.toString(16).padStart(2, '0')).join('');

export type MemberKeys = { contact: CryptoKey; code: CryptoKey; ip: CryptoKey };

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64.trim());
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** null when the secret is missing or too short — callers then treat sign-in as switched off. */
export async function loadMemberKeys(secret: string | undefined | null): Promise<MemberKeys | null> {
  if (!secret) return null;
  let root: Uint8Array;
  try { root = decodeBase64(secret); } catch { return null; }
  if (root.length < 32) return null;
  const rootKey = await hmacKey(root);
  const derive = async (label: string) =>
    hmacKey(new Uint8Array(await crypto.subtle.sign('HMAC', rootKey, enc.encode(`bethesda-member-auth/v1/${label}`))));
  return { contact: await derive('contact'), code: await derive('code'), ip: await derive('ip') };
}

export async function macHex(key: CryptoKey, data: string): Promise<string> {
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function sha256Hex(data: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(data)));
}

/** Uniform 6-digit code: rejection sampling so no digit string is more likely than another. */
export function sixDigitCode(getRandomValues: (a: Uint32Array) => Uint32Array = (a) => crypto.getRandomValues(a)): string {
  const LIMIT = 4_294_000_000; // 2^32 − (2^32 mod 10^6)
  const u = new Uint32Array(1);
  for (;;) {
    getRandomValues(u);
    if (u[0] < LIMIT) return String(u[0] % 1_000_000).padStart(6, '0');
  }
}

/** base64url of n random bytes (tickets, grants). */
export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A record's app login address: random, unguessable, never derived from any id. */
export function randomLoginEmail(domain: string): string {
  return `m-${hex(crypto.getRandomValues(new Uint8Array(16)))}@${domain}`;
}
