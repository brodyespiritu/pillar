import { supabase } from './supabase';
import { downscaleImage } from './locations';

// The cards under the four boxes on the app's Home page (supabase/app-home-cards.sql →
// public.app_home_cards). Staff write them here; members' phones hear about each save as it happens
// (the app subscribes to the table while Home is open), so there is no "publish to the app" step.
//
// The rules below are the database's rules, repeated so the form can say what is wrong before a save
// is refused. Change one and change the other: supabase/app-home-cards.sql.

export const CARD_COLUMNS =
  'id,kind,audience,kicker,title,subtitle,body,image_url,video_url,buttons,starts_on,ends_on,published,sort,updated_at';
export const BUCKET = 'app-media';

export const KINDS = [
  { key: 'image',   label: 'Picture',        hint: 'A photograph with your title and a line under it.' },
  { key: 'video',   label: 'Video',          hint: 'A video with a play button — it plays inside the app.' },
  { key: 'text',    label: 'Words',          hint: 'A title and a paragraph on a soft tint. No picture.' },
  { key: 'dinner',  label: 'Wednesday plate', hint: "The app's own plate card, live from the dinner RSVP." },
  { key: 'welcome', label: 'Welcome',        hint: 'The app’s “Welcome to the new Bethesda App” card.' },
];
export const BUILT_IN = new Set(['dinner', 'welcome']);

export const AUDIENCES = [
  { key: 'everyone',   label: 'Everyone' },
  { key: 'signed_in',  label: 'Signed-in members' },
  { key: 'signed_out', label: 'Visitors (not signed in)' },
];

export const ACTIONS = [
  { key: 'url',   label: 'Open a link' },
  { key: 'page',  label: 'Open an app page' },
  { key: 'plate', label: 'Reserve a Wednesday plate' },
  { key: 'video', label: "Play this card's video" },
];

// the pages a button may open — exactly the app's own list (BethesdaApp utils/homeCards.js)
export const PAGES = [
  { key: 'Bulletin',  label: 'Digital Bulletin' },
  { key: 'Groups',    label: 'Groups' },
  { key: 'Calendar',  label: 'Calendar' },
  { key: 'Directory', label: 'Directory' },
  { key: 'Bible',     label: 'Bible' },
  { key: 'Sermons',   label: 'Watch' },
  { key: 'Give',      label: 'Give' },
  { key: 'Profile',   label: 'My Profile' },
];

export const LIMITS = { kicker: 40, title: 80, subtitle: 160, body: 600, label: 24, buttons: 2 };

const orNull = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};
export const isWebLink = (v) => /^https?:\/\/[^\s]+$/.test(String(v || '').trim());

