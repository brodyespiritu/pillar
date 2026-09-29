import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import { getSettings, putSettings, checkAppApiKey, setAppApiAuth, hasAppApiAuth, uploadImage, getSermons } from '../../lib/appApi';
import { useAutosave, SaveState, Field, Alert, Loading, Seg, Toggle, useUndo, useLeaveGuard } from './kit';
import { Pane, Section, Fields, PhoneFrame, PhoneIcon, HotkeyHint, useHotkeys } from './layout';
import { PLATFORMS, MESSAGE_MAX, DEFAULT_MESSAGE, listNotices, noticeProblems, saveNotice, whoSees, presetFor } from '../../lib/updateNotice';
import { PAGES, listPageHeaders, setPageHeader } from '../../lib/pageHeaders';
import { uploadCardImage } from '../../lib/homeCards';
import { listTiles } from '../../lib/homeTiles';
import { youtubeThumbs } from '../../lib/youtube';

// App → Settings: asking older versions to update, the photos at the top of the app's pages, whether
// Pillar can reach the app server, and the few settings the church website borrows from it (its name,
// tagline and picture). The app itself reads none of those last three — its Home is built in, with the
// cards chosen in App → Home.
//
// Redesign (2026-09-23, Pillar-backups/redesign/DESIGN.md §4; the approved mockup's Settings board —
// "all on one screen" at 1440 × 900): two rows of panes instead of one 880px column of four (~2,400px
// of scrolling beside empty width — horizontal first):
//   · row 1, Update needed: an iPhone pane and an Android pane side by side, each phone BESIDE its
//     fields (proximity), drawn exactly as the app draws the card (BethesdaApp components/UpdateNeeded.js)
//     over the app's Home as it is today — its photo, its newest sermon, its shortcut words.
//   · row 2, Page photos beside the church website and the connection (common region). Each photo is
//     previewed as the top of that page in the app, and the phone is where a photo is dropped (Fitts:
//     the biggest target is the thing itself). The website and the connection are rarely touched, so
//     they fold (Hick's law) — the website starts open, the connection closed.
//   · Only what's needed now is on show (Miller): the long "newest build" advice appears while that box
//     is being typed in; the rarely used address and remove controls are icons with their words.
//   · Switches take effect at once, and Off always does — even while an edit elsewhere can't be saved.
//   · ⌘/Ctrl+S saves everything that's waiting, at once (Tesler). Everything saves as you type anyway.

const SCHEMES = [
  { key: 'bearer', label: 'Authorization: Bearer', header: 'Authorization', prefix: 'Bearer ' },
  { key: 'apikey', label: 'x-api-key', header: 'x-api-key', prefix: '' },
];
const siteForm = (s) => ({ churchName: s?.churchName || '', tagline: s?.tagline || '', heroImageUrl: s?.heroImageUrl || '' });
// the database takes only secure picture addresses (supabase/app-page-headers.sql)
const HTTPS = /^https:\/\/[^\s]+$/i;
// a picture uploaded to Pillar's own storage — nothing anyone would want to retype
const STORED = /^https:\/\/[^/]*(supabase\.co|storage\.googleapis\.com)\//;
// a picture as a background, with nothing in its address that could break out of url("…")
const pictureOf = (u) => (u ? { backgroundImage: `url("${String(u).replace(/["\\\n]/g, encodeURIComponent)}")` } : undefined);

/** The newest sermon members can see — the one on Home's big card (the same pick as HomePage.jsx). */
function latestSermon(list) {
  const shown = (Array.isArray(list) ? list : []).filter((s) => s && s.published !== false && String(s.title || '').trim());
  const when = (s) => { const t = Date.parse(s.date || ''); return Number.isFinite(t) ? t : -Infinity; };
  const best = shown.reduce((a, s) => (!a || when(s) > when(a) ? s : a), null);
  if (!best) return null;
  return { title: String(best.title).trim(), picture: best.thumbnailUrl || youtubeThumbs(best.videoLink)?.hq || '' };
}
/** The office's words for Home's round shortcuts (App → Home → Shortcuts), by slot; blank = the app's. */
function wordsOf(rows) {
  const out = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    const w = String(r?.title || '').trim();
    if (r?.slot && w) out[r.slot] = w;
  }
  return out;
}

// What the panes share: the page photos (Home's also sits under the Update needed card — read once,
// Doherty), the rest of Home that card sits over, ⌘S's list of things to save now, the app server's
// one-at-a-time queue, and the Undo toast.
const Ctx = createContext({
  photos: undefined, setPhotos: () => {}, photoError: '', loadPhotos: () => {}, home: { sermon: null, words: {} },
  onSave: () => () => {}, saveAll: async () => {}, serial: (fn) => Promise.resolve().then(fn), undo: () => {},
});

/** Run `fn` on ⌘/Ctrl+S (and before a connection test), for as long as this part is on the page. */
function useSaveNow(fn) {
  const { onSave } = useContext(Ctx);
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => onSave(() => (latest.current ? latest.current() : undefined)), [onSave]);
}

