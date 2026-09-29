import { supabase } from './supabase';

// "Update needed" (supabase/app-update-notice.sql, 2026-09-23). While a platform's row is on, a phone on
// an older build than `min_build` gets a card it can't close, whose one button opens `link`.

export const APP_STORE_ID = '6784403023';                   // App Store Connect: Bethesda Online
export const ANDROID_PACKAGE = 'com.bethesdabaptist.app';

export const PLATFORMS = [
  {
    key: 'ios', label: 'iPhone',
    // while testing, TestFlight is where an iPhone gets a new build; after launch, the App Store
    // (`short` + `when`: the pill's own word and when it applies — Settings draws the pill short and
    // says the when once underneath, so both pills fit beside the phone preview)
    presets: [
      { key: 'testflight', label: 'TestFlight (testing)', short: 'TestFlight', when: 'while testing', link: 'itms-beta://' },
      { key: 'store', label: 'App Store (after launch)', short: 'App Store', when: 'after launch', link: `itms-apps://apps.apple.com/app/id${APP_STORE_ID}` },
    ],
    // (user, 2026-09-23: "I dont see the card on the app" — they were on build 15 with 15 set. Say plainly
    // that the newest build never sees it, and when it's safe to raise the number.)
    buildHint: 'The newest build in TestFlight — 1.0.0 (15) is build 15. Phones already on it never see the card. Raise this only once the new build is in TestFlight, or everyone is asked to update to a build that isn’t there.',
  },
  {
    key: 'android', label: 'Android',
    // while testing, the newest APK file; after launch, the Play Store
    presets: [
      { key: 'apk', label: 'The newest APK (testing)', short: 'Newest APK', when: 'while testing', link: '' },
      { key: 'store', label: 'Play Store (after launch)', short: 'Play Store', when: 'after launch', link: `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}` },
    ],
    buildHint: 'The newest Android file’s build number (its version code, shown on its Expo page). Phones already on it never see the card.',
  },
];

/**
 * Which of a platform's presets a link is, so its pill lights up — the APK's too, whose preset has no
 * fixed link (it's a new file every build), so matching the preset's own link could never pick it
 * (Pillar redesign, 2026-09-23). Read from the link itself: TestFlight and the App Store by their
 * schemes (or an apps.apple.com page), the Play Store by market:// or play.google.com; on Android
 * anything else — an APK's download link, or nothing yet — is the newest APK. '' when none fits
 * (an iPhone link that's neither).
 */
export function presetFor(platform, link) {
  const pl = PLATFORMS.find((p) => p.key === platform);
  if (!pl) return '';
  const l = String(link || '').trim();
  const exact = pl.presets.find((p) => p.link && p.link === l);
  if (exact) return exact.key;
  if (platform === 'ios') {
    if (/^itms-beta:/i.test(l)) return 'testflight';
    if (/^itms-apps:/i.test(l) || /^https:\/\/apps\.apple\.com\//i.test(l)) return 'store';
    return '';
  }
  if (/^market:/i.test(l) || /^https:\/\/play\.google\.com\//i.test(l)) return 'store';
  return 'apk';
}

/** Who the card reaches, in words: "Phones on build 14 or older see the card. Build 15 doesn't." */
export function whoSees(minBuild) {
  const n = Number(String(minBuild || '').trim());
  if (!Number.isInteger(n) || n < 1) return 'Say which build is the newest.';
  if (n === 1) return 'No build is older than 1, so nobody sees the card.';
  return `Phones on build ${n - 1} or older see the card. Build ${n} is up to date, so it doesn’t.`;
}

export const MESSAGE_MAX = 200;
export const DEFAULT_MESSAGE = 'A newer version of the Bethesda app is ready. Update to keep using it.';
// TestFlight opens with nothing after its scheme (itms-beta://); the others need an address
const LINK = /^(itms-beta:\/\/[^\s]*|(https|itms-apps|market):\/\/[^\s]+)$/;

export const blankNotice = () => ({ active: false, min_build: '', link: '', message: '' });

/**
 * The table isn't there yet — app-update-notice.sql hasn't been run (Postgres 42P01, PostgREST
 * PGRST205 "…in the schema cache"). Only that: an error that merely NAMES the table ("permission
 * denied for table app_update_notice", 42501) is a real failure, which Settings shows with Try again —
 * telling the office to run the SQL again would send them the wrong way (Pillar review, 2026-09-23).
 */
export const tableMissing = (error) => !!error && (error.code === '42P01' || error.code === 'PGRST205'
  || /does not exist|schema cache/i.test(String(error.message || '')));

/** { ios: {…}, android: {…} }; null when app-update-notice.sql hasn't been run. */
export async function listNotices() {
  const { data, error } = await supabase.from('app_update_notice').select('platform,active,min_build,link,message');
  if (error) {
    if (tableMissing(error)) return null;
    throw error;
  }
  const out = { ios: blankNotice(), android: blankNotice() };
  for (const r of data || []) {
    if (!out[r.platform]) continue;
    out[r.platform] = { active: !!r.active, min_build: r.min_build ? String(r.min_build) : '', link: r.link || '', message: r.message || '' };
  }
  return out;
}

/** What's wrong with it, as the office would say it. Empty: it can be saved. */
export function noticeProblems(n) {
  const out = [];
  const build = String(n.min_build || '').trim();
  const link = String(n.link || '').trim();
  if (build && !/^\d+$/.test(build)) out.push('The build number is a whole number, like 16.');
  if (build && (+build < 1 || +build > 100000)) out.push('That build number isn’t one the app has.');
  if (link && !LINK.test(link)) out.push('The link has to be a web address (https://…) or a store or TestFlight link.');
  if (String(n.message || '').length > MESSAGE_MAX) out.push(`The message has to be ${MESSAGE_MAX} characters or fewer.`);
  if (n.active && !build) out.push('Say which build is the newest before switching it on.');
  if (n.active && !link) out.push('Say where the button goes before switching it on.');
  return out;
}

/** Save one platform's notice. */
export async function saveNotice(platform, n) {
  const row = {
    platform,
    active: !!n.active,
    min_build: String(n.min_build || '').trim() ? Number(n.min_build) : null,
    link: String(n.link || '').trim() || null,
    message: String(n.message || '').trim() || null,
  };
  const { error } = await supabase.from('app_update_notice').upsert(row, { onConflict: 'platform' });
  if (error) throw error;
}
