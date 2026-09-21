/*
 * Website content client — the public website's editable copy and imagery.
 *
 * Reads/writes `website_content` (one JSONB row per page) and uploads to the
 * public `website-images` bucket. Run supabase-website-content.sql once before
 * using this.
 *
 * Deliberately NOT on the Render admin API that src/lib/appApi.js uses: that
 * server 401s every write and no key has been issued, so edits would vanish.
 * This path is the same one the live site already reads events and locations
 * through, so a save here is visible on the website on its next load.
 */
import { supabase } from './supabase';

export const BUCKET = 'website-images';

/*
 * Where the public website is served from. Image paths in HOME_DEFAULTS are
 * site-relative (that is what the website itself uses), so Pillar — running on
 * a different origin — needs this to render a preview of them. Uploaded images
 * are absolute Supabase URLs and pass through untouched.
 *
 * TO FILL IN: set VITE_WEBSITE_BASE to the production domain once one exists.
 * Until then previews only resolve while the local site server is running.
 */
export const SITE_BASE = (import.meta.env.VITE_WEBSITE_BASE || 'http://localhost:8000').replace(/\/$/, '');

/** Absolute URLs pass through; site-relative ones resolve against SITE_BASE. */
export const resolveUrl = u =>
  !u ? '' : /^(https?:)?\/\//.test(u) ? u : `${SITE_BASE}/${String(u).replace(/^\//, '')}`;

/* ── Defaults ──────────────────────────────────────────────────────────────
 * These mirror what index.html ships with today. The editor loads them when a
 * field has never been saved, so the form always shows the live copy rather
 * than blanks, and the website falls back to its own markup for anything the
 * church has not overridden.
 *
 * KEEP IN STEP with website/index.html. If a section is reworded there and not
 * here, the editor will show the church stale text and a save would silently
 * revert the site to it. */
export const HOME_DEFAULTS = {
  hero: {
    image: 'assets/hero.jpg',
    focus: '46%',                    // background-position Y — the crop
    words: ['every', 'your', 'every'],
    tail: 'life matters',
    times: 'Join us Sunday at 8:30 AM & 10:30 AM',
    address: '3830 GA HWY 85, Ellerslie, GA 31807',
    ctaLabel: 'New to Bethesda?',
    ctaHref: 'new-here.html',
  },
  intro: {
    kicker: 'Welcome to Bethesda',
    statement: 'Rooted in the heart of Ellerslie, Georgia, we are a church family where every life matters! Gathering each week to',
    highlight: 'grow with God and one another.',
    image: 'assets/mainhero.jpg',
    buttons: [
      { label: 'Visit', href: 'visit.html' },
      { label: 'About Us', href: 'about.html' },
    ],
  },
  /* Weekly Activities — three cards, fixed by the website's own markup. This is
     not a list the church adds to; editing one means changing what it says, not
     how many there are. KEEP IN STEP with the section in index.html. */
  ministries: {
    lead: 'Grow in your faith, and enjoy the care that happens in Christ-centered, authentic community.',
    cards: [
      { title: 'Worship Service', when: 'Sundays at 8:30 & 10:30 AM',
        body: "Music and a message from God's Word, with the whole church family together.",
        label: 'Learn More', href: 'visit.html', image: 'assets/slide/FA5A3890.jpg' },
      { title: 'Connect Groups', when: 'Sundays at 9:30 AM',
        body: 'Classes by life stage, digging into the Scriptures together before the service.',
        label: 'Learn More', href: 'groups.html', image: 'assets/slide/FA5A4003.jpg' },
      { title: 'Midweek Connection', when: 'Wednesdays at 5:30 PM',
        body: 'Dinner in the Family-Life Center, then small groups for every age.',
        label: 'Learn More', href: 'calendar.html', image: 'assets/slide/FA5A2737.jpg' },
    ],
  },
  /* The sliding photo strip, in the order the site plays them: the website
     interleaves a wide frame and a tall one, and this preserves that rhythm.
     Removing one here removes it from the site. */
  strip: {
    photos: [
      { url: 'assets/slide/DSC01237.jpg', orientation: 'land' },
      { url: 'assets/slide/DSC00263.jpg', orientation: 'port' },
      { url: 'assets/slide/DSC01654.jpg', orientation: 'land' },
      { url: 'assets/slide/baptism.jpg', orientation: 'port' },
      { url: 'assets/slide/FA5A2737.jpg', orientation: 'land' },
      { url: 'assets/slide/DSC00317.jpg', orientation: 'port' },
      { url: 'assets/slide/FA5A3497.jpg', orientation: 'land' },
      { url: 'assets/slide/DSC00954.jpg', orientation: 'port' },
      { url: 'assets/slide/FA5A3890.jpg', orientation: 'land' },
      { url: 'assets/slide/DSC01250.jpg', orientation: 'port' },
      { url: 'assets/slide/FA5A3975.jpg', orientation: 'land' },
      { url: 'assets/slide/FA5A3076.jpg', orientation: 'port' },
      { url: 'assets/slide/FA5A4003.jpg', orientation: 'port' },
    ],
  },
};

/* ── Calendar page ─────────────────────────────────────────────────────────
 * KEEP IN STEP with website/calendar.html, the same way HOME_DEFAULTS tracks
 * index.html. Only the copy and the banner photo are here: the week stepper,
 * the event rows and the ministry list are built from live calendar data, so
 * there is nothing in them for anyone to type. */
