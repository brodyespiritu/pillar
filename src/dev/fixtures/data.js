// DEV ONLY. The sample church the fixtures harness shows (`npm run dev:fixtures`, see vite.config.js):
// every table and app-server list the App section reads, filled with made-up content so each page can be
// opened at any window size without a real sign-in and without touching the church's Supabase project or
// its app server. Nothing in src/ outside src/dev/ may import this folder (tests/fixtures.test.mjs).
//
// Every person here is obviously invented ("Sample Speaker 2", "Test Member 4"). Never paste real
// members' names, photos or messages into this file. Pictures are picsum.photos placeholders.
//
// Knobs, read once from ?fx=… (comma-separated; remembered for this tab until ?fx= clears them):
//   empty    every list starts empty — for the empty states
//   slow     every call takes 2 s — for the "Loading…" and "Saving…" states
//   fail     every write is refused — for the error paths
//   nosetup  the tables a church may not have created yet answer "not in the schema cache" (PGRST205)

export const PILLAR_FIXTURES = 'pillar-fixtures';   // marker: a production bundle must never contain it

function readKnobs() {
  let raw = '';
  try {
    const q = new URLSearchParams(globalThis.location?.search || '');
    if (q.has('fx')) {
      raw = q.get('fx') || '';
      if (raw) globalThis.sessionStorage?.setItem('pillar.fx', raw);
      else globalThis.sessionStorage?.removeItem('pillar.fx');
    } else {
      raw = globalThis.sessionStorage?.getItem('pillar.fx') || '';
    }
  } catch { /* no storage here: the knobs stay off */ }
  const on = new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  return { raw, empty: on.has('empty'), slow: on.has('slow'), fail: on.has('fail'), nosetup: on.has('nosetup') };
}
export const FX = readKnobs();

/** A believable round trip: 80–250 ms (2 s with ?fx=slow), so "Saving…" states are visible. */
export const wait = (ms) => new Promise((r) => setTimeout(r, ms ?? (FX.slow ? 2000 : 80 + Math.floor(Math.random() * 170))));

/** A deep copy, so nothing a page does to what it was handed changes the store behind it. */
export const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/* ── dates, relative to today so "scheduled" and "ended" stay true whenever the harness runs ── */

const DAY = 86400000;
const NOW = new Date();
const churchDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
export const dayFrom = (n) => churchDay(new Date(NOW.getTime() + n * DAY));
const stamp = (n = 0) => new Date(NOW.getTime() + n * DAY).toISOString();
// the most recent Sunday (today when it is Sunday), then n weeks before it
const lastSunday = new Date(NOW.getTime() - NOW.getDay() * DAY);
const sunday = (weeksBack) => new Date(lastSunday.getTime() - weeksBack * 7 * DAY);
const pretty = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });   // "Sep 20, 2026"
const nextSunday = churchDay(new Date(lastSunday.getTime() + 7 * DAY));

/* ── pictures ── */

export const pic = (seed, w = 1200, h = 675) => `https://picsum.photos/seed/pillar-${seed}/${w}/${h}`;
// Blender Foundation open movies — public, so a YouTube link has a real picture to pull
const YT = ['aqz-KE-bpKQ', 'eRsGyueVLvQ', 'R6MlUcmOul8'];
const youtube = (i) => `https://www.youtube.com/watch?v=${YT[i % YT.length]}`;
const file = (name) => `https://media.example.org/${name}.mp4`;

// uuid-shaped ids for the Supabase rows, stable across reloads so a URL like ?for=<id> keeps working
const uid = (group, n) => `00000000-0000-4000-8000-${(group * 1000 + n).toString(16).padStart(12, '0')}`;

/* ── the app server (src/dev/fixtures/appApi.js) ── */

