import { useCallback, useEffect, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { fetchReports, closeReport, sinceLabel, isTheTester } from '../../lib/appReports';
import './AppReports.css';

// ── TESTING · goes when the app's test kit does ───────────────────────────────
//
// What testers sent from the app, in the corner of Home: a line each, newest first. Click one to
// read the whole thing and see what their screen looked like; close it out and it doesn't come back.
// Nobody but the tester running the test sees any of this.

const POLL_MS = 60 * 1000;

/** What they sent with it — a recording plays here, a picture is shown whole. */
function Attachment({ report }) {
  const [broke, setBroke] = useState(false);
  if (broke) {
    return (
      <p className="ar-lost">
        {report.video ? 'The recording wouldn’t play here. ' : 'The picture wouldn’t load here. '}
        <a href={report.link} target="_blank" rel="noreferrer">Open it in a new tab</a>
      </p>
    );
  }
  if (report.video) {
    return (
      <div className="ar-shot">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video src={report.link} controls preload="metadata" onError={() => setBroke(true)} />
        <a className="ar-shot-link" href={report.link} target="_blank" rel="noreferrer">Open the recording</a>
      </div>
    );
  }
  return (
    <div className="ar-shot">
      <a href={report.link} target="_blank" rel="noreferrer">
        <img src={report.link} alt="What the tester's screen looked like" onError={() => setBroke(true)} />
      </a>
      <a className="ar-shot-link" href={report.link} target="_blank" rel="noreferrer">Open it full size</a>
    </div>
  );
}

export default function AppReports() {
  const { profile, user } = useAuth();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mine = isTheTester(profile);

  const load = useCallback(async () => {
    try { setRows(await fetchReports()); setError(''); }
    catch (e) { setRows([]); setError(e.message || 'Couldn’t read the reports.'); }
  }, []);

  useEffect(() => {
    if (!mine) return undefined;
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [mine, load]);

  if (!mine || !rows || rows.length === 0) return null;

  const dismiss = async (id) => {
    setBusy(true);
    setRows((l) => l.filter((r) => r.id !== id));      // it goes at once
    setOpen((o) => (o && o.id === id ? null : o));
    try { await closeReport(id, user?.id); }
    catch (e) { setError(e.message || 'It wouldn’t close.'); load(); }
    finally { setBusy(false); }
  };

  const shown = rows.slice(0, 4);
  const more = rows.length - shown.length;

  return (
    <>
      <aside className="ar" aria-label="Reports from testers">
        <div className="ar-head">
          <span className="ar-dot" />
          <span className="ar-count">{rows.length} from testers</span>
        </div>
        <div className="ar-list">
          {shown.map((r) => (
            <div key={r.id} className="ar-row">
              <button type="button" className="ar-open" onClick={() => setOpen(r)}>
                <span className={`ar-tag ${r.kind}`}>{r.kind === 'praise' ? 'Praise' : 'Bug'}</span>
                <span className="ar-main">
                  <span className="ar-words">{r.words || 'No words'}</span>
                  <span className="ar-who">{[r.from, sinceLabel(r.at)].filter(Boolean).join(' · ')}</span>
                </span>
                {r.link && (r.video
                  ? <span className="ar-thumb film" title="A recording"><Icon d={P.play} size={13} /></span>
                  : <span className="ar-thumb" style={{ backgroundImage: `url("${r.link.replace(/["\\\n]/g, encodeURIComponent)}")` }} />)}
              </button>
              <button type="button" className="ar-x" disabled={busy} title="Close it out"
                aria-label={`Close out ${r.from || 'this report'}`} onClick={() => dismiss(r.id)}>
                <Icon d={P.close} size={15} />
              </button>
            </div>
          ))}
        </div>
        {more > 0 && <div className="ar-more">{`and ${more} more`}</div>}
        {error && <div className="ar-err">{error}</div>}
      </aside>

      {open && (
        <div className="ar-scrim" role="dialog" aria-modal="true" aria-label="Report" onClick={() => setOpen(null)}>
          <div className="ar-card" onClick={(e) => e.stopPropagation()}>
            <div className="ar-card-head">
              <span className={`ar-tag ${open.kind}`}>{open.kind === 'praise' ? 'Praise' : 'Bug'}</span>
              <button type="button" className="ar-x" onClick={() => setOpen(null)} aria-label="Close"><Icon d={P.close} size={17} /></button>
            </div>

            <p className="ar-said">{open.words || 'They didn’t write anything.'}</p>

            {open.link ? <Attachment key={open.id} report={open} /> : null}
            {!open.link && open.lost && (
              <p className="ar-lost">They attached something, but it didn’t make it here.</p>
            )}

            <dl className="ar-facts">
              {[
                ['From', [open.from, open.contact].filter(Boolean).join(' · ')],
                ['Page', open.facts.screen],
                ['Phone', open.facts.phone],
                ['App', open.facts.app],
                ['Sent', [sinceLabel(open.at), open.facts.when].filter(Boolean).join(' · ')],
                ['Signed in as', open.facts['signed in as']],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="ar-fact"><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>

            <div className="ar-card-foot">
              <button type="button" className="ar-keep" onClick={() => setOpen(null)}>Keep it</button>
              <button type="button" className="ar-done" disabled={busy} onClick={() => dismiss(open.id)}>Close it out</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
