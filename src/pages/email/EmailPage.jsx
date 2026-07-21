import { alertDialog } from "../../lib/dialog";
import { useState, useEffect, useMemo, useCallback } from 'react';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import {
  FOLDERS, fetchAccounts, fetchMessages, removeAccount, isDesktop,
} from '../../lib/email';
import ConnectAccountModal from './ConnectAccountModal';
import Composer from './Composer';
import EmailEditor from './EmailEditor';
import { useSettings } from '../../context/SettingsContext';
import './Email.css';

const FOLDER_ICON = { mail: P.mail, send: P.send, edit: P.edit, spam: P.spam, trash: P.trash };

function initials(name = '') {
  return name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
}
function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return new Date(iso).toLocaleDateString();
}

export default function EmailPage() {
  const { openSettings } = useSettings();
  const [accounts, setAccounts] = useState([]);
  const [active, setActive]     = useState(null);
  const [folder, setFolder]     = useState('INBOX');
  const [messages, setMessages] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [sample, setSample]     = useState(false);
  const [search, setSearch]     = useState('');
  const [connectOpen, setConnectOpen] = useState(false);
  const [compose, setCompose]   = useState(null); // { reply } | {}
  const [editorOpen, setEditorOpen] = useState(false);

  const loadAccounts = useCallback(async () => {
    const list = await fetchAccounts();
    setAccounts(list);
    setActive(a => a || list[0] || null);
  }, []);
  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    const res = await fetchMessages(active, folder);
    setMessages(res.messages || []);
    setSample(!!res.sample);
    setSelected(res.messages?.[0] || null);
    setLoading(false);
  }, [active, folder]);
  useEffect(() => { loadMessages(); }, [loadMessages]);

  const filtered = useMemo(() => {
    if (!search.trim()) return messages;
    const q = search.toLowerCase();
    return messages.filter(m => [m.from_name, m.subject, m.preview, m.from_addr].filter(Boolean).some(v => v.toLowerCase().includes(q)));
  }, [messages, search]);

  const inboxCount = messages.filter(m => m.unread).length;

  return (
    <div className="em-wrap">
      <TopNav onNewClick={() => active ? setCompose({}) : setConnectOpen(true)} />

      <div className="em-shell">
        {/* Header row */}
        <div className="em-topbar">
          <div className="em-title">
            <h1>{FOLDERS.find(f => f.key === folder)?.label || 'Inbox'}</h1>
            <span>{messages.length} Mails</span>
          </div>
          <div className="em-search">
            <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
            <Icon d={P.search} size={18} />
          </div>
        </div>

        <div className="em-body">
          {/* ── Left: folders ── */}
          <aside className="em-sidebar">
            <button className="em-newmail" onClick={() => active ? setCompose({}) : setConnectOpen(true)}>
              <Icon d={P.plus} size={18} />New Mail
            </button>

            <p className="em-group">Mail</p>
            <nav className="em-folders">
              {FOLDERS.map(f => (
                <button key={f.key} className={`em-folder ${folder === f.key ? 'on' : ''}`} onClick={() => setFolder(f.key)}>
                  <Icon d={FOLDER_ICON[f.icon]} size={18} />
                  <span className="em-folder-label">{f.label}</span>
                  {f.key === 'INBOX' && inboxCount > 0 && <span className="em-folder-count">{inboxCount}</span>}
                </button>
              ))}
            </nav>

            <p className="em-group">Accounts</p>
            <div className="em-accounts">
              {accounts.map(a => (
                <button key={a.id} className={`em-account ${active?.id === a.id ? 'on' : ''}`} onClick={() => setActive(a)}>
                  <span className="em-account-avatar">{initials(a.display_name || a.email)}</span>
                  <span className="em-account-email">{a.email}</span>
                </button>
              ))}
              <button className="em-connect" onClick={() => setConnectOpen(true)}>
                <Icon d={P.plus} size={16} />Connect account
              </button>
            </div>

            <div className="em-sidebar-foot">
              <button className="em-foot-btn editor" onClick={() => setEditorOpen(true)}>
                <Icon d={P.form} size={16} />Email Editor
              </button>
              <button className="em-foot-btn gear" onClick={() => openSettings('groups')} title="Settings">
                <Icon d={P.settings} size={18} />
              </button>
            </div>
          </aside>

          {/* ── Middle: message list ── */}
          <section className="em-list">
            {sample && (
              <div className="em-banner">
                {accounts.length === 0
                  ? <>No account connected — showing sample mail. <button onClick={() => setConnectOpen(true)}>Connect Gmail or Yahoo</button></>
                  : <>Preview mode — live sync runs in the desktop app.</>}
              </div>
            )}
            {loading ? (
              <div className="em-empty">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="em-empty">No messages in {FOLDERS.find(f => f.key === folder)?.label}.</div>
            ) : filtered.map(m => (
              <button key={m.id} className={`em-card ${selected?.id === m.id ? 'on' : ''} ${m.unread ? 'unread' : ''}`} onClick={() => setSelected(m)}>
                <div className="em-card-top">
                  <span className="em-card-from">
                    {m.unread && <span className="em-dot" />}
                    {m.from_name || m.from_addr}
                    {m.starred && <Icon d={P.star} size={13} className="em-star" />}
                  </span>
                  <span className="em-card-time">{timeAgo(m.date)}</span>
                </div>
                <p className="em-card-subject">{m.subject}</p>
                <p className="em-card-preview">{m.preview || m.body?.slice(0, 90)}</p>
              </button>
            ))}
          </section>

          {/* ── Right: reading pane ── */}
          <section className="em-reader">
            {selected ? (
              <>
                <h2 className="em-read-subject">{selected.subject}</h2>
                <div className="em-read-from">
                  <span className="em-read-avatar">{initials(selected.from_name || selected.from_addr)}</span>
                  <div className="em-read-fromtext">
                    <span className="em-read-name">{selected.from_name || selected.from_addr}</span>
                    <span className="em-read-addr">{selected.from_addr}</span>
                  </div>
                  <span className="em-read-time">{timeAgo(selected.date)}</span>
                </div>
                <div className="em-read-actions">
                  <button onClick={() => setCompose({ reply: { to: selected.from_addr, subject: `Re: ${selected.subject}`, body: `\n\n---\n${selected.body || ''}` } })}><Icon d={P.reply} size={15} />Reply</button>
                  <button onClick={() => setCompose({ reply: { subject: `Fwd: ${selected.subject}`, body: `\n\n---------- Forwarded ----------\n${selected.body || ''}` } })}><Icon d={P.forward} size={15} />Forward</button>
                  <button onClick={() => alertDialog('Archive — coming soon.')}><Icon d={P.archive} size={15} />Archive</button>
                </div>
                <div className="em-read-body">{selected.body || selected.preview}</div>
              </>
            ) : (
              <div className="em-empty tall">Select a message to read.</div>
            )}
          </section>
        </div>
      </div>

      {connectOpen && <ConnectAccountModal onClose={() => setConnectOpen(false)} onConnected={() => { setConnectOpen(false); loadAccounts(); }} />}
      {compose && <Composer account={active} reply={compose.reply} onClose={() => setCompose(null)} onSent={loadMessages} />}
      {editorOpen && <EmailEditor onClose={() => setEditorOpen(false)} />}
    </div>
  );
}