const SERMON_TITLES = [
  ['Built on the Rock', 'Foundations', 'Matthew 7:24'],
  ['When the Storm Comes', 'Foundations', 'Mark 4:39'],
  ['A Firm Place to Stand', 'Foundations', 'Psalm 40:2'],
  ['The Cornerstone', 'Foundations', 'Ephesians 2:20'],
  ['Faith for the Next Step', 'Walking in Faith', 'Hebrews 11:8'],
  ['Walking on Water', 'Walking in Faith', 'Matthew 14:29'],
  ['Trust in the Waiting', 'Walking in Faith', 'Isaiah 40:31'],
  ['The Long Obedience', 'Walking in Faith', 'Galatians 6:9'],
  ['The Lord Is My Shepherd', 'Summer Psalms', 'Psalm 23:1'],
  ['A Song for the Morning', 'Summer Psalms', 'Psalm 5:3'],
  ['Deep Calls to Deep', 'Summer Psalms', 'Psalm 42:7'],
  ['Grace That Finds Us', '', 'Luke 15:20'],
  ['Neighbors and Strangers', '', 'Luke 10:36'],
  ['Bread for the Journey', '', 'John 6:35'],
  ['The Light Has Come', '', 'John 1:5'],
  ['Living Generously', '', '2 Corinthians 9:7'],
  ['Rest for the Weary', '', 'Matthew 11:28'],
  ['A Welcome Table', '', 'Luke 14:13'],
  ['Hope That Holds', '', 'Romans 5:5'],
  ['Salt and Light', '', 'Matthew 5:13'],
  ['Every Good Gift', '', 'James 1:17'],
  ['Sent Out Together', '', 'Acts 13:3'],
];

const sermons = () => SERMON_TITLES.map(([title, series, verse], i) => {
  const d = sunday(i);
  const draft = i === 0 || i === 13 || i === 19;                 // this week's is still being put together
  return {
    id: String(1780000000100 + i),
    title,
    speaker: `Sample Speaker ${(i % 3) + 1}`,
    date: pretty(d),
    series,
    duration: `${34 + ((i * 7) % 18)} min`,
    thumbnailUrl: i === 6 ? '' : pic(`sermon-${i}`),             // a YouTube one with no picture yet
    thumbnailTallUrl: i % 4 === 1 ? pic(`sermon-tall-${i}`, 800, 1200) : '',
    videoLink: i % 3 === 0 ? youtube(i) : i === 7 ? '' : file(`sermons/sample-sermon-${String(i + 1).padStart(2, '0')}`),
    mainVerse: verse,
    notes: i % 2 ? '' : `Sample notes for “${title}”. Three points, one story, and a question to take home.`,
    published: !draft,
  };
});

const videos = () => [
  ['Choir Special: Sample Anthem', 'Sunday worship'],
  ['Baptism Sunday Highlights', 'Celebrating new life'],
  ['Missions Trip Recap', 'Sample team, summer trip'],
  ['Kids Choir: Fall Program', 'Children’s ministry'],
  ['Welcome to Our Church', 'A two-minute tour'],
  ['Behind the Scenes: Serve Day', 'Draft — not in the app yet'],
].map(([title, subtitle], i) => ({
  id: String(1781000000100 + i),
  title,
  subtitle,
  videoUrl: i === 1 ? youtube(1) : file(`videos/sample-video-${i + 1}`),
  thumbnail: pic(`video-${i}`),
  playInContainer: i !== 4,
  published: i !== 5,
}));

const resources = () => [
  ['Foundations Study Guide', 'Six weeks with the series', 'Study Guide'],
  ['Morning Devotional', 'A reading for every weekday', 'Devotional'],
  ['The Sample Church Podcast', 'Conversations after Sunday', 'Podcast'],
  ['Walking in Faith', 'The whole series in one place', 'Series'],
  ['New Here? Start with This', 'A short guide for visitors', 'Other'],
].map(([title, subtitle, type], i) => ({
  id: String(1782000000100 + i),
  title,
  subtitle,
  type,
  coverUrl: pic(`resource-${i}`, 800, 1000),
  link: `https://example.org/resources/sample-${i + 1}`,
  published: i !== 4,
}));

const announcements = () => [
  ['Fall Family Picnic', 'Bring a side dish and a lawn chair. Games for every age after the late service.', 'Event', `Sun, ${nextSunday}`],
  ['Wednesday Night Supper', 'Plates at 5:30, classes at 6:30. Reserve a plate in the app.', 'Dinner', 'Every Wed.'],
  ['Youth Lock-in', 'Sample Leader 2 is looking for four more drivers.', 'Youth', 'Fri 7 PM'],
  ['Serve Day Sign-ups', 'Yard work, meals and repairs for our neighbors. Pick a team at the Welcome Center.', 'Serve', 'Oct 10'],
  ['Choir Rehearsals Begin', 'All voices welcome — no audition.', 'Worship', 'Thursdays'],
  ['Missions Offering (draft)', 'Still being written.', 'Missions', ''],
].map(([title, body, tag, date], i) => ({ id: String(1783000000100 + i), title, body, tag, date, published: i !== 5 }));

