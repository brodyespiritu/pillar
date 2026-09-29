import { getAnnouncements } from './appApi';
import { listCards, isLive } from './homeCards';

// Where a push notification opens when it's tapped — Pillar → App → Notifications → "When it's tapped"
// (user, 2026-09-24: "For push notifications, add the ability when user clicks on the notification, it
// brings them to a particular page or announcement within the app").
//
// It goes out as the notification's `data`; the app server passes on only what it checks
// (bethesda-admin pushTarget.js) and the app reads it back at the tap (BethesdaApp
// utils/notificationLinks.js). The three lists of pages are the same, in the same order — the app's
// tests compare them.
//   { page: 'Bulletin', notice: '<id>' }   an announcement in the Digital Bulletin (Bulletin → Announcements)
//   { page: 'Home', card: '<id>' }         one of Home's announcement cards (Home → Cards)
//   { page: 'Calendar' }                   a page on its own
//   no data                                 the app opens where they left it

export const PUSH_PAGES = [
  { key: 'Home', label: 'Home' },
  { key: 'Sermons', label: 'Watch' },
  { key: 'Bible', label: 'Bible' },
  { key: 'Bulletin', label: 'Digital Bulletin' },
  { key: 'Calendar', label: 'Calendar' },
  { key: 'Groups', label: 'Groups' },
  { key: 'Directory', label: 'Directory' },
  { key: 'Give', label: 'Give' },
  { key: 'Profile', label: 'My Profile' },
];

export const OPENS = [
  { key: 'app', label: 'The app' },
  { key: 'page', label: 'A page' },
  { key: 'announcement', label: 'An announcement' },
];

export const BLANK_OPENS = { kind: 'app', page: 'Home', ann: '' };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const KINDS = OPENS.map((o) => o.key);
const PAGE_KEYS = PUSH_PAGES.map((p) => p.key);

/** A choice made safe — a kept draft could hold anything. */
export function opensOf(v) {
  const o = v && typeof v === 'object' ? v : {};
  return {
    kind: KINDS.includes(o.kind) ? o.kind : 'app',
    page: PAGE_KEYS.includes(o.page) ? o.page : 'Home',
    ann: typeof o.ann === 'string' && /^(notice|card):[A-Za-z0-9_-]{1,64}$/.test(o.ann) ? o.ann : '',
  };
}

const pageLabel = (key) => (PUSH_PAGES.find((p) => p.key === key) || {}).label || key;
// a page as a sentence says it: "Watch", "My Profile" — but "the Digital Bulletin"
const pagePhrase = (key) => (key === 'Bulletin' ? 'the Digital Bulletin' : pageLabel(key));

/** The notification's data for a choice; null to just open the app (or while an announcement isn't picked). */
export function pushData(opens) {
  const o = opensOf(opens);
  if (o.kind === 'page') return { page: o.page };
  if (o.kind === 'announcement' && o.ann) {
    const [where, id] = o.ann.split(':');
    if (!ID.test(id)) return null;
    return where === 'notice' ? { page: 'Bulletin', notice: id } : { page: 'Home', card: id };
  }
  return null;
}

/**
 * The announcements a notification can open — the ones on phones now: the Digital Bulletin's that are
 * switched on, and Home's announcement cards that are live (not the app's own plate and welcome cards).
 * → { list: [{ key, where, id, title, note }], failed: ['Digital Bulletin' | 'Home'] }
 */
export async function listAnnouncementChoices() {
  const [bulletin, cards] = await Promise.allSettled([getAnnouncements(), listCards()]);
  const list = [];
  const failed = [];
  if (bulletin.status === 'fulfilled') {
    for (const a of Array.isArray(bulletin.value) ? bulletin.value : []) {
      const id = a && a.id != null ? String(a.id) : '';
      if (!ID.test(id) || a.published === false) continue;
      list.push({ key: `notice:${id}`, where: 'bulletin', id, title: String(a.title || '').trim() || 'Untitled announcement', note: String(a.date || '').trim() });
    }
  } else failed.push('Digital Bulletin');
  if (cards.status === 'fulfilled') {
    for (const c of Array.isArray(cards.value) ? cards.value : []) {
      if (!c || !ID.test(String(c.id || '')) || !isLive(c) || !['image', 'video', 'text'].includes(c.kind)) continue;
      list.push({
        key: `card:${c.id}`, where: 'home', id: String(c.id),
        title: String(c.title || c.kicker || '').trim() || 'Untitled card',
        note: c.audience === 'signed_in' ? 'Members only' : c.audience === 'signed_out' ? 'Visitors only' : '',
      });
    }
  } else failed.push('Home');
  return { list, failed };
}

/** What a tap opens, in words: "Watch", "“Fall Festival” in the Digital Bulletin", "the app". */
export function opensWords(opens, list = []) {
  const o = opensOf(opens);
  if (o.kind === 'page') return pagePhrase(o.page);
  if (o.kind === 'announcement' && o.ann) {
    const hit = list.find((x) => x.key === o.ann);
    const name = hit ? `“${hit.title}”` : 'the announcement';
    return o.ann.startsWith('notice:') ? `${name} in the Digital Bulletin` : `${name} on Home`;
  }
  return 'the app';
}

/**
 * The line under the choice: what a tap does, and what to know first (a card only some people see).
 */
export function opensHint(opens, list, { loading = false, failed = [] } = {}) {
  const o = opensOf(opens);
  if (o.kind === 'app') return 'Tapping it opens the app where they left it.';
  if (o.kind === 'page') return `Tapping it opens ${pagePhrase(o.page)}.`;
  if (loading) return 'Reading the announcements on phones now…';
  if (!list || !list.length) {
    return failed.length ? 'The announcements couldn’t be read just now.'
      : 'There are no announcements on phones right now — add one in Bulletin or Home first.';
  }
  if (!o.ann) return 'Choose the announcement it opens.';
  const hit = list.find((x) => x.key === o.ann);
  if (!hit) return 'That announcement isn’t on phones any more — choose another.';
  const where = hit.where === 'bulletin' ? 'over the Digital Bulletin' : 'over Home';
  const only = hit.note === 'Members only' ? ' Only signed-in members see this card — anyone else lands on Home.'
    : hit.note === 'Visitors only' ? ' Only visitors (not signed in) see this card — members land on Home.' : '';
  return `Tapping it opens “${hit.title}” ${where}.${only}`;
}
