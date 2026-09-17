import { useEffect, useMemo, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { useAuth } from '../../context/AuthContext';
import { fetchMembers } from '../../lib/care';
import { fetchAccounts } from '../../lib/email';
import { fetchEmailGroups } from '../../lib/emailGroups';
import { confirmDialog } from '../../lib/dialog';
import { tapOpen, tapClose, tapSelect, tapConfirm, tapSaved, tapFailed } from '../../lib/haptics';
import {
  careUpdateList, careUpdateSubject, careUpdateText, careUpdateHtml,
  sendCareUpdates, lastGroup, rememberGroup,
} from '../../lib/careUpdates';
import './CareUpdatesSheet.css';

/*
 * The Update card: email everyone's latest care update to one email group.
 *
 * Pick the list, see exactly who is on it and what they will get, send. One
 * message per person, so nobody sees the rest of the list.
 */
export default function CareUpdatesSheet({ members: given, onClose }) {
  const { user, profile } = useAuth();
  const sender = profile?.name || '';
  const [members, setMembers] = useState(given || []);
  const [groups, setGroups] = useState(null);         // { name: [{ email, name }] }
  const [missing, setMissing] = useState(false);
  const [account, setAccount] = useState(null);
  const [group, setGroup] = useState('');
  const [showText, setShowText] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);         // { sent, failed }
  const [error, setError] = useState('');

  useEffect(() => {
    tapOpen();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = e => { if (e.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    (async () => {
      /* Fresh from the database, so an update logged a minute ago is in it. */
      const [fresh, g, accts] = await Promise.all([fetchMembers(), fetchEmailGroups(), fetchAccounts()]);
      if (!live) return;
      if (fresh?.length) setMembers(fresh);
      setGroups(g.groups || {});
      setMissing(!!g.missing);
      setAccount(accts.find(a => a.app_password) || accts[0] || null);
      const names = Object.keys(g.groups || {});
      const remembered = lastGroup();
      setGroup(names.includes(remembered) ? remembered
        : names.find(n => /deacon/i.test(n)) || names[0] || '');
    })();
    return () => { live = false; };
  }, []);

  const list = useMemo(() => careUpdateList(members), [members]);
  const people = useMemo(() => (groups?.[group] || []).filter(r => /\S+@\S+\.\S+/.test(r.email || '')), [groups, group]);
  const subject = useMemo(() => careUpdateSubject(), []);
  const text = useMemo(() => careUpdateText(list, { group, sender }), [list, group, sender]);

  function close() {
    if (sending) return;
    tapClose();
    onClose();
  }

  async function send(targets = people.map(p => p.email)) {
    if (!targets.length || sending) return;
    const ok = await confirmDialog({
      title: 'Email care updates?',
      message: `${list.total} ${list.total === 1 ? 'person\'s' : 'people\'s'} latest care update will go to ${targets.length} ${targets.length === 1 ? 'person' : 'people'} on ${group}. These are private care details.`,
      confirmLabel: `Send to ${targets.length}`,
    });
    if (!ok) return;
    tapConfirm();
    setSending(true); setError(''); setResult(null);
    setProgress({ done: 0, total: targets.length, sent: 0, failed: 0 });
    try {
      const res = await sendCareUpdates({
        account, recipients: targets, subject, text,
        html: careUpdateHtml(list, { group, sender }),
        senderName: sender, createdBy: user?.id, onProgress: setProgress,
      });
      rememberGroup(group);
      setResult(res);
      if (res.failed.length) tapFailed(); else tapSaved();
    } catch (e) {
      setError(String(e?.message || e));
      tapFailed();
    }
    setSending(false);
  }

  const failedEmails = (result?.failed || []).map(f => f.email);
  const names = Object.keys(groups || {});

  return (
    <div className="cu-scrim" onClick={close}>
      <div className="cu-sheet" role="dialog" aria-label="Email care updates" onClick={e => e.stopPropagation()}>
        <div className="cu-grab" />
        <button className="cu-x" onClick={close} aria-label="Close" disabled={sending}>
          <Icon d={P.close} size={20} />
        </button>

        <div className="cu-body">
          <h2 className="cu-title">Email care updates</h2>
          <p className="cu-sub">
            The latest update for everyone in care
            {members.length ? ` — ${list.total} ${list.total === 1 ? 'person' : 'people'}` : ''}.
          </p>

          {result ? (
            <div className={`cu-done ${failedEmails.length ? 'warn' : ''}`}>
              <div className="cu-done-ic"><Icon d={failedEmails.length ? P.shield : P.check} size={24} /></div>
              <h3>{result.sent
                ? `Sent to ${result.sent} ${result.sent === 1 ? 'person' : 'people'}`
                : 'Nothing was sent'}</h3>
              {failedEmails.length > 0 && (
                <>
                  <p>These did not go out: {failedEmails.join(', ')}</p>
                  <p className="cu-err-detail">{result.failed[0].error}</p>
                </>
              )}
            </div>
          ) : sending ? (
            <div className="cu-sending">
              <p className="cu-sending-h">Sending {Math.min((progress?.done || 0) + 1, progress?.total || 1)} of {progress?.total || 0}…</p>
              <div className="cu-bar"><span style={{ width: `${progress?.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
              <p className="cu-sending-note">Keep this open until it finishes.</p>
            </div>
          ) : (
            <>
              <h3 className="cu-label">Send to</h3>
              {groups === null ? (
                <p className="cu-muted">Loading lists…</p>
              ) : missing || !names.length ? (
                <p className="cu-muted">No email lists yet. Add one in Settings, under Email Groups.</p>
              ) : (
                <div className="cu-groups" role="radiogroup" aria-label="Email list">
                  {names.map(n => (
                    <button key={n} type="button" role="radio" aria-checked={group === n}
                      className={`cu-group ${group === n ? 'on' : ''}`}
                      onClick={() => { tapSelect(); setGroup(n); }}>
                      <span className="cu-group-name">{n}</span>
                      <span className="cu-group-n">{(groups[n] || []).length}</span>
                    </button>
                  ))}
                </div>
              )}

              {group && (
                <div className="cu-people">
                  {people.length ? people.map(p => (
                    <span key={p.id || p.email} className="cu-person" title={p.email}>
                      {p.name || p.email}
                    </span>
                  )) : <span className="cu-muted">Nobody on {group} has an email address yet.</span>}
                </div>
              )}

              <div className="cu-what">
                <div className="cu-what-head">
                  <div>
                    <h3 className="cu-label">What they'll get</h3>
                    <p className="cu-subject">{subject}</p>
                  </div>
                  <button type="button" className="cu-link" onClick={() => setShowText(s => !s)}>
                    {showText ? 'Hide' : 'Preview'}
                  </button>
                </div>
                {showText && <pre className="cu-preview">{text}</pre>}
              </div>
            </>
          )}

          {error && <p className="cu-error">{error}</p>}
        </div>

        {result ? (
          <div className="cu-foot">
            {failedEmails.length > 0 && (
              <button className="cu-send ghost" onClick={() => send(failedEmails)}>Try those again</button>
            )}
            <button className="cu-send" onClick={close}>Done</button>
          </div>
        ) : (
          <div className="cu-foot">
            <button className="cu-send" onClick={() => send()}
              disabled={sending || !people.length || !members.length}>
              <Icon d={P.send} size={18} />
              {sending ? 'Sending…' : people.length
                ? `Send to ${people.length} ${people.length === 1 ? 'person' : 'people'}`
                : 'Send'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