const liveTemplates = () => [
  { id: '1784000000101', type: 'scripture', reference: 'John 3:16', text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.', note: 'Sample Speaker 1’s text this morning' },
  { id: '1784000000102', type: 'poll', question: 'Which service do you usually attend?', options: ['8:30 early', '11:00 late', 'Online'] },
  { id: '1784000000103', type: 'informative', title: 'Welcome, guests!', body: 'We’re glad you’re worshiping with us. Say hello in the chat.', buttonLabel: 'Give online', destination: 'Give' },
  { id: '1784000000104', type: 'scripture', reference: 'Psalm 23:1', text: 'The LORD is my shepherd; I shall not want.', note: '' },
];

const chat = () => [
  { id: 'c1', name: 'Test Member 1', text: 'Good morning from the balcony!' },
  { id: 'c2', name: 'Test Member 2', text: 'Watching from the hospital today — thank you for streaming.' },
  { id: 'c3', user: 'Guest', message: 'First time here. The music is beautiful.' },
  { id: 'c4', name: 'Test Member 3', text: 'Amen.' },
  { id: 'c5', name: 'Test Member 4', text: 'Could you share that verse again?' },
  { id: 'c6', user: 'Test Member 5', message: 'Praying for the families on the prayer list.' },
  // the newest two in the app server's own shape — { username, message, timestamp } — which is all the
  // member app reads, so the Live page's phone shows them as bubbles (the others try the chat pane's other shapes)
  { id: 'c7', username: 'Test Member 1', message: 'Sound is a little quiet on the stream.' },
  { id: 'c8', username: 'Test Member 6', message: 'See everyone Wednesday!' },
].map((m, i) => ({
  ...m, at: new Date(NOW.getTime() - (8 - i) * 60000).toISOString(),
  ...(m.username ? { timestamp: NOW.getTime() - (8 - i) * 60000 } : {}),
}));

/** Everything the app server keeps, fresh. */
export function serverSeed() {
  const s = sermons();
  const v = videos();
  const r = resources();
  const empty = FX.empty;
  return {
    livestream: { isLive: false, liveStreamUrl: 'https://example.org/live/sample-church', liveTitle: 'Sunday Morning Worship', liveNotes: 'Sample order of service: welcome, two songs, the reading, the message.' },
    sermons: empty ? [] : s,
    announcements: empty ? [] : announcements(),
    events: empty ? [] : [
      { id: '1785000000101', title: 'Fall Family Picnic', date: nextSunday, time: '12:30 PM', location: 'The lawn' },
      { id: '1785000000102', title: 'Wednesday Night Supper', date: dayFrom(7), time: '5:30 PM', location: 'Fellowship Hall' },
    ],
    mediaLayout: empty ? {} : { featuredSermonId: s[1].id, suggestedIds: [s[4].id, s[8].id, v[0].id], resourcesOrder: r.map((x) => x.id) },
    customBlocks: empty ? [] : v,
    resources: empty ? [] : r,
    liveTemplates: empty ? [] : liveTemplates(),
    liveCard: null,
    votes: {},
    chat: empty ? [] : chat(),
    pushCount: empty ? 0 : 214,
    sent: [],
    settings: { churchName: 'Sample Community Church', tagline: 'A place to belong (sample data)', heroImageUrl: pic('hero', 1600, 900), serviceTimes: 'Sundays 8:30 & 11:00' },
    pageBlocks: [],
    blocks: [
      { id: 'sermon', label: 'Latest sermon', enabled: true },
      { id: 'shortcuts', label: 'Shortcuts', enabled: true },
      { id: 'cards', label: 'Cards', enabled: true },
      { id: 'events', label: 'What’s happening', enabled: true },
    ],
    ministryCards: [],
  };
}

/* ── Supabase (src/dev/fixtures/supabase.js) ── */

export const FIXTURE_USER = {
  id: 'fixture-admin',
  email: 'preview.admin@example.org',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: { provider: 'email' },
  user_metadata: { name: 'Preview Admin' },
  created_at: stamp(-400),
};

const button = (label, action, target) => ({ label, action, ...(target ? { target } : {}) });

const homeCards = () => [
  { kind: 'image', audience: 'everyone', kicker: 'This Sunday', title: 'Fall Family Picnic', subtitle: 'After the late service, on the lawn', body: 'Bring a side dish and a lawn chair. Games for every age, and plenty of shade.', image_url: pic('card-picnic'), buttons: [button('Sign up', 'url', 'https://example.org/picnic'), button('Calendar', 'page', 'Calendar')] },
  { kind: 'video', audience: 'everyone', kicker: 'Watch', title: 'A Welcome from Sample Speaker 1', subtitle: 'Two minutes about who we are', body: null, image_url: pic('card-video'), video_url: file('videos/sample-welcome'), buttons: [button('Play', 'video')] },
  { kind: 'text', audience: 'signed_in', kicker: 'Members', title: 'Members’ Meeting', subtitle: 'Sunday evening, Fellowship Hall', body: 'We will vote on the sample budget and hear from the missions team. Childcare provided.', buttons: [button('Open the Calendar', 'page', 'Calendar')] },
  { kind: 'dinner', audience: 'everyone' },
  { kind: 'welcome', audience: 'signed_out' },
  { kind: 'image', audience: 'everyone', kicker: 'Coming up', title: 'Advent Choir Rehearsals', subtitle: 'Every Thursday in the choir room', body: null, image_url: pic('card-choir'), buttons: [], starts_on: dayFrom(7), ends_on: dayFrom(40) },
  { kind: 'text', audience: 'everyone', kicker: 'Thank you', title: 'Back-to-School Drive', subtitle: '312 backpacks for our neighbors', body: 'Thank you to every family that gave.', buttons: [], starts_on: dayFrom(-30), ends_on: dayFrom(-3) },
  { kind: 'image', audience: 'signed_out', kicker: 'Draft', title: 'Missions Week', subtitle: 'Still being written', body: null, image_url: pic('card-missions'), buttons: [], published: false },
].map((c, i) => ({
  id: uid(1, i + 1),
  kind: c.kind,
  audience: c.audience,
  kicker: c.kicker ?? null,
  title: c.title ?? null,
  subtitle: c.subtitle ?? null,
  body: c.body ?? null,
  image_url: c.image_url ?? null,
  video_url: c.video_url ?? null,
  buttons: c.buttons || [],
  starts_on: c.starts_on ?? null,
  ends_on: c.ends_on ?? null,
  published: c.published !== false,
  sort: (i + 1) * 10,
  created_at: stamp(-60 + i),
  updated_at: stamp(-2),
}));

const groups = () => [
  ['Children’s Ministry', 'Ministry', 'kids', 'Sundays 9:45 AM', 'Kids Wing', 'Ages 3–11'],
  ['Student Ministry', 'Ministry', 'youth', 'Wednesdays 6:30 PM', 'Youth Room', 'Grades 6–12'],
  ['College & Young Adults', 'Small Group', 'college', 'Tuesdays 7 PM', 'A sample home', 'Ages 18–29'],
  ['Women’s Bible Study', 'Class', 'women', 'Thursdays 10 AM', 'Room 204', 'Women of every age'],
  ['Men’s Breakfast', 'Small Group', 'men', 'Second Saturday, 8 AM', 'Fellowship Hall', 'Men'],
  ['Adult Sunday School', 'Sunday School', '', 'Sundays 9:45 AM', 'Room 110', 'Adults'],
  ['Worship Team', 'Team', '', 'Thursdays 7 PM', 'Sanctuary', 'Singers and players'],
  ['Missions Team', 'Team', '', 'Monthly', 'Room 118', 'Anyone who wants to go'],
].map(([name, kind, filter_key, meets, location, audience], i) => ({
  id: uid(2, i + 1),
  name,
  kind,
  about: `${name} (sample). A friendly group that meets ${meets.toLowerCase()} — come as you are.`,
  meets,
  location,
  audience,
  leaders: [{ name: `Sample Leader ${i + 1}`, role: i % 2 ? 'Leader' : 'Director' }, ...(i % 3 === 0 ? [{ name: `Test Member ${i + 10}`, role: 'Helper' }] : [])],
  filter_key: filter_key || null,
  published: i !== 7,
  sort: (i + 1) * 10,
  created_at: stamp(-200 + i),
  updated_at: stamp(-5),
}));

const groupPosts = (g) => [
  [0, 'Volunteers for the nursery', 'Two more helpers on the second Sunday of each month.', 'Sign up', 'https://example.org/serve/nursery'],
  [1, 'Lock-in this Friday', 'Pizza, games and a late-night talk. Permission slips at the youth desk.', null, null],
  [1, 'Fall retreat deposits due', '$50 holds a spot.', 'Pay online', 'https://example.org/retreat', { ends_on: dayFrom(-2) }],
  [2, 'New study starts Tuesday', 'We are reading through a sample book together.', null, null, { starts_on: dayFrom(5) }],
  [3, 'Childcare available', 'Let us know by Tuesday so we have enough helpers.', null, null],
  [4, 'Breakfast menu (draft)', 'Pancakes, eggs, sausage.', null, null, { published: false }],
  [5, 'Class moves to Room 112', 'Just for this month while the carpet is replaced.', null, null],
  [6, 'Extra rehearsal for Advent', 'Bring your folder.', null, null, { starts_on: dayFrom(-1), ends_on: dayFrom(20) }],
  [null, 'Church-wide work day', 'Every group is invited — gloves and lunch provided.', 'Details', 'https://example.org/work-day'],
  [null, 'Photo directory sign-ups', 'Sample photographer here the first two Sundays.', null, null, { published: false }],
].map(([gi, title, body, button_label, button_url, extra = {}], i) => ({
  id: uid(3, i + 1),
  group_id: gi == null ? null : g[gi].id,
  title,
  body,
  button_label,
  button_url,
  starts_on: extra.starts_on ?? null,
  ends_on: extra.ends_on ?? null,
  published: extra.published !== false,
  sort: 0,
  created_at: stamp(-20 + i),
  updated_at: stamp(-1),
}));

const series = (s, v) => [
  { name: 'Foundations', subtitle: 'Four weeks on what holds us up', image_url: pic('series-foundations', 1600, 900), items: [s[0], s[1], s[2], s[3]].map((x) => ({ id: x.id, kind: 'sermon' })).concat({ id: v[0].id, kind: 'video' }), published: true },
  { name: 'Walking in Faith', subtitle: 'Hebrews 11 and the people in it', image_url: pic('series-faith', 1600, 900), items: [s[4], s[5], s[6]].map((x) => ({ id: x.id, kind: 'sermon' })), published: true },
  // a draft with one item whose sermon has since been deleted on the app server
  { name: 'Summer Psalms', subtitle: null, image_url: null, items: [{ id: s[8].id, kind: 'sermon' }, { id: s[9].id, kind: 'sermon' }, { id: '1770000000999', kind: 'sermon' }], published: false },
].map((r, i) => ({ id: uid(4, i + 1), ...r, sort: (i + 1) * 10, created_at: stamp(-90 + i), updated_at: stamp(-3) }));

const sheets = (s) => [
  { title: s[1].title, speaker: s[1].speaker, passage: 'Mark 4:35–41', on_date: churchDay(sunday(1)), video_url: null, sermon_id: s[1].id, published: true,
    body: 'The storm was ___, but Jesus was ___.\n\n1. Storms come to ___ people.\n2. Fear asks, “Don’t you ___?”\n3. Faith answers with ___.\n\nThis week: name one storm and pray about it every ___.' },
  { title: 'Built on the Rock', speaker: s[0].speaker, passage: 'Matthew 7:24–27', on_date: churchDay(sunday(0)), video_url: null, sermon_id: null, published: false,
    body: 'Two builders, two ___.\n\nThe wise builder ___ and ___.' },
  { title: 'A Firm Place to Stand', speaker: s[2].speaker, passage: 'Psalm 40:1–3', on_date: churchDay(sunday(2)), video_url: file('sermons/sample-sermon-03'), sermon_id: s[2].id, published: true,
    body: 'I waited ___ for the LORD.\n\nHe set my feet upon a ___.' },
].map((r, i) => ({ id: uid(5, i + 1), ...r, sort: 10 * (i + 1), created_at: stamp(-10 + i), updated_at: stamp(-1) }));

const slides = () => Array.from({ length: 8 }, (_, i) => ({
  id: uid(6, i + 1),
  image_url: pic(`slide-${i}`, 1600, 900),
  caption: [
    'Welcome! Sample Community Church',
    'Fall Family Picnic — this Sunday',
    'Wednesday Night Supper, 5:30',
    'Serve Day sign-ups at the Welcome Center',
    'Youth Lock-in Friday',
    'Choir rehearsals Thursdays',
    null,
    'Missions Week (draft)',
  ][i],
  on_date: i < 6 ? nextSunday : null,
  published: i < 6,
  sort: (i + 1) * 10,
  created_at: stamp(-7 + i),
  updated_at: stamp(-1),
}));

/** Every table the harness knows, fresh. Tables not listed here start empty. */
export function tableSeed() {
  const s = sermons();
  const v = videos();
  const g = groups();
  const empty = FX.empty;
  const staff = [
    { id: FIXTURE_USER.id, name: 'Preview Admin', email: FIXTURE_USER.email, role: 'Admin', title: 'Office (sample)', phone: null,
      onboarded: true, active: true, permissions: {}, preferences: {}, invite_code: null, created_at: stamp(-400) },
    { id: 'fixture-staff-2', name: 'Sample Staff 2', email: 'sample.staff2@example.org', role: 'Staff', title: 'Youth (sample)', phone: null,
      onboarded: true, active: true, permissions: {}, preferences: {}, invite_code: null, created_at: stamp(-300) },
  ];
  if (empty) return { staff, app_refresh: [{ part: 'home', changed_at: stamp(0) }] };
  return {
    staff,
    app_home_cards: homeCards(),
    app_home_tiles: [
      { slot: 'post', title: null, subtitle: 'Photos from Sunday’s picnic', image_url: pic('tile-post'), updated_at: stamp(-4) },
      { slot: 'connect', title: 'Connect', subtitle: null, image_url: null, updated_at: stamp(-9) },
    ],
    app_media_series: series(s, v),
    app_media_featured: [
      { item_id: s[2].id, kind: 'sermon', sort: 10, updated_at: stamp(-2) },
      { item_id: v[0].id, kind: 'video', sort: 20, updated_at: stamp(-2) },
    ],
    app_sermon_notes: sheets(s),
    app_bulletin_slides: slides(),
    church_groups: g,
    group_posts: groupPosts(g),
    // the update popup (TESTING — Pillar → App → Notifications → Update popup): one up, one taken down
    app_test_popups: [
      { id: 'fixture-popup-1', title: 'Recent updates (sample)', live: true, created_at: stamp(-1), posted_at: stamp(-1), taken_down_at: null,
        body: { v: 1, blocks: [
          { t: 'p', s: [{ x: 'Here’s what changed in this test build:' }] },
          { t: 'bullet', s: [{ x: 'My Profile', b: 1 }, { x: ' is simpler to find your way around' }] },
          { t: 'bullet', s: [{ x: 'Sheets now slide up ' }, { x: 'smoothly', i: 1 }] },
          { t: 'dash', s: [{ x: 'Sample text, not a real announcement', u: 1 }] },
        ] } },
      { id: 'fixture-popup-0', title: 'Welcome, testers (sample)', live: false, created_at: stamp(-5), posted_at: stamp(-5), taken_down_at: stamp(-1),
        body: { v: 1, blocks: [{ t: 'p', s: [{ x: 'Thanks for testing the app. Report anything that feels wrong with the orange circle.' }] }] } },
    ],
    app_update_notice: [
      { platform: 'ios', active: true, min_build: 16, link: 'itms-beta://', message: null, updated_at: stamp(-6) },
      { platform: 'android', active: false, min_build: null, link: null, message: null, updated_at: stamp(-6) },
    ],
    app_page_headers: [
      { page: 'home', image_url: pic('header-home', 1600, 900), updated_at: stamp(-12) },
      { page: 'groups', image_url: pic('header-groups', 1600, 900), updated_at: stamp(-12) },
    ],
    app_refresh: [{ part: 'home', changed_at: stamp(0) }],
  };
}
