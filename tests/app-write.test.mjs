// Pillar's api/app-write.js: only signed-in staff, the key never leaves the
// server, only app-content endpoints, and upstream answers pass through.
import assert from 'node:assert';
const MOD = new URL('../api/app-write.js', import.meta.url).pathname;   // the proxy itself

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('  ✓', name); };

const STAFF = 'staff-token';
const upstream = [];
function fakeFetch({ staffActive = true, known = true, upstreamStatus = 200, upstreamBody = { ok: 1 }, throws = false } = {}) {
  return async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) {
      const ok = (opts.headers?.Authorization || '') === `Bearer ${STAFF}`;
      return { ok, json: async () => (ok ? { id: 'u1' } : {}) };
    }
    if (u.includes('/rest/v1/staff')) {
      return { ok: true, json: async () => (known ? [{ id: 'u1', active: staffActive }] : []) };
    }
    upstream.push({ url: u, opts });
    if (throws) throw new Error('network');
    return { status: upstreamStatus, ok: upstreamStatus < 400, text: async () => JSON.stringify(upstreamBody) };
  };
}
const res = () => {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const call = async (handler, { body, auth = `Bearer ${STAFF}`, method = 'POST' } = {}) => {
  const r = res();
  await handler({ method, headers: { authorization: auth }, body }, r);
  return r;
};

process.env.APP_API_KEY = 'SECRET-KEY-123';
const { default: handler } = await import(MOD);

await t('a change from signed-in staff is forwarded with the key, which never comes back', async () => {
  globalThis.fetch = fakeFetch();
  upstream.length = 0;
  const r = await call(handler, { body: { path: '/api/sermons', method: 'POST', body: { id: '1', title: 'Sunday' } } });
  assert.strictEqual(r.code, 200);
  assert.deepStrictEqual(r.body, { ok: true, data: { ok: 1 } });
  assert.strictEqual(upstream.length, 1);
  assert.strictEqual(upstream[0].url, 'https://bethesda-admin.onrender.com/api/sermons');
  assert.strictEqual(upstream[0].opts.method, 'POST');
  assert.strictEqual(upstream[0].opts.headers['x-api-key'], 'SECRET-KEY-123');
  assert.strictEqual(upstream[0].opts.headers.Authorization, 'Bearer SECRET-KEY-123');
  assert.ok(!JSON.stringify(r.body).includes('SECRET-KEY-123'));
});

await t('nobody else can use it: signed out, an unknown user, or inactive staff', async () => {
  globalThis.fetch = fakeFetch();
  for (const opts of [{ auth: '' }, { auth: 'Bearer someone-else' }]) {
    const r = await call(handler, { body: { path: '/api/sermons', method: 'POST', body: {} }, ...opts });
    assert.strictEqual(r.code, 401, JSON.stringify(r.body));
  }
  globalThis.fetch = fakeFetch({ staffActive: false });
  assert.strictEqual((await call(handler, { body: { path: '/api/sermons', method: 'POST', body: {} } })).code, 401);
  globalThis.fetch = fakeFetch({ known: false });
  assert.strictEqual((await call(handler, { body: { path: '/api/sermons', method: 'POST', body: {} } })).code, 401);
});

await t('only app-content endpoints and write methods', async () => {
  globalThis.fetch = fakeFetch();
  const bad = [
    { path: '/api/upload', method: 'POST' },
    { path: '/api/app/users/1', method: 'DELETE' },
    { path: '/api/sermons/../../etc', method: 'POST' },
    { path: 'https://evil.example.com/api/sermons', method: 'POST' },
    { path: '/api/sermons', method: 'GET' },
    { path: '/api/sermons', method: 'OPTIONS' },
    { path: '/api/settings?x=1', method: 'PUT' },
  ];
  for (const b of bad) {
    const r = await call(handler, { body: { ...b, body: {} } });
    assert.strictEqual(r.code, 400, `${b.method} ${b.path} → ${r.code}`);
  }
  for (const b of [{ path: '/api/settings', method: 'PUT' }, { path: '/api/sermons/abc-1', method: 'DELETE' }, { path: '/api/notifications/send', method: 'POST' }]) {
    const r = await call(handler, { body: { ...b, body: {} } });
    assert.strictEqual(r.code, 200, `${b.method} ${b.path} → ${JSON.stringify(r.body)}`);
  }
});

await t('the app server refusing the key reads as a key problem, not a sign-in one', async () => {
  globalThis.fetch = fakeFetch({ upstreamStatus: 401, upstreamBody: { error: 'Unauthorized' } });
  const r = await call(handler, { body: { path: '/api/settings', method: 'PUT', body: {} } });
  assert.strictEqual(r.code, 502);
  assert.match(r.body.error, /APP_API_KEY/);
  assert.ok(!JSON.stringify(r.body).includes('SECRET-KEY-123'));
});

await t('other upstream errors and outages come back in plain words', async () => {
  globalThis.fetch = fakeFetch({ upstreamStatus: 422, upstreamBody: { error: 'Title required' } });
  let r = await call(handler, { body: { path: '/api/sermons', method: 'POST', body: {} } });
  assert.strictEqual(r.code, 422); assert.strictEqual(r.body.error, 'Title required');
  globalThis.fetch = fakeFetch({ throws: true });
  r = await call(handler, { body: { path: '/api/sermons', method: 'POST', body: {} } });
  assert.strictEqual(r.code, 504); assert.match(r.body.error, /waking up/);
});

await t('no key on the server says exactly where to put it, and forwards nothing', async () => {
  delete process.env.APP_API_KEY;
  const { default: fresh } = await import(`${MOD}?v=2`);
  globalThis.fetch = fakeFetch();
  upstream.length = 0;
  const r = await call(fresh, { body: { path: '/api/settings', method: 'PUT', body: {} } });
  assert.strictEqual(r.code, 503);
  assert.match(r.body.error, /APP_API_KEY.*Vercel/s);
  assert.strictEqual(upstream.length, 0);
  process.env.APP_API_KEY = 'SECRET-KEY-123';
});

await t('GET on the endpoint itself is refused', async () => {
  globalThis.fetch = fakeFetch();
  const r = await call(handler, { method: 'GET', body: {} });
  assert.strictEqual(r.code, 405);
});

console.log(`${pass} app-write checks passed`);
