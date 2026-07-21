import { useEffect, useMemo, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { sendMessage } from '../../lib/email';
import { fetchTemplates, renderEmailHtml, renderEmailText, DEFAULT_THEME } from '../../lib/emailTemplates';
import { fetchEmailGroups } from '../../lib/emailGroups';
import EmailEditor from './EmailEditor';
import '../care/Modal.css';
import './Email.css';

const clone = x => JSON.parse(JSON.stringify(x));

export default function Composer({ account, reply, onClose, onSent }) {
  const [to, setTo]           = useState(reply?.to || '');
  const [cc, setCc]           = useState('');
  const [showCc, setShowCc]   = useState(false);
  const [subject, setSubject] = useState(reply?.subject || '');
  const [body, setBody]       = useState(reply?.body || '');
  const [sending, setSending] = useState(false);
  const [error, setError]     = useState('');

  const [templates, setTemplates] = useState([]);
  const [design, setDesign]   = useState(null);   // { name, blocks, theme } when a template is applied
  const [editing, setEditing] = useState(false);  // EmailEditor overlay open

  const [groups, setGroups]   = useState({});
  const [groupMenu, setGroupMenu] = useState(false);

  useEffect(() => { fetchTemplates().then(r => setTemplates(r.rows || [])); }, []);
  useEffect(() => { fetchEmailGroups().then(r => setGroups(r.groups || {})); }, []);

  function addGroupToField(rows) {
    const existing = to.split(/[,;]\s*/).map(s => s.trim()).filter(Boolean);
    const seen = new Set(existing.map(e => e.toLowerCase()));
    for (const r of rows) {
      const em = r.email?.trim();
      if (em && !seen.has(em.toLowerCase())) { existing.push(em); seen.add(em.toLowerCase()); }
    }
    setTo(existing.join(', '));
  }

  const previewHtml = useMemo(
    () => design ? renderEmailHtml(design.blocks, design.theme) : '',
    [design],
  );

  function applyTemplate(t) {
    setDesign({ name: t.name, blocks: clone(t.blocks), theme: { ...DEFAULT_THEME, ...(t.theme || {}) } });
  }

  async function send() {
    if (!to.trim()) { setError('Add at least one recipient.'); return; }
    setSending(true); setError('');
    try {
      const payload = { to: to.trim(), cc: cc.trim(), subject };
      if (design) {
        payload.htmlBody = renderEmailHtml(design.blocks, design.theme);
        payload.body = renderEmailText(design.blocks);   // plain-text fallback
      } else {
        payload.body = body;
      }
      await sendMessage(account, payload);
      onSent?.();
      onClose();
    } catch (e) {
      setError(e.message || String(e));
      setSending(false);
    }
  }

  return (
    <div className="cmp">
      <div className="cmp-head">
        <span>New Message</span>
        <button className="cmp-x" onClick={onClose}><Icon d={P.close} size={18} /></button>
      </div>
      <div className="cmp-body">
        <div className="cmp-field">
          <label>To</label>
          <input value={to} onChange={e => setTo(e.target.value)} placeholder="recipient@email.com" autoFocus />
          <div className="cmp-to-actions">
            {!showCc && <button className="cmp-linkbtn" onClick={() => setShowCc(true)}>Cc</button>}
            <button className={`cmp-linkbtn ${groupMenu ? 'on' : ''}`} onClick={() => setGroupMenu(g => !g)}>Group</button>
          </div>
        </div>

        {groupMenu && (
          <div className="cmp-groups">
            {Object.keys(groups).length === 0 ? (
              <span className="cmp-group-empty">No groups yet — create them with the gear in email settings.</span>
            ) : Object.entries(groups).map(([n, rows]) => (
              <button key={n} className="cmp-group-chip" onClick={() => addGroupToField(rows)}>
                {n}<em>{rows.length}</em>
              </button>
            ))}
          </div>
        )}
        {showCc && (
          <div className="cmp-field">
            <label>Cc</label>
            <input value={cc} onChange={e => setCc(e.target.value)} placeholder="cc@email.com" />
          </div>
        )}
        <div className="cmp-field">
          <label>Subject</label>
          <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" />
        </div>

        {/* Template picker row */}
        <div className="cmp-templates">
          <span className="cmp-tpl-label">Design</span>
          <button className={`cmp-tpl-btn ${!design ? 'on' : ''}`} onClick={() => setDesign(null)}>Blank</button>
          {templates.map(t => (
            <button key={t.id} className={`cmp-tpl-btn ${design?.name === t.name ? 'on' : ''}`} onClick={() => applyTemplate(t)}>
              {t.name}
            </button>
          ))}
        </div>

        {design ? (
          <div className="cmp-design">
            <div className="cmp-design-bar">
              <span>{design.name}</span>
              <div>
                <button onClick={() => setEditing(true)}><Icon d={P.edit} size={13} />Edit design</button>
                <button onClick={() => setDesign(null)}>Remove</button>
              </div>
            </div>
            <iframe className="cmp-design-preview" title="Email preview" srcDoc={previewHtml} />
          </div>
        ) : (
          <textarea className="cmp-textarea" value={body} onChange={e => setBody(e.target.value)} placeholder="Write your message…" />
        )}

        {error && <p className="cmp-error">{error}</p>}
      </div>
      <div className="cmp-foot">
        <button className="cmp-send" onClick={send} disabled={sending}>
          <Icon d={P.send} size={15} />{sending ? 'Sending…' : 'Send'}
        </button>
        <span className="cmp-from">from {account?.email || 'no account'}</span>
      </div>

      {editing && (
        <EmailEditor
          initial={design}
          applyLabel="Use in email"
          onApply={(blocks, theme) => { setDesign(d => ({ ...d, blocks, theme })); setEditing(false); }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
