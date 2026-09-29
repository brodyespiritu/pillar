// DEV ONLY. An in-memory stand-in for src/lib/supabase.js, swapped in by the `pillar-fixtures` plugin in
// vite.config.js — and only by `vite --mode fixtures` (npm run dev:fixtures). Real code keeps importing
// '../lib/supabase'; under the harness that import lands here, so no request ever reaches the church's
// Supabase project and nothing a tester does here reaches members' phones.
//
// It speaks the parts of supabase-js that Pillar uses (tests/fixtures.test.mjs keeps the list honest):
//   from(table) — select / insert / update / upsert(onConflict) / delete, the filters, order / limit /
//     range, single / maybeSingle; every step chainable AND awaitable; rows come back after .select()
//   rpc — verify_pin and set_pin say yes (any 4 digits unlock), app_touch is a quiet no-op, the update
//     popup's four (post / edit / take down / put back) work on its table
//   auth — already signed in as "Preview Admin" (an Admin, onboarded); sign out works, and a reload
//     signs back in
//   storage — uploads go to the dev server's memory (/__fixtures/media/…) so a dropped picture shows
//   channel / removeChannel — silent no-ops (Pillar's remote-control channel)
//   functions.invoke — refuses: edge functions are off here
//
// Everything lives in memory: a reload starts again from src/dev/fixtures/data.js.
import { FX, FIXTURE_USER, PILLAR_FIXTURES, clone, pic, tableSeed, wait } from './data.js';

export { PILLAR_FIXTURES };

const db = tableSeed();
const rowsOf = (t) => (db[t] ||= []);

// the tables whose SQL a church may not have run yet — ?fx=nosetup makes them answer the way PostgREST does
const OPTIONAL = new Set(['app_media_series', 'app_media_featured', 'app_bulletin_slides', 'app_sermon_notes', 'app_page_headers', 'app_update_notice', 'app_refresh', 'app_test_popups']);
// what each table is unique on, beside its id (the constraints the libs turn into plain words)
const UNIQUE = {
  app_home_tiles: ['slot'],
  app_media_featured: ['item_id'],
  app_update_notice: ['platform'],
  app_page_headers: ['page'],
  app_sermon_notes: ['sermon_id'],
};
// tables keyed by something other than a generated id
const KEYED = { app_home_tiles: 'slot', app_media_featured: 'item_id', app_update_notice: 'platform', app_page_headers: 'page', app_refresh: 'part' };
// tables with `sort integer not null default 0`
const SORTED = new Set(['app_home_cards', 'app_media_series', 'app_media_featured', 'app_sermon_notes', 'app_bulletin_slides', 'church_groups', 'group_posts']);
// ON DELETE CASCADE, as the SQL has it
const CASCADE = { church_groups: [['group_posts', 'group_id']] };

const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID()
  : `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`);
const nowIso = () => new Date().toISOString();
const pgError = (code, message, extra = {}) => ({ code, message, details: null, hint: null, ...extra });

/* ── filters ── */