/** A load that failed, with the way to try again (never a dead end — the app server can be asleep). */
function Problem({ children, onRetry }) {
  if (!children) return null;
  return (
    <div className="ax-alert" role="alert">
      <span>{children}</span>
      {onRetry ? <button type="button" className="ax-set-retry" onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

/** Words only a screen reader says — an icon button's name (and what the tests find it by). */
const Said = ({ children }) => <span className="ax-set-sr">{children}</span>;

export default function SettingsPage() {
  const [photos, setPhotos] = useState(undefined);   // undefined: reading; null: not set up yet
  const [photoError, setPhotoError] = useState('');
  const loadPhotos = useCallback(() => {
    setPhotoError('');
    listPageHeaders().then(setPhotos)
      .catch((e) => { setPhotos((p) => p || {}); setPhotoError(e.message || 'Couldn’t read the page photos.'); });
  }, []);
  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  // the rest of the Home the Update needed card sits over, read once and only read: the newest sermon
  // (Watch) and the office's shortcut words (Home → Shortcuts). Either failing leaves the app's own.
  const [home, setHome] = useState({ sermon: null, words: {} });
  useEffect(() => {
    let alive = true;
    const settle = (read, put) => Promise.resolve().then(read).then((v) => { if (alive) setHome((h) => put(h, v)); }, () => {});
    settle(getSermons, (h, list) => ({ ...h, sermon: latestSermon(list) }));
    settle(listTiles, (h, rows) => ({ ...h, words: wordsOf(rows) }));
    return () => { alive = false; };
  }, []);

  const savers = useRef(new Set());
  const onSave = useCallback((fn) => { savers.current.add(fn); return () => { savers.current.delete(fn); }; }, []);
  const saveAll = useCallback(() => Promise.all([...savers.current].map((fn) => Promise.resolve().then(fn).catch(() => {}))), []);
  useHotkeys({ 'mod+s': () => { saveAll(); } });
  const [toast, undo] = useUndo();

  // The app server keeps its settings as one document, written whole. The website's saves and the
  // connection test (which reads it and writes it straight back) take turns here, so a test can never
  // write back what a save is still replacing.
  const queue = useRef(Promise.resolve());
  const serial = useCallback((fn) => {
    const run = queue.current.then(fn, fn);
    queue.current = run.catch(() => {});
    return run;
  }, []);

  const ctx = useMemo(() => ({ photos, setPhotos, photoError, loadPhotos, home, onSave, saveAll, serial, undo }),
    [photos, photoError, loadPhotos, home, onSave, saveAll, serial, undo]);

  return (
    <AppShell title="Settings"
      subtitle="Asking older versions to update, the photos at the top of the app’s pages, the connection to the app server, and what the church website borrows from it."
      actions={<HotkeyHint keys={['mod+s']} />}>
      <Ctx.Provider value={ctx}>
        <div className="ax-set">
          <UpdateNeeded />
          <PagePhotos />
          <Pane className="ax-set-pane ax-set-more" aria-label="Church website and connection">
            <Website />
            <Connection />
          </Pane>
        </div>
      </Ctx.Provider>
      {toast}
    </AppShell>
  );
}

/* ─────────────────────────────── Update needed ─────────────────────────────── */

// "Update needed" (user, 2026-09-23: "the ability to post a 'Update Needed' card (just like the give
// popup) that forces the user to click a button and it directs them … to update the app"). One per
// platform: switch it on, say which build is the newest, and where the button goes. Phones on an
// older build get a card they can't close; phones on that build or newer never see it.
function UpdateNeeded() {
  const [notices, setNotices] = useState(undefined);   // undefined: reading; null: not set up yet
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    setNotices(undefined);
    // a table that isn't there is null (listNotices); anything else is a failure to read, with a retry —
    // not "run the SQL", which it isn't
    listNotices().then(setNotices).catch((e) => setError(e.message || 'Couldn’t read it.'));
  }, []);
  useEffect(() => { load(); }, [load]);
  const ready = !error && notices;
  return (
    <div className="ax-set-update" role="group" aria-label="Update needed">
      {ready ? PLATFORMS.map((pl) => <UpdatePlatform key={pl.key} platform={pl} initial={notices[pl.key]} />) : (
        <Pane label="Update needed" className="ax-set-pane ax-set-wait"
          right={<span className="ax-set-right">Ask everyone on an older version to update</span>}>
          {error ? <Problem onRetry={load}>{error}</Problem>
            : notices === undefined ? <Loading>Reading…</Loading>
            : <Alert>Run supabase/app-update-notice.sql in Supabase (SQL Editor) to turn this on.</Alert>}
        </Pane>
      )}
    </div>
  );
}

function UpdatePlatform({ platform, initial }) {
  const [f, setF] = useState(initial);
  const [savedJson, setSavedJson] = useState(JSON.stringify(initial));
  const savedRef = useRef(JSON.stringify(initial));   // the row the database has, as of the last write
  const [tried, setTried] = useState(false);          // they tried to switch it on before it could be
  const [offError, setOffError] = useState('');       // switching it off didn't reach the database
  const [buildHelp, setBuildHelp] = useState(false);  // the newest-build advice, while that box is in use
  const linkRef = useRef(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const problems = noticeProblems(f);   // the one source of the rules (the SQL and the app agree with it)

  // One write at a time, in order — an autosave and an Off that can't wait (below) never cross, so the
  // database ends with whichever came last.
  const queue = useRef(Promise.resolve());
  const write = useCallback((row) => {
    const run = queue.current.then(async () => {
      const r = typeof row === 'function' ? row(JSON.parse(savedRef.current)) : row;
      if (!r) return;
      await saveNotice(platform.key, r);
      savedRef.current = JSON.stringify(r);
      setSavedJson(savedRef.current);
    });
    queue.current = run.catch(() => {});
    return run;
  }, [platform.key]);

  const auto = useAutosave({ value: f, savedJson, ready: problems.length === 0, save: write });
  useSaveNow(auto.flush);
  const onPhones = !!JSON.parse(savedJson).active;   // what phones have now: the last row that was saved
  const offLate = !f.active && onPhones;              // switched Off here, not yet in the database
  useLeaveGuard(auto.status !== 'saved' || offLate);

  // Off takes effect even while an edit blocks saving (a mistyped link, say): the row phones have is
  // switched off at once and the typed edits wait, as a draft, until they can be saved.
  const switchOff = () => {
    setOffError('');
    write((row) => (row.active ? { ...row, active: false } : null))
      .catch((e) => setOffError(e?.message || 'It didn’t save.'));
  };
  // a switch takes effect when it's flipped, not after the typing pause
  const flipped = useRef(false);
  useEffect(() => {
    if (!flipped.current) return;
    flipped.current = false;
    auto.flush();
  }, [f.active]); // eslint-disable-line react-hooks/exhaustive-deps

  // An honest switch: it can't be put On while the card couldn't be saved on — it stays Off and says
  // why, right under it; while an edit blocks saving it doesn't say "On"; and it doesn't say phones are
  // clear of the card until the database says so.
  const blocking = problems[0] || (tried && !f.active ? noticeProblems({ ...f, active: true })[0] : '') || '';
  const flip = (on) => {
    if (on && noticeProblems({ ...f, active: true }).length) { setTried(true); return; }
    setTried(false);
    set('active', on);
    if (!on && problems.length) switchOff();
    else flipped.current = true;
  };
  const label = offLate ? 'Off — not saved yet'
    : !f.active ? 'Off'
    : problems.length ? 'Not saved yet — fix what’s below'
    : 'On — older versions are asked to update';
  // a pill fills the link; the APK's has none to fill (a new file every build), so it clears a store
  // link and puts the cursor where the APK's link is pasted
  const preset = presetFor(platform.key, f.link);
  const pick = (k) => {
    const pre = platform.presets.find((p) => p.key === k);
    if (!pre) return;
    if (pre.link) set('link', pre.link);
    else {
      if (preset !== k) set('link', '');
      if (linkRef.current && linkRef.current.focus) linkRef.current.focus();
    }
  };
  const when = platform.presets.map((p) => `${p.short} ${p.when}`).join(' · ');
  const id = (k) => `ax-set-${platform.key}-${k}`;

  return (
    <section className="ax-pane ax-set-pane ax-set-platform" aria-label={platform.label}>
      {/* the save state beside the thing it's about (Fitts) */}
      <div className="ax-pane-head ax-pane-bar ax-set-head">
        <span className="ax-pane-label">Update needed</span>
        <h3 className="ax-set-platform-title">{platform.label}</h3>
        <span className="ax-grow" />
        <SaveState auto={auto} />
      </div>
      <div className="ax-pane-body ax-set-platform-body">
        <div className="ax-set-platform-fields">
          <div className="ax-set-switch">
            <span className="ax-sw-on">
              <Toggle checked={f.active} onChange={flip} label={label}
                sub={offLate ? 'Phones still see the card until this saves.' : f.active ? whoSees(f.min_build) : 'Nobody sees the card.'} />
            </span>
          </div>
          {blocking ? <p className="ax-hint bad ax-set-block" role="alert">{blocking}</p> : null}
          {offError ? (
            <p className="ax-hint bad ax-set-block" role="alert">
              Not switched off on phones: {offError}
              <button type="button" className="ax-set-retry" onClick={switchOff}>Try again</button>
            </p>
          ) : null}
          {/* the build and the destination share a row (horizontal first) */}
          <div className="ax-set-pair">
            <Field label="Newest build" htmlFor={id('build')}>
              <input id={id('build')} className="ax-input ax-set-build" inputMode="numeric" value={f.min_build} placeholder="16"
                aria-describedby={id('buildhint')}
                onFocus={() => setBuildHelp(true)} onBlur={() => setBuildHelp(false)}
                onChange={(e) => set('min_build', e.target.value.replace(/[^\d]/g, ''))} />
            </Field>
            <Field label="The button goes to" htmlFor={id('link')}>
              <Seg label="The button goes to" value={preset} onChange={pick}
                options={platform.presets.map((p) => ({ key: p.key, label: p.short }))} />
            </Field>
          </div>
          {/* when it's safe to raise the build, shown while it's being changed (Miller: the rest of the time
              the switch's line says who sees the card) — screen readers get it from the box itself */}
          <p id={id('buildhint')} className={`ax-hint ax-set-buildhint${buildHelp ? ' open' : ''}`}>{platform.buildHint}</p>
          <div className="ax-field">
            <input ref={linkRef} id={id('link')} className="ax-input" value={f.link} placeholder="https://…"
              aria-label="Link" aria-describedby={id('linkhint')}
              onChange={(e) => set('link', e.target.value.trim())} />
            <p id={id('linkhint')} className="ax-hint">
              {platform.key === 'android' && preset !== 'store' ? 'While testing, paste the newest APK’s download link (from its Expo page).' : when}
            </p>
          </div>
          <Field label={<>Message <span className="ax-set-note">Leave it empty for the app’s own words.</span></>}
            count={f.message.length} max={MESSAGE_MAX} htmlFor={id('message')}>
            <input id={id('message')} className="ax-input" value={f.message} maxLength={MESSAGE_MAX} placeholder={DEFAULT_MESSAGE}
              onChange={(e) => set('message', e.target.value)} />
          </Field>
        </div>
        <div className="ax-set-phone">
          <UpdatePreview platform={platform} f={f} live={onPhones} />
        </div>
      </div>
    </section>
  );
}

// The card as the phone draws it (BethesdaApp components/UpdateNeeded.js — the Give popup's card): a
// 62% black scrim over the whole screen, dock and all; a white card 32pt in from the edges, corner 24,
// 24 in; the 56pt cream disc with Feather's download at 26; "Update needed" 22/700; the words 16/24 in
// ink-2; one large filled pill across it. Under it, the app's Home as it would be open.
function UpdatePreview({ platform, f, live }) {
  const { photos, home } = useContext(Ctx);
  const android = platform.key === 'android';
  return (
    <PhoneFrame statusBar="light" dock="home" profile={false} screenClassName={`ax-set-dim${android ? ' ax-set-android' : ''}`}
      label={`The Update needed card on ${android ? 'an Android phone' : 'an iPhone'} on an older build, over whatever page it’s on`}
      overlay={(
        <div className="ax-pa-scrim strong">
          {/* Pillar's own mark, not the app's: this card isn't on phones right now */}
          {!live ? <span className="ax-pa-flag ax-set-flag">Not on phones</span> : null}
          <div className="ax-pa-popup ax-set-upcard">
            <span className="ax-set-updisc"><PhoneIcon name="download" size={26} /></span>
            <span className="ax-set-uptitle">Update needed</span>
            <span className="ax-set-upbody">{String(f.message || '').trim() || DEFAULT_MESSAGE}</span>
            <span className="ax-pa-btn lg block ax-set-upbtn"><span>Update the app</span></span>
          </div>
        </div>
      )}>
      <AppHome photo={photos ? photos.home : ''} sermon={home.sermon} words={home.words} />
    </PhoneFrame>
  );
}

/* ─────────────────────────────── the app's own screens ─────────────────────────────── */

// Signed out, the profile button is the glass pill "Sign in" (BethesdaApp components/ProfileButton.js:
// Feather user at 16, Geist 600 14 at 90% white, 13 in on the left, 15 on the right, 7 between).
const SignIn = () => (
  <span className="ax-pa-glass ax-set-signin" aria-hidden="true"><PhoneIcon name="user" size={16} /><span className="ax-pa-ui">Sign in</span></span>
);

// BethesdaApp screens/HomeScreen.js at 393 × 852 (iPhone 15/16), signed out — every number from its
// own geometry: the photo 393 wide at mainhero's 2:3 (589.5 tall) runs on to 606, halfway down the
// sermon card; the headline (52pt, the 1.12em reel slot = 58) at 177 and the stacked hero pills — VISIT
// and FIND A GROUP (its name since 2026-09-23) — at 313, centred between the profile button's row (109)
// and the card; the card's label at 495 and its 16:9 picture 353 × 198.6 — the newest sermon's picture
// and title, or the app's own words; the round shortcuts a block under the card (746), with the
// office's words where it wrote some (HomeShortcuts.js). With no photo chosen — or no sermon picture —
// the app shows its own church photo (assets/mainhero.jpg, the same file in css/img; Settings marks a
// page showing its own beside the page's name, outside the phone).
const SHORTCUTS = [['search', 'Search', null], ['heart', 'Pray', 'prayer'], ['users', 'Groups', 'connect'], ['file-text', 'Bulletin', 'bulletin']];
export function AppHome({ photo, crop = false, sermon = null, words = {} }) {
  return (
    <div className="ax-pa-screen ax-set-home">
      <SignIn />
      <div className={`ax-set-hero${photo ? '' : ' ax-set-own-hero'}`} style={pictureOf(photo)}>
        <span className="ax-set-hero-shade" />
        <span className="ax-pa-blur ax-set-hero-blur" />
        <span className="ax-set-hero-foot" />
        <div className="ax-set-headline" role="img" aria-label="Where every life matters">
          <span>Where&nbsp;Every</span>
          <span>Life Matters</span>
        </div>
        <div className="ax-set-herobtns">
          <span className="ax-pa-btn lg on-dark ax-set-visit">Visit</span>
          <span className="ax-pa-btn lg on-dark-outline ax-set-connect">Find a Group</span>
        </div>
      </div>
      {!crop ? (
        <>
          <div className="ax-set-sermon">
            <div className="ax-set-sermon-label">Watch the latest sermon</div>
            <div className={`ax-set-sermon-thumb${sermon && sermon.picture ? '' : ' ax-set-own-hero'}`} style={pictureOf(sermon && sermon.picture)}>
              <span className="ax-pa-scrim-foot" />
              <span className="ax-set-sermon-title">{(sermon && sermon.title) || "This Week's Message"}</span>
              <span className="ax-pa-play corner" />
            </div>
          </div>
          <div className="ax-pa-shortcuts ax-set-shortcuts">
            {SHORTCUTS.map(([icon, word, slot]) => (
              <span key={icon} className="ax-pa-shortcut">
                <span className="ax-pa-shortcut-disc"><PhoneIcon name={icon} size={21} /></span>
                <span className="ax-pa-shortcut-word">{(slot && words[slot]) || word}</span>
              </span>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// BethesdaApp screens/DirectoryScreen.js, signed in: the photo under the status bar (150pt since
// 2026-09-23 — 209 with the status bar; blur over its lower 55%, the dark gradient), MEMBERS over
// "Directory", then the lead line, the search bar (48) and the pills under it — Everyone picked.
function DirectoryTop({ photo }) {
  return (
    <div className="ax-pa-screen">
      <div className={`ax-pa-photohead dir${photo ? '' : ' ax-set-own-dir'}`} style={pictureOf(photo)}>
        <span className="ax-pa-blur" />
        <div className="ax-pa-photohead-words">
          <div className="ax-pa-kicker on-photo">Members</div>
          <div className="ax-pa-title on-photo">Directory</div>
        </div>
      </div>
      <div className="ax-set-dir-head">
        <p className="ax-set-dir-lead">Members of Bethesda Baptist Church.</p>
        <div className="ax-pa-search ax-set-dir-search">Search members by name</div>
      </div>
      <div className="ax-set-dir-pills">
        <span className="ax-set-dir-pill on">Everyone</span>
        <span className="ax-set-dir-pill">A–Z<PhoneIcon name="chevron-down" size={15} /></span>
        <span className="ax-set-dir-pill">Shares contact</span>
      </div>
    </div>
  );
}

// BethesdaApp screens/GroupsScreen.js: the same short photo header (209), FIND YOUR PEOPLE over
// "Groups" (the words stop 94pt short of the right edge, clear of the profile button), then the search
// bar 16 under the photo. With no photo chosen, the app's own (assets/home/community.jpg — the same file,
// in css/img).
function GroupsTop({ photo }) {
  return (
    <div className="ax-pa-screen">
      <div className={`ax-pa-photohead${photo ? '' : ' ax-set-own-groups'}`} style={pictureOf(photo)}>
        <span className="ax-pa-blur" />
        <div className="ax-pa-photohead-words">
          <div className="ax-pa-kicker on-photo">Find your people</div>
          <div className="ax-pa-title on-photo">Groups</div>
        </div>
      </div>
      <div className="ax-pa-gutter ax-set-gr-search"><div className="ax-pa-search">Search groups</div></div>
    </div>
  );
}

// The top of each page, cut just past what sits right under its photo: Home's first hero pill (btn.lg,
// 313–369; the second starts at 385), the Directory's pills (335–375), Groups' search bar (225–273 —
// what follows it is the church's own filters and groups). The same scale for all three, so Groups is
// the shorter phone.
const SCREENS = {
  home: { crop: 378, draw: (url) => <AppHome photo={url} crop /> },
  directory: { crop: 378, draw: (url) => <DirectoryTop photo={url} /> },
  groups: { crop: 276, draw: (url) => <GroupsTop photo={url} /> },
};

/* ─────────────────────────────── pictures ─────────────────────────────── */

/**
 * A picture from the computer: dropped on `dropProps`' element or chosen with `choose()` (the hidden
 * `input` must be on the page). `upload(file)` → { url } | { error }; `onUrl(url)` gets the result.
 */
function usePictureFile(upload, onUrl) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const file = useRef(null);
  async function take(f) {
    if (!f) return;
    if (!String(f.type || '').startsWith('image/')) { setError('That isn’t a picture — choose a JPG, PNG or WebP.'); return; }
    setBusy(true); setError('');
    let r;
    try { r = await upload(f); } catch (e) { r = { error: e.message }; }
    setBusy(false);
    if (r?.error) setError(r.error);
    else if (r?.url) onUrl(r.url);
  }
  const choose = () => { if (!busy && file.current) file.current.click(); };
  const dropProps = {
    onDragOver: (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e) => { e.preventDefault(); setOver(false); take(e.dataTransfer?.files?.[0] || null); },
  };
  const input = (
    <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; take(f); }} />
  );
  return { busy, error, setError, over, choose, dropProps, input };
}

/* ─────────────────────────────── Page photos ─────────────────────────────── */

// The photo at the top of Home, Directory and Groups (user, 2026-09-21: "allow me to change the images
// in directory and other headers"). Each saves the moment it's chosen or cleared; a cleared one gives
// the page back the app's own photo (with Undo). Open phones pick it up within a second or two.
function PagePhotos() {
  const { photos, setPhotos, photoError, loadPhotos, undo } = useContext(Ctx);
  const [state, setState] = useState('');   // '' (nothing yet) | 'saving' | 'saved' | 'error'
  const [error, setError] = useState('');
  const retry = useRef(null);
  const current = useRef(photos);
  current.current = photos;

  const change = useCallback(async (page, url) => {
    const before = (current.current || {})[page] || '';
    setPhotos((p) => ({ ...(p || {}), [page]: url || '' }));
    setState('saving');
    setError('');
    try {
      await setPageHeader(page, url);
      setState('saved');
      return true;
    } catch (e) {
      setPhotos((p) => ({ ...(p || {}), [page]: before }));
      setState('error');
      setError(e.message || 'It didn’t save.');
      retry.current = () => change(page, url);
      return false;
    }
  }, [setPhotos]);

  // gone at once, with Undo (the kit's way — never a dialog)
  const remove = async (pg) => {
    const before = (current.current || {})[pg.key] || '';
    if (!before) return;
    if (await change(pg.key, '')) {
      undo(`${pg.label} photo removed — the app’s own is back.`, () => { change(pg.key, before); });
    }
  };

  const auto = {
    status: state === 'saving' ? 'saving' : state === 'error' ? 'error' : 'saved',
    error,
    flush: () => (retry.current ? retry.current() : undefined),
  };

  return (
    <Pane label="Page photos" className="ax-set-pane ax-set-photos-pane"
      right={(
        <>
          <span className="ax-set-right" title="The photo at the top of these pages in the app. Leave one empty to keep the app’s own.">
            The top of each page · empty keeps the app’s own
          </span>
          {state ? <SaveState auto={auto} saved="Saved — on phones in a moment" /> : null}
        </>
      )}>
      <Problem onRetry={loadPhotos}>{photoError}</Problem>
      {photos === undefined ? <Loading>Reading…</Loading> : photos === null ? (
        <Alert>Run supabase/app-page-headers.sql in Supabase (SQL Editor) to turn this on.</Alert>
      ) : (
        <div className="ax-set-photos">
          {PAGES.map((pg) => (
            <PhotoSlot key={pg.key} pg={pg} url={photos[pg.key] || ''}
              onSet={(u) => change(pg.key, u)} onRemove={() => remove(pg)} />
          ))}
        </div>
      )}
    </Pane>
  );
}

// One page's photo: drop it on the phone (or click the phone, or Choose), give a picture that's
// already online (the link), or remove it for the app's own (the bin, beside the page's name). A typed
// address is saved when they leave the box or press Enter — never letter by letter (the database
// refuses anything but a whole https:// address, and a save per keystroke meant a pasted address could
// never be typed); Escape puts the box away unsaved.
function PhotoSlot({ pg, url, onSet, onRemove }) {
  const pic = usePictureFile(uploadCardImage, onSet);
  const [linking, setLinking] = useState(false);
  const [draft, setDraft] = useState('');
  // the box is open — a ref, not the state: the box's blur can arrive after Escape or Enter has closed
  // it, through the handler of the render before, and must then do nothing
  const open = useRef(false);
  const close = () => { open.current = false; setLinking(false); };
  const openLink = () => { setDraft(url && !STORED.test(url) ? url : ''); pic.setError(''); open.current = true; setLinking(true); };
  const commit = () => {
    if (!open.current) return;
    const v = draft.trim();
    if (!v || v === url) { pic.setError(''); close(); return; }   // nothing new: just put the box away
    if (!HTTPS.test(v)) { pic.setError('Use a secure address — one that starts with https://. The app shows no other.'); return; }
    pic.setError('');
    close();
    onSet(v);
  };
  useSaveNow(commit);
  const screen = SCREENS[pg.key];

  return (
    <div className="ax-set-photo">
      <div className="ax-set-photo-head">
        <strong className="ax-set-photo-name" title={pg.label}>{pg.label}</strong>
        {/* Pillar's own mark, outside the phone: nothing chosen, so phones show the app's own photo */}
        {!url ? <span className="ax-set-ownflag" title="No photo chosen: the app shows its own">App’s own</span> : null}
        {url && !pic.busy ? (
          <button type="button" className="ax-set-iconbtn danger" onClick={onRemove}
            title={`Remove this photo — the app’s own ${pg.label} photo comes back (with Undo)`}>
            <Icon d={P.trash} size={16} /><Said>Use the app’s own</Said>
          </button>
        ) : null}
      </div>
      <div className={`ax-set-drop${pic.over ? ' over' : ''}${pic.busy ? ' busy' : ''}`}
        title={`${pg.hint} Drop a photo here, or click to choose one.`} onClick={pic.choose} {...pic.dropProps}>
        <PhoneFrame height={screen ? screen.crop : 378} statusBar="light" back={pg.key !== 'home'} profile={pg.key !== 'home'}
          screenClassName="ax-set-crop" label={`The top of ${pg.label} in the app`}>
          {screen ? screen.draw(url) : null}
        </PhoneFrame>
        {pic.busy ? <span className="ax-set-drop-busy"><span className="ax-spinner" />Uploading…</span> : null}
      </div>
      {linking ? (
        <input className="ax-input ax-set-address" value={draft} inputMode="url" placeholder="https://…" aria-label={`${pg.label} picture address`}
          title="Enter uses it · Esc puts it away"
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); pic.setError(''); close(); }
          }} />
      ) : (
        <div className="ax-set-photo-btns">
          <button type="button" className="ax-btn sm ax-set-choose" disabled={pic.busy} onClick={pic.choose}>
            {pic.busy ? <><span className="ax-spinner" />Uploading…</> : url ? 'Replace' : 'Choose'}
          </button>
          <button type="button" className="ax-headbtn" onClick={openLink} title="Use a picture that’s already online (its https:// address)">
            <Icon d={P.link} size={16} /><Said>Use a picture that’s already online</Said>
          </button>
        </div>
      )}
      {pic.error ? <p className="ax-hint bad">{pic.error}</p> : null}
      {pic.input}
    </div>
  );
}

/* ─────────────────────────────── the website and the connection ─────────────────────────────── */

// what's in a folded section's head that isn't the fold itself (a SaveState's "Try again"): a click on
// it mustn't open or close the section
const keepOpen = (e) => e.preventDefault();

function Website() {
  const { serial } = useContext(Ctx);
  const [raw, setRaw] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    getSettings()
      .then((s) => { setRaw(s || {}); setSaved(JSON.stringify(siteForm(s || {}))); })
      .catch((e) => setError(e.message || 'Couldn’t reach the app server.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const form = useMemo(() => siteForm(raw), [raw]);
  const save = useCallback(async (v) => {
    await serial(() => putSettings({ ...raw, ...v }));   // everything else the server keeps goes back untouched
    setSaved(JSON.stringify(v));
  }, [raw, serial]);
  const auto = useAutosave({ value: form, savedJson: saved, ready: raw !== null, save });
  useSaveNow(auto.flush);
  useLeaveGuard(raw !== null && auto.status !== 'saved');
  const set = (k, v) => setRaw((r) => ({ ...r, [k]: v }));

  return (
    <Section collapsible title="Church website"
      right={raw ? <span className="ax-set-status" onClick={keepOpen}><SaveState auto={auto} /></span> : null}>
      <p className="ax-hint">The website shows these at the top of its home page. The app doesn’t use them.</p>
      <Problem onRetry={load}>{error}</Problem>
      {raw === null ? (error ? null : <Loading>Reaching the app server…</Loading>) : (
        <>
          <Fields min={180}>
            <Field label="Church name" htmlFor="ax-set-church">
              <input id="ax-set-church" className="ax-input" value={form.churchName} onChange={(e) => set('churchName', e.target.value)} />
            </Field>
            <Field label="Tagline" htmlFor="ax-set-tagline">
              <input id="ax-set-tagline" className="ax-input" value={form.tagline} onChange={(e) => set('tagline', e.target.value)} />
            </Field>
          </Fields>
          <WebPicture value={form.heroImageUrl} onChange={(u) => set('heroImageUrl', u)} />
        </>
      )}
    </Section>
  );
}

// The website's picture in one row — its thumbnail (drop a picture on it, or click it), Replace, its
// address, Remove (with Undo). The kit's ImageDrop is a whole panel; this keeps Settings on one screen.
// Uploads go to the app server (uploadImage), as they always have.
function WebPicture({ value, onChange }) {
  const { undo } = useContext(Ctx);
  const pic = usePictureFile(async (file) => {
    const url = await uploadImage(file);
    return url ? { url } : { error: 'The upload didn’t return an address.' };
  }, onChange);
  const [linking, setLinking] = useState(false);
  const remove = () => {
    const before = value;
    onChange('');
    undo('Website picture removed.', () => onChange(before));
  };
  return (
    <div className="ax-field">
      <div className={`ax-set-webpic${pic.over ? ' over' : ''}`} {...pic.dropProps}>
        <button type="button" className="ax-set-webthumb" style={pictureOf(value)} onClick={pic.choose}
          title="Drop a picture here, or click to choose one">
          {value ? null : <Icon d={P.folder} size={18} />}
          <Said>{value ? 'Replace the website picture' : 'Choose the website picture'}</Said>
        </button>
        <span className="ax-set-webpic-words">
          <strong>Picture</strong>
          <span>{value ? 'Drop a new one to replace it' : 'Drop one here'}</span>
        </span>
        <button type="button" className="ax-btn sm" disabled={pic.busy} onClick={pic.choose}>
          {pic.busy ? <><span className="ax-spinner" />Uploading…</> : value ? 'Replace' : 'Choose'}
        </button>
        <button type="button" className={`ax-headbtn${linking ? ' ax-set-on' : ''}`} aria-expanded={linking}
          onClick={() => setLinking((l) => !l)} title="Use a picture that’s already online (its address)">
          <Icon d={P.link} size={16} /><Said>Use a picture that’s already online</Said>
        </button>
        {value && !pic.busy ? (
          <button type="button" className="ax-headbtn danger" onClick={remove} title="Remove the picture (with Undo)">
            <Icon d={P.trash} size={16} /><Said>Remove</Said>
          </button>
        ) : null}
        {pic.input}
      </div>
      {linking ? (
        <input className="ax-input" value={value || ''} inputMode="url" placeholder="https://…" aria-label="Picture address"
          onChange={(e) => onChange(e.target.value)} />
      ) : null}
      {pic.error ? <p className="ax-hint bad">{pic.error}</p> : null}
    </div>
  );
}

function Connection() {
  const { saveAll, serial } = useContext(Ctx);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);   // { ok, msg }
  const [dev, setDev] = useState(false);
  const [key, setKey] = useState('');
  const [scheme, setScheme] = useState('bearer');
  const [local, setLocal] = useState(hasAppApiAuth());

  async function test() {
    setTesting(true); setResult(null);
    // the test writes the settings straight back — so anything the website fields haven't saved yet
    // goes first, and the read-and-write-back waits its turn behind any save still on its way (serial)
    await saveAll();
    try {
      await serial(async () => {
        const current = await getSettings();   // read what's there…
        await putSettings(current);            // …and write it straight back: nothing changes
      });
      setResult({ ok: true, msg: 'Working — a test change reached the app server just now.' });
    } catch (e) {
      let msg = e.message;
      const c = await checkAppApiKey();
      if (c && c.error) msg = c.error;
      else if (c && !c.accepted) {
        msg = c.upstream === null
          ? `${msg} (The app server didn't answer the check — it may be asleep. Try once more.)`
          : `The app server refused Pillar's key. Pillar holds a ${c.keyLength}-character key${c.hadWhitespace ? ' (it had a stray space, which Pillar trimmed)' : ''}. Check that APP_API_KEY in Vercel is exactly API_KEY on Render.`;
      }
      setResult({ ok: false, msg });
    }
    setTesting(false);
  }

  function useKey() {
    const s = SCHEMES.find((x) => x.key === scheme);
    setAppApiAuth({ key: key.trim(), header: s.header, prefix: s.prefix });
    setLocal(!!key.trim());
    setKey('');
    test();
  }

  return (
    <Section collapsible defaultOpen={false} title="Connection to the app server" className="ax-set-conn-fold"
      right={result ? <span className={`ax-set-conn${result.ok ? ' ok' : ' bad'}`}>{result.ok ? 'Working' : 'Not working'}</span> : null}>
      <p className="ax-hint">
        Pillar’s own server holds the app server’s key and uses it for you once you’re signed in, so there’s
        nothing to enter on any computer. If a change ever refuses to save, test it here — it reads the
        settings and writes them straight back, so nothing changes.
      </p>
      {result ? (
        result.ok
          ? <div className="ax-note"><Icon d={P.check} size={18} /><span>{result.msg}</span></div>
          : <Alert>{result.msg}</Alert>
      ) : null}
      <div className="ax-inline">
        <button type="button" className="ax-btn primary" onClick={test} disabled={testing}>
          {testing ? <><span className="ax-spinner" />Testing…</> : 'Test the connection'}
        </button>
        <button type="button" className="ax-btn quiet" onClick={() => setDev((d) => !d)} aria-expanded={dev}>
          {dev ? 'Hide developer options' : 'Developer options'}
        </button>
      </div>

      {dev ? (
        <div className="ax-form ax-set-dev">
          <p className="ax-hint">
            Only for a local development copy of Pillar, which has no server of its own. The key stays in this
            browser. On the real Pillar, leave this alone — the key belongs in Vercel as APP_API_KEY.
          </p>
          {local ? (
            <div className="ax-note">
              <span className="ax-note-main">A key is saved in this browser.</span>
              <button type="button" className="ax-btn quiet sm" onClick={() => { setAppApiAuth({ key: '' }); setLocal(false); }}>Remove it</button>
            </div>
          ) : null}
          <Field label="Key" htmlFor="ax-set-key">
            <input id="ax-set-key" className="ax-input" type="password" value={key} autoComplete="off" placeholder="The app server’s key"
              onChange={(e) => setKey(e.target.value)} />
          </Field>
          <Field label="How the server expects it">
            <Seg label="Header" value={scheme} onChange={setScheme} options={SCHEMES.map((s) => ({ key: s.key, label: s.label }))} />
          </Field>
          <div className="ax-inline">
            <button type="button" className="ax-btn" onClick={useKey} disabled={!key.trim() || testing}>Use this key here</button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
