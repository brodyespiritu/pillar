/*
 * Web Push, from scratch.
 *
 * Sending a push is two separate pieces of cryptography and neither is
 * optional:
 *
 *   1. VAPID — an ES256 JWT identifying us to the push service, so Apple and
 *      Google will accept the request at all.
 *   2. aes128gcm — the payload itself, encrypted to a key only that one browser
 *      holds (RFC 8291). The push service relays it and cannot read it.
 *
 * Written against Web Crypto rather than a library so the same file runs
 * unchanged in Deno on the edge and in Node for the tests, and so there is no
 * dependency between us and the one part of this that must not silently break.
 */

const enc = new TextEncoder();

const b64u = (b: ArrayBuffer | Uint8Array): string => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const unb64u = (s: string): Uint8Array => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/* HKDF, the one-step form these two RFCs use everywhere. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8);
  return new Uint8Array(bits);
}

/* ── VAPID ───────────────────────────────────────────────
 * The private key arrives as the raw 32-byte scalar, which Web Crypto will not
 * import on its own — it has to be dressed as a JWK alongside its public point.
 */
async function vapidKey(privateRaw: Uint8Array, publicRaw: Uint8Array) {
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC', crv: 'P-256', ext: true,
      d: b64u(privateRaw),
      x: b64u(publicRaw.slice(1, 33)),
      y: b64u(publicRaw.slice(33, 65)),
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

export async function vapidHeader(
  endpoint: string,
  subject: string,
  publicKey: string,
  privateKey: string,
  now: number = Date.now(),
) {
  /*
   * RFC 8292 requires the subject to be a mailto: or https: URI, not a bare
   * address. Push services reject a bare one with an opaque 400, so catch it
   * here where the message can say what is actually wrong.
   */
  if (!/^(mailto:|https:\/\/)/i.test(subject)) {
    throw new Error(
      `VAPID_SUBJECT must start with "mailto:" or "https://" — got "${subject}". `
      + 'An email address on its own is rejected by the push service.',
    );
  }

  const { origin } = new URL(endpoint);
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  /* Twelve hours. The spec caps it at 24; shorter limits the damage if a token
     ever escapes. */
  const body = b64u(enc.encode(JSON.stringify({
    aud: origin,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: subject,
  })));

  const key = await vapidKey(unb64u(privateKey), unb64u(publicKey));
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${body}`),
  );
  return {
    Authorization: `vapid t=${header}.${body}.${b64u(sig)}, k=${publicKey}`,
  };
}

/* ── Payload encryption (RFC 8291 / RFC 8188) ──────────── */
export async function encrypt(
  plaintext: string,
  p256dh: string,       // the browser's public key, from the subscription
  authSecret: string,   // the browser's auth secret, from the subscription
  salt?: Uint8Array,    // injectable so a test can be deterministic
  ephemeral?: CryptoKeyPair,
) {
  const uaPublic = unb64u(p256dh);
  const auth = unb64u(authSecret);

  const asKeys = ephemeral ?? await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  ) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));

  const uaKey = await crypto.subtle.importKey(
    'raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256),
  );

  /* The key-derivation info string binds both public keys into the secret, so a
     payload cannot be replayed at a different subscriber. */
  const prk = await hkdf(
    auth, shared,
    cat(enc.encode('WebPush: info\0'), uaPublic, asPublic),
    32,
  );

  const useSalt = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek   = await hkdf(useSalt, prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(useSalt, prk, enc.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  /* 0x02 is the last-record delimiter; without it the browser rejects the
     payload as truncated. */
  const padded = cat(enc.encode(plaintext), new Uint8Array([0x02]));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded),
  );

  /* Header: salt(16) | record size(4) | key id length(1) | key id(65) */
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return cat(useSalt, rs, new Uint8Array([asPublic.length]), asPublic, sealed);
}

/** Decrypt — used only by the tests, to prove the encryption is real. */
export async function decrypt(body: Uint8Array, uaPrivateJwk: JsonWebKey, authSecret: string) {
  const salt = body.slice(0, 16);
  const idLen = body[20];
  const asPublic = body.slice(21, 21 + idLen);
  const sealed = body.slice(21 + idLen);

  const uaPriv = await crypto.subtle.importKey(
    'jwk', uaPrivateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'],
  );
  const asKey = await crypto.subtle.importKey(
    'raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPriv, 256),
  );

  const uaPublic = cat(
    new Uint8Array([4]), unb64u(uaPrivateJwk.x as string), unb64u(uaPrivateJwk.y as string),
  );
  const prk = await hkdf(
    unb64u(authSecret), shared,
    cat(enc.encode('WebPush: info\0'), uaPublic, asPublic),
    32,
  );
  const cek   = await hkdf(salt, prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, enc.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const open = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, sealed),
  );
  return new TextDecoder().decode(open.slice(0, -1));   // drop the 0x02 delimiter
}

/**
 * Send one notification.
 * @returns `gone` when the push service says the subscription is dead (404/410)
 *          so the caller can delete it.
 */
export async function sendPush(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: unknown,
  vapid: { subject: string; publicKey: string; privateKey: string },
) {
  const body = await encrypt(JSON.stringify(payload), sub.p256dh, sub.auth);
  const auth = await vapidHeader(sub.endpoint, vapid.subject, vapid.publicKey, vapid.privateKey);

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });

  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