const likeToRegex = (pattern, flags) => new RegExp(
  `^${String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, flags);
const same = (a, b) => (a == null && b == null) || String(a) === String(b);
const compare = (a, b) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
};

function test(op, value, arg) {
  switch (op) {
    case 'eq': return same(value, arg);
    case 'neq': return !same(value, arg);
    case 'gt': return value != null && compare(value, arg) > 0;
    case 'gte': return value != null && compare(value, arg) >= 0;
    case 'lt': return value != null && compare(value, arg) < 0;
    case 'lte': return value != null && compare(value, arg) <= 0;
    case 'like': return value != null && likeToRegex(arg).test(String(value));
    case 'ilike': return value != null && likeToRegex(arg, 'i').test(String(value));
    case 'is': return arg === null ? value == null : value === arg;
    case 'in': return (Array.isArray(arg) ? arg : []).some((x) => same(value, x));
    case 'contains':
      if (Array.isArray(value)) return (Array.isArray(arg) ? arg : [arg]).every((x) => value.some((v) => same(v, x)));
      if (value && typeof value === 'object') return Object.entries(arg || {}).every(([k, v]) => same(value[k], v));
      return value != null && String(value).includes(String(arg));
    case 'containedBy': return Array.isArray(value) && value.every((v) => (arg || []).some((x) => same(v, x)));
    case 'overlaps': return Array.isArray(value) && value.some((v) => (arg || []).some((x) => same(v, x)));
    default: return true;   // anything more exotic keeps the row, rather than hiding data
  }
}

// PostgREST's text form, for .filter() / .not() / .or(): 'is.null', 'eq.5', 'in.(a,b)'
function parseText(op, raw) {
  const s = String(raw);
  if (op === 'is') return s === 'null' ? null : s === 'true' ? true : s === 'false' ? false : raw;
  if (op === 'in') return typeof raw === 'string' ? s.replace(/^\(|\)$/g, '').split(',').map((x) => x.trim().replace(/^"|"$/g, '')) : raw;
  return raw;
}

/* ── the query builder: every step returns the builder, and awaiting it runs it ── */

class Query {
  constructor(table) {
    this.table = table;
    this.op = 'select';
    this.payload = null;
    this.options = {};
    this.filters = [];
    this.orders = [];
    this.lim = null;
    this.rng = null;
    this.returning = false;
    this.one = null;          // 'single' | 'maybe'
    this.countMode = null;
    this.head = false;
  }

  /* what to do */
  select(_columns = '*', { count, head } = {}) {
    if (this.op === 'select') { this.countMode = count || null; this.head = !!head; } else this.returning = true;
    return this;
  }
  insert(rows, options = {}) { this.op = 'insert'; this.payload = rows; this.options = options; return this; }
  update(patch, options = {}) { this.op = 'update'; this.payload = patch; this.options = options; return this; }
  upsert(rows, options = {}) { this.op = 'upsert'; this.payload = rows; this.options = options; return this; }
  delete(options = {}) { this.op = 'delete'; this.options = options; return this; }

  /* which rows */
  filter(column, op, value) { this.filters.push((r) => test(op, r[column], parseText(op, value))); return this; }
  eq(c, v) { return this.filter(c, 'eq', v); }
  neq(c, v) { return this.filter(c, 'neq', v); }
  gt(c, v) { return this.filter(c, 'gt', v); }
  gte(c, v) { return this.filter(c, 'gte', v); }
  lt(c, v) { return this.filter(c, 'lt', v); }
  lte(c, v) { return this.filter(c, 'lte', v); }
  like(c, v) { return this.filter(c, 'like', v); }
  ilike(c, v) { return this.filter(c, 'ilike', v); }
  is(c, v) { return this.filter(c, 'is', v); }
  in(c, v) { return this.filter(c, 'in', v); }
  contains(c, v) { return this.filter(c, 'contains', v); }
  containedBy(c, v) { return this.filter(c, 'containedBy', v); }
  overlaps(c, v) { return this.filter(c, 'overlaps', v); }
  textSearch(c, q) { return this.filter(c, 'ilike', `%${String(q).replace(/'/g, '')}%`); }
  match(obj) { Object.entries(obj || {}).forEach(([c, v]) => this.eq(c, v)); return this; }
  not(column, op, value) { this.filters.push((r) => !test(op, r[column], parseText(op, value))); return this; }
  or(expr) {
    // 'a.eq.1,b.is.null' — top-level terms only; nested and(...) keeps every row
    const terms = String(expr).split(/,(?![^(]*\))/).map((t) => /^([^.]+)\.(?:(not)\.)?([a-z]+)\.(.*)$/i.exec(t.trim())).filter(Boolean);
    if (!terms.length) return this;
    this.filters.push((r) => terms.some(([, c, neg, op, v]) => {
      const hit = test(op, r[c], parseText(op, v));
      return neg ? !hit : hit;
    }));
    return this;
  }

  /* shape of the answer */
  order(column, { ascending = true, nullsFirst } = {}) { this.orders.push({ column, ascending, nullsFirst }); return this; }
  limit(n) { this.lim = n; return this; }
  range(from, to) { this.rng = [from, to]; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  abortSignal() { return this; }
  returns() { return this; }
  throwOnError() { this.throws = true; return this; }
  csv() { return this; }

  then(resolve, reject) { return this.run().then(resolve, reject); }
  catch(reject) { return this.run().catch(reject); }
  finally(f) { return this.run().finally(f); }

  matching() { return rowsOf(this.table).filter((r) => this.filters.every((f) => f(r))); }

  sorted(rows) {
    const out = [...rows];
    out.sort((a, b) => {
      for (const { column, ascending, nullsFirst } of this.orders) {
        const x = a[column]; const y = b[column];
        if (x == null || y == null) {
          if (x == null && y == null) continue;
          const nullFirst = nullsFirst ?? !ascending;   // PostgreSQL: NULLS LAST ascending, FIRST descending
          return (x == null) === nullFirst ? -1 : 1;
        }
        const c = compare(x, y);
        if (c) return ascending ? c : -c;
      }
      return 0;
    });
    return out;
  }

  withDefaults(row) {
    return {
      ...(KEYED[this.table] ? {} : { id: newId() }),
      ...(SORTED.has(this.table) ? { sort: 0 } : {}),   // the SQL's `sort integer not null default 0`
      created_at: nowIso(),
      ...row,
      updated_at: nowIso(),
    };
  }

  clash(row, except) {
    const cols = UNIQUE[this.table] || [];
    return cols.find((c) => row[c] != null && rowsOf(this.table).some((r) => r !== except && same(r[c], row[c])));
  }

  write() {
    const table = rowsOf(this.table);
    const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).filter(Boolean);
    if (this.op === 'insert') {
      const made = [];
      for (const row of list) {
        const full = this.withDefaults(clone(row));
        const c = this.clash(full);
        if (c) return { error: pgError('23505', `duplicate key value violates unique constraint "${this.table}_${c}_key"`) };
        table.push(full);
        made.push(full);
      }
      return { rows: made };
    }
    if (this.op === 'update') {
      const hit = this.matching();
      for (const r of hit) {
        const c = this.clash({ ...r, ...this.payload }, r);
        if (c) return { error: pgError('23505', `duplicate key value violates unique constraint "${this.table}_${c}_key"`) };
      }
      hit.forEach((r) => Object.assign(r, clone(this.payload), { updated_at: nowIso() }));
      return { rows: hit };
    }
    if (this.op === 'upsert') {
      const keys = String(this.options.onConflict || KEYED[this.table] || 'id').split(',').map((s) => s.trim());
      const out = [];
      for (const row of list) {
        const found = table.find((r) => keys.every((k) => row[k] != null && same(r[k], row[k])));
        if (found) {
          if (!this.options.ignoreDuplicates) Object.assign(found, clone(row), { updated_at: nowIso() });
          out.push(found);
        } else {
          const full = this.withDefaults(clone(row));
          table.push(full);
          out.push(full);
        }
      }
      return { rows: out };
    }
    // delete
    const gone = this.matching();
    db[this.table] = table.filter((r) => !gone.includes(r));
    (CASCADE[this.table] || []).forEach(([child, col]) => {
      db[child] = rowsOf(child).filter((r) => !gone.some((g) => same(g.id, r[col])));
    });
    return { rows: gone };
  }

  async run() {
    await wait();
    const answer = this.answer();
    if (this.throws && answer.error) throw Object.assign(new Error(answer.error.message), answer.error);
    return answer;
  }

  answer() {
    if (FX.nosetup && OPTIONAL.has(this.table)) {
      return { data: null, error: pgError('PGRST205', `Could not find the table 'public.${this.table}' in the schema cache`), count: null, status: 404, statusText: 'Not Found' };
    }
    let rows;
    if (this.op === 'select') {
      rows = this.sorted(this.matching());
    } else {
      if (FX.fail) return { data: null, error: pgError('42501', 'The database said no (fixtures: ?fx=fail).'), count: null, status: 403, statusText: 'Forbidden' };
      const done = this.write();
      if (done.error) return { data: null, error: done.error, count: null, status: 409, statusText: 'Conflict' };
      if (!this.returning) return { data: null, error: null, count: null, status: this.op === 'insert' ? 201 : 204, statusText: 'OK' };
      rows = this.sorted(done.rows);
    }
    const count = rows.length;
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim != null) rows = rows.slice(0, this.lim);
    if (this.head) return { data: null, error: null, count, status: 200, statusText: 'OK' };
    const data = clone(rows);
    if (this.one) {
      if (data.length === 1) return { data: data[0], error: null, count: this.countMode ? 1 : null, status: 200, statusText: 'OK' };
      if (this.one === 'maybe' && data.length === 0) return { data: null, error: null, count: null, status: 200, statusText: 'OK' };
      return { data: null, error: pgError('PGRST116', 'JSON object requested, multiple (or no) rows returned', { details: `The result contains ${data.length} rows` }), count: null, status: 406, statusText: 'Not Acceptable' };
    }
    return { data, error: null, count: this.countMode ? count : null, status: 200, statusText: 'OK' };
  }
}

/* ── auth: signed in from the start ── */

let session = { access_token: 'fixture-token', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: clone(FIXTURE_USER) };
const listeners = new Set();
const emit = (event) => listeners.forEach((fn) => { try { fn(event, session); } catch (e) { console.error(e); } });

const auth = {
  async getSession() { return { data: { session }, error: null }; },
  async getUser() { return { data: { user: session?.user ?? null }, error: session ? null : { message: 'Auth session missing!' } }; },
  onAuthStateChange(fn) {
    listeners.add(fn);
    setTimeout(() => { if (listeners.has(fn)) fn('INITIAL_SESSION', session); }, 0);
    return { data: { subscription: { id: 'fixtures', unsubscribe: () => listeners.delete(fn) } } };
  },
  async signInWithPassword() {
    await wait();
    session = { ...(session || {}), access_token: 'fixture-token', user: clone(FIXTURE_USER) };
    emit('SIGNED_IN');
    return { data: { session, user: session.user }, error: null };
  },
  async signInWithOAuth() { return { data: null, error: { message: 'Google sign-in is off in fixtures. Reload the page to sign back in.' } }; },
  async signOut() { session = null; emit('SIGNED_OUT'); return { error: null }; },
  async refreshSession() { return { data: { session, user: session?.user ?? null }, error: null }; },
  async updateUser(attrs) { if (session) session.user = { ...session.user, ...attrs }; return { data: { user: session?.user ?? null }, error: null }; },
  async resetPasswordForEmail() { return { data: {}, error: null }; },
};

/* ── rpc ── */

// the update popup's functions (supabase/app-test-popups.sql), in memory: one up at a time
function popupRpc(name, args = {}) {
  const rows = rowsOf('app_test_popups');
  const live = rows.find((r) => r.live);
  const bad = (message) => ({ data: null, error: pgError('P0001', message) });
  if (name === 'app_test_popup_post') {
    if (!String(args.p_title || '').trim()) return bad('Give it a title first.');
    if (live) { live.live = false; live.taken_down_at = nowIso(); }
    const row = { id: newId(), title: String(args.p_title).trim(), body: clone(args.p_body), live: true, created_at: nowIso(), posted_at: nowIso(), taken_down_at: null };
    rows.push(row);
    return { data: row.id, error: null };
  }
  if (name === 'app_test_popup_edit') {
    if (!live || live.id !== args.p_id) return bad('That popup isn’t up any more.');
    live.title = String(args.p_title).trim(); live.body = clone(args.p_body);
    return { data: null, error: null };
  }
  if (name === 'app_test_popup_take_down') {
    if (live) { live.live = false; live.taken_down_at = nowIso(); }
    return { data: null, error: null };
  }
  if (name === 'app_test_popup_restore') {
    if (live && live.id !== args.p_id) return bad('Another popup is up now — take it down first.');
    const row = rows.find((r) => r.id === args.p_id);
    if (!row) return bad('That popup isn’t there any more.');
    row.live = true; row.taken_down_at = null;
    return { data: null, error: null };
  }
  return { data: null, error: null };
}

async function rpc(name, args) {
  if (name === 'app_touch') return { data: null, error: null };   // polled after every write: stays quiet
  await wait();
  if (String(name).startsWith('app_test_popup_')) return popupRpc(name, args);
  // any PIN unlocks, and setting one always works — there is no real account behind this
  if (name === 'verify_pin' || name === 'set_pin' || name === 'admin_set_pin') return { data: true, error: null };
  return { data: null, error: null };
}

/* ── storage: kept by the dev server so the picture really shows ── */

const stored = new Map();   // bucket/path → address

function bucket(name) {
  return {
    async upload(path, body, { contentType } = {}) {
      if (FX.fail) { await wait(); return { data: null, error: { message: 'The database said no (fixtures: ?fx=fail).' } }; }
      try {
        const res = await fetch(`/__fixtures/upload?name=${encodeURIComponent(`${name}/${path}`)}`, {
          method: 'POST', headers: { 'Content-Type': contentType || body?.type || 'application/octet-stream' }, body,
        });
        const out = await res.json();
        if (!res.ok || !out?.path) throw new Error(out?.error || `Upload failed (${res.status})`);
        stored.set(`${name}/${path}`, `${globalThis.location.origin}${out.path}`);
      } catch {
        stored.set(`${name}/${path}`, pic(`upload-${path}`, 1600, 900));   // no dev server to hold it: a stand-in picture
      }
      return { data: { path, id: newId(), fullPath: `${name}/${path}` }, error: null };
    },
    getPublicUrl(path) {
      return { data: { publicUrl: stored.get(`${name}/${path}`) || pic(`storage-${path}`, 1600, 900) } };
    },
    async remove(paths = []) { paths.forEach((p) => stored.delete(`${name}/${p}`)); return { data: paths.map((p) => ({ name: p })), error: null }; },
    async list() { return { data: [...stored.keys()].filter((k) => k.startsWith(`${name}/`)).map((k) => ({ name: k.slice(name.length + 1) })), error: null }; },
    async createSignedUrl(path) { return { data: { signedUrl: stored.get(`${name}/${path}`) || pic(`storage-${path}`) }, error: null }; },
  };
}

/* ── realtime: Pillar's remote-control channel, silent ── */

function channel(topic) {
  const ch = {
    topic,
    on() { return ch; },
    subscribe(cb) { if (typeof cb === 'function') setTimeout(() => cb('SUBSCRIBED'), 0); return ch; },
    async send() { return 'ok'; },
    async unsubscribe() { return 'ok'; },
    async track() { return 'ok'; },
    presenceState() { return {}; },
  };
  return ch;
}

export const supabase = {
  from: (table) => new Query(table),
  rpc,
  auth,
  storage: { from: bucket },
  channel,
  async removeChannel() { return 'ok'; },
  async removeAllChannels() { return []; },
  getChannels() { return []; },
  functions: {
    async invoke(name) {
      await wait();
      return { data: null, error: { message: `Edge function "${name}" is off in fixtures — nothing was sent.` } };
    },
  },
};

if (typeof window !== 'undefined') {
  console.info(`[fixtures] Pillar is running on in-memory sample data${FX.raw ? ` (fx=${FX.raw})` : ''}. Nothing reaches Supabase or the app server. Any 4-digit PIN unlocks.`);
}