/** Every card, drafts and scheduled ones included, in the office's order. */
export async function listCards() {
  const { data, error } = await supabase
    .from('app_home_cards')
    .select(CARD_COLUMNS)
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * What stops this card going on phones, in words the office can act on. Empty: it's ready.
 * (`draftProblems` is the shorter list that stops it being saved at all.)
 */
export function cardProblems(f) {
  const out = [];
  const kind = f.kind;
  const title = String(f.title || '').trim();
  if (!KINDS.some((k) => k.key === kind)) out.push('Choose what kind of card this is.');
  if (!BUILT_IN.has(kind) && !title) out.push('Give the card a title.');
  if (kind === 'image' && !String(f.image_url || '').trim()) out.push('A picture card needs a picture.');
  if (kind === 'video' && !String(f.video_url || '').trim()) out.push('A video card needs a video — upload one or paste a link.');
  return [...out, ...draftProblems(f)];
}

/** What the database would refuse even for a draft: bad links, too many words, broken buttons, dates. */
export function draftProblems(f) {
  const out = [];
  const kind = f.kind;
  const photo = kind === 'image' || kind === 'video';
  if (photo && f.image_url && !isWebLink(f.image_url)) out.push('The picture has to be a web address (https://…).');
  if (kind === 'video' && f.video_url && !isWebLink(f.video_url)) out.push('The video link has to start with https://');
  for (const [k, max] of [['kicker', LIMITS.kicker], ['title', LIMITS.title], ['subtitle', LIMITS.subtitle], ['body', LIMITS.body]]) {
    if (String(f[k] || '').trim().length > max) out.push(`The ${k} has to be ${max} characters or fewer.`);
  }
  // the app's own cards carry no buttons of ours — whatever the form still holds is dropped on save
  const buttons = BUILT_IN.has(kind) ? [] : (f.buttons || []);
  if (buttons.length > LIMITS.buttons) out.push(`A card can have ${LIMITS.buttons} buttons at most.`);
  buttons.forEach((b, i) => {
    const n = `Button ${i + 1}`;
    const label = String(b.label || '').trim();
    if (!label) out.push(`${n} needs a label.`);
    if (label.length > LIMITS.label) out.push(`${n}'s label has to be ${LIMITS.label} characters or fewer.`);
    if (!ACTIONS.some((a) => a.key === b.action)) out.push(`${n} needs something to do.`);
    if (b.action === 'url' && !isWebLink(b.target)) out.push(`${n}'s link has to start with https://`);
    if (b.action === 'page' && !PAGES.some((p) => p.key === b.target)) out.push(`${n} needs a page to open.`);
    if (b.action === 'video' && kind !== 'video') out.push(`${n} plays a video, but this isn't a video card.`);
  });
  if (f.starts_on && f.ends_on && f.ends_on < f.starts_on) out.push('The end date is before the start date.');
  return out;
}

/** Whether a new card has anything in it yet — an empty one isn't worth saving. */
export function hasCardContent(f) {
  if (BUILT_IN.has(f.kind)) return true;
  return ['kicker', 'title', 'subtitle', 'body', 'image_url', 'video_url'].some((k) => String(f[k] || '').trim())
    || (f.buttons || []).some((b) => String(b.label || '').trim());
}

/** Exactly what goes in the table. Built-in cards keep none of the words — the app draws its own. */
export function cardPatch(f) {
  const builtIn = BUILT_IN.has(f.kind);
  return {
    kind: f.kind,
    audience: AUDIENCES.some((a) => a.key === f.audience) ? f.audience : 'everyone',
    kicker: builtIn ? null : orNull(f.kicker),
    title: builtIn ? null : orNull(f.title),
    subtitle: builtIn ? null : orNull(f.subtitle),
    // every card the office writes may carry more words: they show when a member taps it (Announcements, 2026-09-23)
    body: BUILT_IN.has(f.kind) ? null : orNull(f.body),
    image_url: f.kind === 'image' || f.kind === 'video' ? orNull(f.image_url) : null,
    video_url: f.kind === 'video' ? orNull(f.video_url) : null,
    buttons: builtIn ? [] : (f.buttons || []).map((b) => ({
      label: String(b.label || '').trim(),
      action: b.action,
      ...(b.action === 'url' || b.action === 'page' ? { target: String(b.target || '').trim() } : {}),
    })),
    starts_on: orNull(f.starts_on),
    ends_on: orNull(f.ends_on),
    published: f.published !== false,
    sort: Number.isFinite(Number(f.sort)) ? Number(f.sort) : 0,
  };
}

export async function saveCard(f) {
  const patch = cardPatch(f);
  const q = f.id
    ? supabase.from('app_home_cards').update(patch).eq('id', f.id)
    : supabase.from('app_home_cards').insert(patch);
  const { data, error } = await q.select(CARD_COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function setCardPublished(id, published) {
  const { data, error } = await supabase
    .from('app_home_cards').update({ published }).eq('id', id).select(CARD_COLUMNS).single();
  if (error) throw error;
  return data;
}

/** Swap two cards' places. Both saves go together; the phones redraw once each lands. */
export async function swapOrder(a, b) {
  const [ra, rb] = await Promise.all([
    supabase.from('app_home_cards').update({ sort: b.sort }).eq('id', a.id).select(CARD_COLUMNS).single(),
    supabase.from('app_home_cards').update({ sort: a.sort }).eq('id', b.id).select(CARD_COLUMNS).single(),
  ]);
  if (ra.error) throw ra.error;
  if (rb.error) throw rb.error;
  return [ra.data, rb.data];
}

/** Just the order — a drag in the list. */
export async function setCardSort(id, sort) {
  const { error } = await supabase.from('app_home_cards').update({ sort }).eq('id', id);
  if (error) throw error;
}

export async function deleteCard(id) {
  const { error } = await supabase.from('app_home_cards').delete().eq('id', id);
  if (error) throw error;
}

/** Downscale a photo and put it in the app's public bucket. Returns { url } or { error }. */
export async function uploadCardImage(file) {
  if (!file) return { error: 'No file chosen.' };
  let shrunk;
  try { shrunk = await downscaleImage(file, { maxEdge: 1600, quality: 0.82 }); }
  catch (e) { return { error: e.message }; }
  // a fresh name each time, so a replaced picture is never served from a phone's cache
  const path = `home/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, shrunk.blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
  if (error) {
    return { error: /bucket not found/i.test(error.message)
      ? 'The app-media bucket isn’t set up yet — run supabase/app-home-cards.sql.'
      : error.message };
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}

// The church's date as YYYY-MM-DD — the day the database's public.church_today() gives.
export const churchDay = (at = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(at);

/** What a phone shows today: published and inside its window. Mirrors the read policy exactly. */
export function liveLabel(c, today = new Date()) {
  if (!c.published) return 'Draft';
  const day = churchDay(today);
  if (c.starts_on && c.starts_on > day) return `Starts ${c.starts_on}`;
  if (c.ends_on && c.ends_on < day) return `Ended ${c.ends_on}`;
  return 'Live';
}
export const isLive = (c, today) => liveLabel(c, today) === 'Live';

// ── What's Happening, read the way the app reads it (BethesdaApp utils/churchCalendar.js
// fetchCalendar) — only for Pillar's Home phone, so it shows the events and the featured cards a
// member's phone shows: the church calendar's public events that start (or are still running) between
// today and two months out, soonest first. Before calendar-featured.sql the featured columns aren't
// there and the database refuses the whole query, so it asks again without them, as the app does.
const EVENT_COLUMNS = 'id,title,description,category,start_date,end_date,start_time,end_time,location';
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The app's upcoming church events (raw rows, soonest first). A read only — nothing here writes. */
export async function listHomeEvents(now = new Date()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const horizon = new Date(today); horizon.setMonth(horizon.getMonth() + 2);
  const from = localDay(today);
  const read = (columns) => supabase.from('events').select(columns)
    .eq('calendar', 'church').eq('is_private', false)
    .or(`start_date.gte.${from},end_date.gte.${from}`)
    .lte('start_date', localDay(horizon))
    .order('start_date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: true })
    .limit(500);
  let { data, error } = await read(`${EVENT_COLUMNS},featured,image_url`);
  if (error) ({ data, error } = await read(EVENT_COLUMNS));
  if (error) throw error;
  return data || [];
}

/** The rooms and their photos, as the app reads them beside the calendar (fetchCalendar's
 *  locations?select=name,photo_url): a featured event with no picture of its own shows its room's
 *  (BethesdaApp utils/churchCalendar.js photoFor). A read only. */
export async function listHomeLocations() {
  const { data, error } = await supabase.from('locations').select('name,photo_url');
  if (error) throw error;
  return data || [];
}

// ── The Wednesday dinner, as the app hears about it — BethesdaApp utils/dinner.js fetchDinner asks the
// rsvp-forms function, which answers with supabase/functions/_shared/dinnerAck.ts activeDinner: a dinner
// takes reservations for DINNER_DAYS after its invitation goes out (or its row is written), and its menu
// is the plate card's line on Home. The same read here, so Pillar's Home phone says what members' phones
// say. Change one and change the other. A read only.
export const DINNER_DAYS = 14;

/** { open, menu } — whether a dinner is taking reservations now, and what's on its menu. */
export async function dinnerNow(now = Date.now()) {
  const cutoff = new Date(now - DINNER_DAYS * 864e5).toISOString();
  const { data, error } = await supabase.from('sms_library').select('last_sent_at,created_at,rsvp_menu')
    .eq('message_type', 'Dinner')
    .or(`last_sent_at.gte.${cutoff},created_at.gte.${cutoff}`)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  const when = (r) => Math.max(Date.parse(r.last_sent_at || '') || 0, Date.parse(r.created_at || '') || 0);
  const dinner = (data || []).slice().sort((a, b) => when(b) - when(a))[0] || null;
  if (!dinner) return { open: false, menu: [] };
  return { open: true, menu: (Array.isArray(dinner.rsvp_menu) ? dinner.rsvp_menu : []).map(String).slice(0, 12) };
}
