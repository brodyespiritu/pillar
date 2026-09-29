import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import { getPushCount, sendNotification } from '../../lib/appApi';
import { ask, Field, GrowText, Alert, Seg, useLeaveGuard } from './kit';
import {
  PUSH_PAGES, OPENS, BLANK_OPENS, opensOf, pushData, opensWords, opensHint, listAnnouncementChoices,
} from '../../lib/pushTargets';
import { Workspace, EditorPane, PreviewPane, PhoneFrame, Cols, ColA, ColB, useHotkeys, modKey } from './layout';
import PopupPanel from './PopupPanel';

// App → Notifications: write it, see it as a locked phone shows it, send it. Sending is the one thing
// in App that can't be taken back, so it's the one thing that asks first.
//
// Redesign (2026-09-23, Pillar-backups/redesign/DESIGN.md §4) — the same workspace as every App page
// (Jakob's law): the message in the editor pane, the locked iPhone beside it in the preview pane, side
// by side down to 760px of room (horizontal first: the preview never drops under the form, where it
// was on every laptop), stacked below that.
//   · Proximity: the words on the left of the editor, who they reach and what can't be undone on the
//     right; the Send button at the foot of the words it sends.
//   · Tesler / efficiency: ⌘/Ctrl+Enter sends from inside either box (it still asks first); N starts
//     another; Escape puts a note away.
//   · Nothing typed is lost: the draft stays while you move around Pillar (this tab only), and closing
//     the tab with one typed asks first.
//   · The lock screen shows today's real day and time, and the app's real icon.
//   · When it's tapped (2026-09-24): the app, a page, or one announcement (src/lib/pushTargets.js) —
//     under the words it goes with (proximity), three choices and only then the one list that choice
//     needs (Hick; progressive disclosure), with the result in words under it ("Tapping it opens …").
//
// Two tabs in the page head (2026-09-24): Notification (the lock-screen message, above) and Update
// popup (PopupPanel.jsx — TESTING: the orange "Recent updates" card every phone shows once). The
// second is ?tab=popup, so a link or a reload lands on it.

const TITLE_MAX = 80;
const BODY_MAX = 300;
// what an iPhone calls the app (BethesdaApp app.json "name") — the name a lock screen shows
export const APP_NAME = 'BethesdaApp';
const DRAFT_KEY = 'pillar.app.notify.draft';

/** "214 phones", "1 phone", or — when the count couldn't be read — "every phone with the app". */
export const phonesFor = (count) => (count == null ? 'every phone with the app' : `${count} phone${count === 1 ? '' : 's'}`);

// the lock screen's clock, in the iPhone's own words (US English: "Wednesday, September 23" over "9:41")
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const lockDate = (d) => `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
export const lockTime = (d) => `${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Now, kept current while the page is open. */
function useNow(every = 15000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

// the draft, kept in this tab while they're elsewhere in Pillar (a convenience: sessionStorage can be
// missing or refuse, and then it simply isn't kept)
function readDraft() {
  try {
    const d = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || 'null');
    return d && typeof d === 'object' ? d : {};
  } catch { return {}; }
}
function keepDraft(title, body, opens) {
  try {
    if (title || body) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title, body, opens }));
    else window.sessionStorage.removeItem(DRAFT_KEY);
  } catch { /* not kept — nothing else changes */ }
}

const TABS = [
  { key: 'push', label: 'Notification' },
  { key: 'popup', label: 'Update popup' },
];

export default function NotificationsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'popup' ? 'popup' : 'push';
  const [count, setCount] = useState(null);
  const [counted, setCounted] = useState(false);
  useEffect(() => {
    getPushCount().then((r) => setCount(r?.count ?? 0)).catch(() => setCount(null)).finally(() => setCounted(true));
  }, []);
  const phones = phonesFor(count);
  const go = (t) => { if (t !== tab) setParams(t === 'push' ? {} : { tab: t }, { replace: true }); };

  return (
    <AppShell title="Notifications"
      subtitle={tab === 'popup'
        ? 'Testing · a card every phone shows once, in the test kit’s orange.'
        : `A message to ${phones}, straight to the lock screen.`}
      tabs={{ value: tab, onChange: go, options: TABS, label: 'Kind of message' }} fill>
      {tab === 'popup' ? <PopupPanel /> : <PushPanel count={count} counted={counted} />}
    </AppShell>
  );
}

