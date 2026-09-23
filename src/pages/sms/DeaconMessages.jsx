import { useEffect, useMemo, useRef, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import {
  fetchDeaconMessages, buildDeaconThreads, formatPhone, sepLabel, stampLabel, readableSendError,
} from '../../lib/deaconMessages';
import './DeaconMessages.css';

/*
 * Every text a deacon was sent, one thread per deacon.
 *
 * Deacon alerts are written by the care digest, not by anyone at a keyboard, so
 * this is a record rather than a conversation: what went out, when, whether it
 * arrived, and anything the deacon texted back. To write to a deacon, the
 * composer on the Broadcast tab sends to them like anyone else.
 *
 * Which rows arrive here is decided by row-level security
 * (supabase/sms-deacon-visibility.sql), not by this file.
 */

const initials = n => (n || '#').trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '#';
const preview = m => {
  if (!m) return 'Nothing sent yet';
  const text = String(m.body || '').replace(/\s+/g, ' ').trim();
  if (m.direction === 'in') return text;
  return `${m.undelivered ? 'Not delivered: ' : 'Sent: '}${text}`;
};
const ordinal = n => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export default function DeaconMessages({ deacons }) {
  const [rows, setRows] = useState([]);
  const [blocked, setBlocked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [activeKey, setActiveKey] = useState(null);
  const scrollRef = useRef(null);

  async function refresh() {
    const { rows, blocked } = await fetchDeaconMessages();
    setRows(rows);
    setBlocked(blocked);
    setLoaded(true);
  }
  useEffect(() => { refresh(); }, []);

  const threads = useMemo(() => buildDeaconThreads(rows, deacons || []), [rows, deacons]);

  const listed = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(t => [t.label, t.phone10, t.last?.body]
      .filter(Boolean).some(v => String(v).toLowerCase().includes(q)));
  }, [threads, search]);

  const active = useMemo(
    () => listed.find(t => t.phone10 === activeKey) || threads.find(t => t.phone10 === activeKey) || null,
    [listed, threads, activeKey],
  );

  /* Newest message in view when a thread opens, the way a messages app does. */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeKey, rows]);

  const totals = useMemo(() => ({
    sent: threads.reduce((n, t) => n + t.sent, 0),
    replies: threads.reduce((n, t) => n + t.replies, 0),
    reached: threads.filter(t => t.sent > 0).length,
  }), [threads]);

  return (
    <div className="dm-shell">
      <aside className="dm-side">
        <div className="dm-side-head">
          <div>
            <h2>Deacons</h2>
            <p className="dm-side-sub">
              {loaded && !blocked
                ? `${totals.sent} sent to ${totals.reached} of ${threads.length}${totals.replies ? ` · ${totals.replies} replied` : ''}`
                : 'Care alerts sent to each deacon'}
            </p>
          </div>
          <button className="dm-refresh" onClick={refresh} title="Refresh" aria-label="Refresh">
            <Icon d={P.repeat} size={16} />
          </button>
        </div>

        <div className="dm-search">
          <Icon d={P.search} size={15} />
          <input placeholder="Search deacons or messages" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="dm-list">
          {!loaded && <p className="dm-note">Loading…</p>}
          {loaded && blocked && (
            <p className="dm-note">
              These messages aren't readable with your access. An admin can grant Cares access,
              or run <strong>supabase/sms-deacon-visibility.sql</strong> if it hasn't been run yet.
            </p>
          )}
          {loaded && !blocked && listed.length === 0 && (
            <p className="dm-note">{search.trim() ? 'Nothing matches that search.' : 'No deacons in the directory yet.'}</p>
          )}
          {listed.map(t => (
            <button key={t.phone10} className={`dm-thread ${t.phone10 === activeKey ? 'on' : ''}`}
              onClick={() => setActiveKey(t.phone10)}>
              <span className="dm-ava">{initials(t.label)}</span>
              <span className="dm-thread-main">
                <span className="dm-thread-top">
                  <span className="dm-thread-name">{t.label}</span>
                  {t.lastAt && <span className="dm-thread-time">{stampLabel(t.lastAt)}</span>}
                </span>
                <span className={`dm-thread-prev ${t.sent || t.replies ? '' : 'quiet'}`}>{preview(t.last)}</span>
              </span>
              {t.failed > 0 && <span className="dm-flag" title={`${t.failed} never delivered`}>!</span>}
            </button>
          ))}
        </div>
      </aside>

      <section className="dm-main">
        {active ? (
          <>
            <header className="dm-head">
              <span className="dm-ava sm">{initials(active.label)}</span>
              <div className="dm-head-info">
                <span className="dm-head-name">{active.label}</span>
                <span className="dm-head-sub">
                  {formatPhone(active.phone10)} · {active.sent} delivered
                  {active.late ? ` (${active.late} on a retry)` : ''}
                  {active.replies ? ` · ${active.replies} replied` : ''}
                  {active.failed ? ` · ${active.failed} never delivered` : ''}
                </span>
              </div>
            </header>

            <div className="dm-scroll" ref={scrollRef}>
              {active.items.length === 0 ? (
                <p className="dm-empty-thread">Nothing has been sent to {active.label} yet.</p>
              ) : active.items.map((m, i) => {
                const prev = active.items[i - 1];
                const dir = m.direction === 'in' ? 'in' : 'out';
                const showSep = !prev || (new Date(m.created_at) - new Date(prev.created_at)) > 30 * 60 * 1000;
                const reason = readableSendError(m.undelivered ? m.error : m.delayedBy);
                return (
                  <div key={m.id || i}>
                    {showSep && <div className="dm-sep">{sepLabel(m.created_at)}</div>}
                    <div className={`dm-msg ${dir}`}>
                      <div className={`dm-bubble ${m.undelivered ? 'failed' : ''}`}>{m.body}</div>
                    </div>
                    {m.undelivered ? (
                      <div className="dm-failed">
                        Never delivered{m.retries ? ` after ${m.retries + 1} tries` : ''}{reason ? ` — ${reason}` : ''}
                      </div>
                    ) : m.retries > 0 && (
                      <div className="dm-retried">
                        Went through on the {ordinal(m.retries + 1)} try · first tried {sepLabel(m.firstTriedAt)}
                        {reason ? ` · ${reason}` : ''}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="dm-foot">
              A record of what went out. To write to {active.label}, use the composer on Broadcast.
            </p>
          </>
        ) : (
          <div className="dm-placeholder">
            <div className="dm-placeholder-ic"><Icon d={P.shield} size={30} /></div>
            <p>Select a deacon</p>
            <span>Care alerts go to each deacon about their own families. Pick a name to read what they were sent.</span>
          </div>
        )}
      </section>
    </div>
  );
}