export const CALENDAR_DEFAULTS = {
  hero: {
    image: 'assets/calendarhero.jpg',
    focus: '38%',                       // background-position Y — the crop
    title: 'Explore The Calendar',
  },
  week: {
    eyebrow: "What's Happening",
    heading: "What's on at Bethesda",
  },
  subs: {
    eyebrow: 'Stay Connected',
    heading: 'Subscribe to Ministry Calendars',
    lead: "Get a ministry's events sent to you as they are added.",
  },
};

/* One defaults object per page. getPageContent merged EVERY page over
 * HOME_DEFAULTS before this existed, so asking for the calendar handed back the
 * home page's hero and tiles. */
const DEFAULTS = { home: HOME_DEFAULTS, calendar: CALENDAR_DEFAULTS };

/** Deep-merge saved content over the defaults so a partial save stays valid. */
function withDefaults(saved, defaults) {
  const out = Array.isArray(defaults) ? [...defaults] : { ...defaults };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved)) {
    const d = out[k];
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && d && typeof d === 'object' && !Array.isArray(d))
      ? withDefaults(v, d)
      : v;
  }
  return out;
}

/* The activity cards are the one list whose length the church does not own —
 * there are three slots in the website's markup and that is the shape. Without
 * this, a row saved under the old four-tile section renders the wrong number of
 * fields forever: the form maps over the saved array, and an array in
 * withDefaults replaces rather than merges. Deliberately NOT applied to
 * strip.photos, which IS a free list — the church adds and removes those, and a
 * deletion has to stick. */
function normaliseCards(content) {
  const defs = HOME_DEFAULTS.ministries.cards;
  const saved = content?.ministries?.cards;
  if (Array.isArray(saved) && saved.length === defs.length) return content;
  return {
    ...content,
    ministries: {
      ...content.ministries,
      // Pair by title where we can, else fall back to the default. NOT by
      // position across a length change — that hands a card the previous
      // occupant's photo and link.
      cards: defs.map(d => ({
        ...d,
        ...((Array.isArray(saved) && saved.find(c => c?.title === d.title)) || {}),
      })),
    },
  };
}

/** Load one page's content, already merged over its defaults. */
export async function getPageContent(page = 'home') {
  const { data, error } = await supabase
    .from('website_content').select('content, updated_at').eq('page', page).maybeSingle();
  if (error) return { error: friendly(error) };
  return {
    content: page === 'home'
      ? normaliseCards(withDefaults(data?.content || {}, HOME_DEFAULTS))
      : withDefaults(data?.content || {}, DEFAULTS[page] || {}),
    updatedAt: data?.updated_at || null,
  };
}

/** Save one page's content. Upsert, so the row need not exist yet. */
export async function savePageContent(page, content) {
  const { error } = await supabase
    .from('website_content')
    .upsert({ page, content }, { onConflict: 'page' });
  return error ? { error: friendly(error) } : { ok: true };
}

function friendly(error) {
  const m = String(error?.message || error);
  if (/relation .*website_content.* does not exist/i.test(m))
    return 'The website_content table has not been created yet — run supabase-website-content.sql in the Supabase SQL editor.';
  if (/row-level security/i.test(m))
    return 'Not allowed to save. Sign in to Pillar, and check the RLS policies from supabase-website-content.sql are applied.';
  if (/Bucket not found/i.test(m))
    return 'The website-images bucket is missing — run supabase-website-content.sql in the Supabase SQL editor.';
  return m;
}

/* ── Image upload ──────────────────────────────────────────────────────────
 * Same approach as uploadLocationPhoto: downscale in the browser first. A
 * phone photo is often 4-8MB, which is slow on the website and pointless at
 * the sizes these slots render, so cap the long edge and re-encode as JPEG. */
function downscaleImage(file, maxEdge = 2400, quality = 0.84) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image Pillar can read.'));
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          blob => blob ? resolve({ blob, width: w, height: h }) : reject(new Error('Could not process that image.')),
          'image/jpeg', quality,
        );
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const slug = s => String(s || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Downscale, upload to the public bucket, return { url, width, height, size }.
 * `label` only shapes the filename, so a human can recognise it in Storage.
 */
export async function uploadWebsiteImage(file, label = 'image') {
  if (!file) return { error: 'No file chosen.' };
  if (!/^image\//.test(file.type)) return { error: 'That file is not an image.' };
  let shrunk;
  try { shrunk = await downscaleImage(file); }
  catch (e) { return { error: e.message }; }

  // unique path per upload, so replacing a photo is never served from cache
  const path = `${slug(label)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, shrunk.blob, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' });
  if (error) return { error: friendly(error) };

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path, width: shrunk.width, height: shrunk.height, size: shrunk.blob.size };
}

/** Remove an uploaded file. Only call for images nothing references any more. */
export async function deleteWebsiteImage(path) {
  if (!path) return { ok: true };
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  return error ? { error: friendly(error) } : { ok: true };
}

/** The pages the Website module can edit. Home is built; the rest are next. */
export const WEBSITE_PAGES = [
  { key: 'home',     name: 'Home',        file: 'index.html',    ready: true },
  { key: 'calendar', name: 'Calendar',    file: 'calendar.html', ready: true },
  { key: 'about',    name: 'About',       file: 'about.html',    ready: false },
  { key: 'newhere',  name: 'New Here',    file: 'new-here.html', ready: false },
  { key: 'team',     name: 'Our Team',    file: 'team.html',     ready: false },
  { key: 'give',     name: 'Give',        file: 'give.html',     ready: false },
  { key: 'daycare',  name: 'Child Care',  file: 'daycare.html',  ready: false },
];
