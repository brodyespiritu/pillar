import { useCallback, useEffect, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { fetchPrayerRequests, closePrayerRequest, sinceLabel } from '../../lib/prayerRequests';
import './PrayerRequests.css';

// Prayer requests from the app, on Home (user, 2026-09-22: "Prayer requests should pop up in pillar
// like the bug reporting"): a line each, newest first, and only while something is waiting. Click one
// to read it whole and see who asked; "Prayed for" closes it out and it doesn't come back.
//
// They arrive through the office's own inbox (src/lib/prayerRequests.js), which is staff-only.

const POLL_MS = 60 * 1000;

export default function PrayerRequests() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setRows(await fetchPrayerRequests()); setError(''); }
    catch (e) { setRows([]); setError(e.message || 'Couldn’t read the prayer requests.'); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (!rows || rows.length === 0) return null;

  const done = async (id) => {
    setBusy(true);
    setRows((l) => l.filter((r) => r.id !== id));     // it goes at once
    setOpen((o) => (o && o.id === id ? null : o));
    try { await closePrayerRequest(id, user?.id); }
    catch (e) { setError(e.message || 'It wouldn’t close.'); load(); }
    finally { setBusy(false); }
  };

  const shown = rows.slice(0, 4);
  const more = rows.length - shown.length;

  return (
    <>
      <aside className="pr" aria-label="Prayer requests from the app">
        <div className="pr-head">
          <span className="pr-mark"><Icon d={P.handshake} size={14} /></span>
          <span className="pr-count">
            {rows.length === 1 ? '1 prayer request' : `${rows.length} prayer requests`}
          </span>
        </div>
        <div className="pr-list">
          {shown.map((r) => (
            <div key={r.id} className="pr-row">
              <button type="button" className="pr-open" onClick={() => setOpen(r)}>
                <span className="pr-main">
                  <span className="pr-words">{r.words || 'They didn’t write anything'}</span>
                  <span className="pr-who">{[r.from, sinceLabel(r.at)].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
              <button type="button" className="pr-x" disabled={busy} title="Prayed for"
                aria-label={`Close out ${r.from || 'this prayer request'}`} onClick={() => done(r.id)}>
                <Icon d={P.check} size={15} />
              </button>
            </div>
          ))}
        </div>
        {more > 0 && <div className="pr-more">{`and ${more} more`}</div>}
        {error && <div className="pr-err">{error}</div>}
      </aside>

      {open && (
        <div className="pr-scrim" role="dialog" aria-modal="true" aria-label="Prayer request" onClick={() => setOpen(null)}>
          <div className="pr-card" onClick={(e) => e.stopPropagation()}>
            <div className="pr-card-head">
              <div>
                <span className="pr-tag">Prayer request</span>
                <h3 className="pr-name">{open.from || 'A member'}</h3>
                <p className="pr-when">{sinceLabel(open.at)}</p>
              </div>
              <button type="button" className="pr-x" onClick={() => setOpen(null)} aria-label="Close">
                <Icon d={P.close} size={17} />
              </button>
            </div>

            <p className="pr-said">{open.words || 'They didn’t write anything.'}</p>

            {open.contact ? (
              <dl className="pr-facts">
                <div className="pr-fact"><dt>Reach them</dt><dd>{open.contact}</dd></div>
              </dl>
            ) : null}

            <div className="pr-card-foot">
              <button type="button" className="pr-keep" onClick={() => setOpen(null)}>Keep it</button>
              <button type="button" className="pr-done" disabled={busy} onClick={() => done(open.id)}>Prayed for</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
