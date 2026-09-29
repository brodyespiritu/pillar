import { useCallback, useEffect, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { fetchMemberRequests, detailChanges, summary, approveRequest, closeRequest, sinceLabel } from '../../lib/memberRequests';
import './MemberRequests.css';

// Member requests, on Home (2026-09-21): what members asked for from their own profile in the app.
// A change shows each detail as it is → as they'd like it, and a new photo beside the one on file;
// Approve puts it all on their record at once (and the app stops saying "Updating…"). A deletion
// shows their reason; Done once the office has taken care of it. Only shows when something is waiting.

const POLL_MS = 60 * 1000;

function Photo({ src, label }) {
  return (
    <figure className="mr-photo">
      {src ? <img src={src} alt={label} /> : <span className="mr-photo-none">None</span>}
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function Detail({ req, busy, onApprove, onClose, onCancel }) {
  const changes = detailChanges(req);
  const who = req.member?.name || 'A member';
  const del = req.kind === 'delete';
  return (
    <div className="mr-scrim" role="presentation" onClick={onCancel}>
      <div className="mr-card" role="dialog" aria-modal="true" aria-label={`${who}'s request`} onClick={(e) => e.stopPropagation()}>
        <div className="mr-card-head">
          <div>
            <span className={`mr-tag${del ? ' del' : ''}`}>{del ? 'Deletion' : 'Change'}</span>
            <h3 className="mr-who">{who}</h3>
            <p className="mr-when">{sinceLabel(req.created_at)}</p>
          </div>
          <button type="button" className="mr-x" onClick={onCancel} aria-label="Close"><Icon d={P.close} size={16} /></button>
        </div>

        {del ? (
          <p className="mr-said">{req.message || 'They didn’t give a reason.'}</p>
        ) : (
          <>
            {changes.length ? (
              <dl className="mr-changes">
                {changes.map((d) => (
                  <div key={d.key} className="mr-change">
                    <dt>{d.label}</dt>
                    <dd><span className="mr-from">{d.from || 'Not set'}</span><span className="mr-arrow">→</span><strong>{d.to}</strong></dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {req.photo ? (
              <div className="mr-photos">
                <Photo src={req.member?.photo_url} label="On file" />
                <span className="mr-arrow big">→</span>
                <Photo src={req.photo} label="New photo" />
              </div>
            ) : null}
            {req.message ? <p className="mr-said">{req.message}</p> : null}
          </>
        )}

        <div className="mr-actions">
          {del ? (
            <button type="button" className="mr-btn primary" disabled={busy} onClick={() => onClose('done')}>Done</button>
          ) : (
            <button type="button" className="mr-btn primary" disabled={busy} onClick={onApprove}>Approve</button>
          )}
          <button type="button" className="mr-btn" disabled={busy} onClick={() => onClose('declined')}>Decline</button>
        </div>
        {!del && (changes.some((d) => d.key === 'email' || d.key === 'phone')) ? (
          <p className="mr-note">Their email and mobile are how they sign in: after approving, they sign in with the new one.</p>
        ) : null}
      </div>
    </div>
  );
}

export default function MemberRequests() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setRows(await fetchMemberRequests()); setError(''); }
    catch (e) { setRows([]); setError(e.message || 'Couldn’t read the requests.'); }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (!rows || (rows.length === 0 && !error)) return null;

  const finish = async (fn) => {
    setBusy(true);
    try { await fn(); setOpen(null); setRows((l) => l.filter((r) => r.id !== open.id)); setError(''); }
    catch (e) { setError(e.message || 'That didn’t save.'); }
    finally { setBusy(false); load(); }
  };

  return (
    <section className="mr" aria-label="Member requests">
      <div className="mr-head">
        <span className="mr-dot" />
        <h2 className="mr-title">Member requests</h2>
        <span className="mr-count">{rows.length} waiting</span>
      </div>
      <div className="mr-list">
        {rows.map((r) => (
          <button type="button" key={r.id} className="mr-row" onClick={() => setOpen(r)}>
            <span className={`mr-tag${r.kind === 'delete' ? ' del' : ''}`}>{r.kind === 'delete' ? 'Deletion' : 'Change'}</span>
            <span className="mr-main">
              <span className="mr-name">{r.member?.name || 'A member'}</span>
              <span className="mr-sum">{summary(r)}</span>
            </span>
            <span className="mr-since">{sinceLabel(r.created_at)}</span>
          </button>
        ))}
      </div>
      {error ? <p className="mr-err">{error}</p> : null}
      {open ? (
        <Detail req={open} busy={busy} onCancel={() => setOpen(null)}
          onApprove={() => finish(() => approveRequest(open, user?.id))}
          onClose={(outcome) => finish(() => closeRequest(open.id, user?.id, outcome))} />
      ) : null}
    </section>
  );
}