// the lock-screen message: the words on the left, the locked iPhone beside them
function PushPanel({ count, counted }) {
  const [title, setTitle] = useState(() => String(readDraft().title || '').slice(0, TITLE_MAX));
  const [body, setBody] = useState(() => String(readDraft().body || '').slice(0, BODY_MAX));
  const [opens, setOpens] = useState(() => opensOf(readDraft().opens));   // what a tap opens
  const [choices, setChoices] = useState(null);   // the announcements on phones now, read when needed
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const busy = useRef(false);   // asking or sending: a held ⌘↵ can't send twice
  const titleRef = useRef(null);
  const now = useNow();

  useEffect(() => { keepDraft(title, body, opens); }, [title, body, opens]);
  // the announcements, read the first time "An announcement" is picked (or a draft comes back with one)
  useEffect(() => {
    if (opens.kind !== 'announcement' || choices) return undefined;
    let alive = true;
    listAnnouncementChoices()
      .then((c) => { if (alive) setChoices(c); })
      .catch(() => { if (alive) setChoices({ list: [], failed: ['Digital Bulletin', 'Home'] }); });
    return () => { alive = false; };
  }, [opens.kind, choices]);

  const phones = phonesFor(count);
  const list = choices ? choices.list : [];
  // "An announcement" is ready once one that's on phones now is picked
  const opensOk = opens.kind !== 'announcement' || list.some((x) => x.key === opens.ann);
  const ready = !!(title.trim() && body.trim()) && opensOk;
  const typed = !!(title.trim() || body.trim());
  // closing the tab (or reloading) with a message typed asks first
  useLeaveGuard(typed && !sending);

  async function send() {
    if (!ready || busy.current) return;
    busy.current = true;
    try {
      const data = pushData(opens);
      const where = data ? ` Tapping it opens ${opensWords(opens, list)}.` : '';
      if (!(await ask(`Send “${title.trim()}” to ${phones} now? It can’t be taken back.${where}`))) return;
      setSending(true); setError(''); setSent('');
      try {
        const res = await sendNotification({ title: title.trim(), body: body.trim(), ...(data ? { data } : {}) });
        // an app server from before this (bethesda-admin pushTarget.js) sends the words and drops the rest
        const carried = !data || (res && res.data && res.data.page === data.page);
        setSent(carried ? `Sent to ${phones}.`
          : `Sent to ${phones}. The app server hasn’t been updated to carry where it opens yet, so tapping it just opens the app.`);
        setTitle(''); setBody(''); setOpens(BLANK_OPENS);
      } catch (e) { setError(e.message); }
      setSending(false);
    } finally {
      busy.current = false;
    }
  }
  const another = () => {
    setSent('');
    if (titleRef.current && titleRef.current.focus) titleRef.current.focus();
  };

  useHotkeys({
    'mod+enter': () => { send(); },
    n: another,
    escape: () => { if (sent) setSent(''); else if (error) setError(''); },
  });

  const status = sending ? 'Sending…' : sent || (typed ? 'Draft — kept while you’re in Pillar' : 'Nothing written yet');
  const sendKeys = modKey() === '⌘' ? '⌘↵' : 'Ctrl+Enter';

  return (
    <Workspace className="ax-nt">
      <EditorPane label="The message"
        status={<span className={`ax-save${sent ? ' saved' : ''}`} role="status"><span className="ax-dot" />{status}</span>}>
        <Alert onClose={error ? () => setError('') : null}>{error}</Alert>
        {sent ? (
          <div className="ax-note spaced">
            <Icon d={P.check} size={18} /><span className="ax-note-main">{sent}</span>
            <button type="button" className="ax-btn quiet sm" onClick={another}>Write another</button>
          </div>
        ) : null}
        <Cols>
          {/* the words, then the one button that sends them (proximity; Von Restorff: the view's one filled button) */}
          <ColA title="Message">
            <Field label="Title" count={title.length} max={TITLE_MAX} htmlFor="ax-nt-title">
              <input ref={titleRef} id="ax-nt-title" className="ax-input title" value={title} maxLength={TITLE_MAX}
                placeholder="What it’s about" onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Message" count={body.length} max={BODY_MAX} htmlFor="ax-nt-body">
              <GrowText id="ax-nt-body" value={body} maxLength={BODY_MAX} minRows={3} placeholder="What you want everyone to know"
                onChange={(e) => setBody(e.target.value)} />
            </Field>
            <Field label="When it’s tapped, open" htmlFor={opens.kind === 'app' ? undefined : 'ax-nt-opens'}
              hint={opensHint(opens, list, { loading: opens.kind === 'announcement' && !choices, failed: choices ? choices.failed : [] })}>
              <Seg label="When it’s tapped, open" value={opens.kind} options={OPENS}
                onChange={(kind) => setOpens((o) => ({ ...o, kind }))} />
              {opens.kind === 'page' ? (
                <select id="ax-nt-opens" className="ax-select" value={opens.page}
                  onChange={(e) => setOpens((o) => ({ ...o, page: e.target.value }))}>
                  {PUSH_PAGES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              ) : null}
              {opens.kind === 'announcement' && choices && list.length ? (
                <select id="ax-nt-opens" className="ax-select" value={list.some((x) => x.key === opens.ann) ? opens.ann : ''}
                  onChange={(e) => setOpens((o) => ({ ...o, ann: e.target.value }))}>
                  <option value="" disabled>Choose an announcement…</option>
                  {[['bulletin', 'Digital Bulletin'], ['home', 'Home']].map(([where, label]) => (list.some((x) => x.where === where) ? (
                    <optgroup key={where} label={label}>
                      {list.filter((x) => x.where === where).map((x) => (
                        <option key={x.key} value={x.key}>{x.title}{x.note ? ` — ${x.note}` : ''}</option>
                      ))}
                    </optgroup>
                  ) : null))}
                </select>
              ) : null}
              {choices && choices.failed.length ? (
                <p className="ax-hint bad">Couldn’t read {choices.failed.join(' or ')} just now — <button type="button" className="ax-link ax-nt-retry" onClick={() => setChoices(null)}>try again</button>.</p>
              ) : null}
            </Field>
            <div className="ax-nt-send">
              <span className="ax-hint ax-nt-send-hint">Goes to {phones} at once, and can’t be taken back.</span>
              <span className="ax-hotkeys ax-nt-keys"><span className="ax-hotkey"><kbd>{sendKeys}</kbd>send</span></span>
              <button type="button" className="ax-btn primary" onClick={send} disabled={!ready || sending}
                title={ready ? `Send now (${sendKeys})` : 'Write a title and a message first'}>
                {sending ? <><span className="ax-spinner" />Sending…</> : <><Icon d={P.send} size={16} />Send now</>}
              </button>
            </div>
            {/* never a silently dead button (Hick): say what's missing */}
            {!ready && typed ? (
              <p className="ax-hint ax-nt-missing">
                {!title.trim() ? 'Give it a title too.' : !body.trim() ? 'Write the message too.' : 'Choose the announcement it opens too.'}
              </p>
            ) : null}
          </ColA>
          {/* what sending does, beside the words — the facts to know before the one thing that can't be undone */}
          <ColB title="Who gets it">
            <div className="ax-nt-reach" aria-live="polite">
              <Icon d={P.users} size={22} />
              <span className="ax-nt-reach-main">
                <strong className="ax-nt-reach-n">{!counted ? 'Counting…' : count == null ? 'Everyone' : count.toLocaleString('en-US')}</strong>
                <span className="ax-nt-reach-word">
                  {!counted ? 'phones with the app'
                    : count == null ? 'every phone with the app (the count didn’t load)'
                    : `${count === 1 ? 'phone has' : 'phones have'} the app with notifications on`}
                </span>
              </span>
            </div>
            <ul className="ax-nt-facts">
              <li>It reaches all of them at once, on the lock screen.</li>
              <li>Once it’s sent it can’t be taken back or changed.</li>
              <li>A lock screen shows the title and the first four lines; the rest shows when it’s opened.</li>
            </ul>
          </ColB>
        </Cols>
      </EditorPane>

      <PreviewPane label="On phones" note="Lock screen">
        <LockScreen title={title} body={body} now={now} />
        <p className="ax-phone-cap">
          A locked iPhone, as its owner sees it. Until Face ID knows them, iPhones show only “{APP_NAME}”.
        </p>
      </PreviewPane>
    </Workspace>
  );
}

// The app's icon (BethesdaApp assets/icon.png): the orange #F1742E square and the white cross, drawn
// at the loading logo's own proportions (assets/applogosvg.svg, a 182.8 square); iOS rounds its corners.
export function AppIcon({ className = '' }) {
  return (
    <svg className={`ax-nt-icon${className ? ` ${className}` : ''}`} viewBox="0 0 182.804688 182.804688" aria-hidden="true">
      <rect width="182.804688" height="182.804688" rx="41" fill="#F1742E" />
      <rect x="81.46875" y="26.125" width="19.867188" height="130.515625" fill="#FFFFFF" />
      <rect x="55.101562" y="54.796875" width="72.628907" height="19.863281" fill="#FFFFFF" />
    </svg>
  );
}

// A locked iPhone (iOS's own lock screen, not the app: SF Pro, the frosted notification near the foot,
// the torch and camera) showing the message the moment it arrives. Title on one line, the message to
// four — as a lock screen cuts them.
function LockScreen({ title, body, now }) {
  const t = title.trim();
  const b = body.trim();
  return (
    <PhoneFrame statusBar="light" profile={false} screenClassName="ax-nt-lock" label="The message on a locked iPhone">
      <div className="ax-nt-screen">
        <span className="ax-nt-wall" aria-hidden="true" />
        <svg className="ax-nt-padlock" viewBox="0 0 16 21" aria-hidden="true">
          <path d="M3 9V6a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" strokeWidth="2" />
          <rect x="0.5" y="8.5" width="15" height="12" rx="2.5" fill="currentColor" />
        </svg>
        <div className="ax-nt-date">{lockDate(now)}</div>
        <div className="ax-nt-clock">{lockTime(now)}</div>
        <div className="ax-nt-push" role="img" aria-label={`${APP_NAME}: ${t || 'Title'}. ${b || 'Your message shows here.'}`}>
          <AppIcon />
          <div className="ax-nt-push-main">
            <div className="ax-nt-push-top">
              <span className={`ax-nt-push-title${t ? '' : ' empty'}`}>{t || 'Title'}</span>
              <span className="ax-nt-push-when">now</span>
            </div>
            <div className={`ax-nt-push-body${b ? '' : ' empty'}`}>{b || 'Your message shows here.'}</div>
          </div>
        </div>
        <span className="ax-nt-quick torch" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 2h8l-1 5H9L8 2Zm1 6h6l-1.2 3.2V21a1 1 0 0 1-1 1h-1.6a1 1 0 0 1-1-1v-9.8L9 8Z" fill="currentColor" /></svg>
        </span>
        <span className="ax-nt-quick camera" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M9 4h6l1.6 2.2H20a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.2a2 2 0 0 1 2-2h3.4L9 4Zm3 4.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2Zm0 2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Z" fill="currentColor" /></svg>
        </span>
      </div>
    </PhoneFrame>
  );
}
