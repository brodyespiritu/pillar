import { useEffect, useMemo, useRef, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { fetchThreads, sendText, markRead, normPhone, formatPhone } from '../../lib/conversations';
import './conversations.css';

const initials = n => (n || '#').trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '#';

function sepLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${time}`;
}

export default function ConversationsModal({ guests = [], onClose }) {
  const [threads, setThreads] = useState([]);
  const [missing, setMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [activeKey, setActiveKey] = useState(null);
  const [draft, setDraft] = useState(null);   // transient thread for a brand-new message
  const [search, setSearch] = useState('');
  const [compose, setCompose] = useState('');
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState(false);
  const [guestSearch, setGuestSearch] = useState('');
  const scrollRef = useRef(null);

  const guestByPhone = useMemo(() => {
    const m = {};
    for (const g of guests) if (g.phone?.trim()) m[normPhone(g.phone)] = g;
    return m;
  }, [guests]);

  const displayName = t => t.name || guestByPhone[t.key]?.full_name || formatPhone(t.number);

  async function refresh() {
    const { rows, missing } = await fetchThreads();
    setThreads(rows); setMissing(missing); setLoaded(true);
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const id = setInterval(refresh, 12000);   // live-ish: pick up replies
    return () => clearInterval(id);
  }, []);

  // Conversations list = threads where the person replied (per the feature spec).
  const listed = useMemo(() => {
    let rows = threads.filter(t => t.hasInbound);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(t => [displayName(t), t.number, t.lastBody].filter(Boolean).some(v => v.toLowerCase().includes(q)));
    }
    return rows;
  }, [threads, search, guestByPhone]);

  // Resolve the active thread (a real one, or the transient draft).
  const active = useMemo(() => {
    const real = threads.find(t => t.key === activeKey);
    if (real) return real;
    if (draft && draft.key === activeKey) return draft;
    return null;
  }, [threads, draft, activeKey]);

  // Mark inbound read + scroll to bottom when the active thread updates.
  useEffect(() => {
    if (active?.unreadIds?.length) markRead(active.unreadIds).then(refresh);
  }, [active?.key, active?.messages?.length]); // eslint-disable-line
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.key, active?.messages?.length]);

  function openThread(key) { setPicking(false); setActiveKey(key); }
  function startWith(guest) {
    const key = normPhone(guest.phone);
    setDraft({ key, number: guest.phone, name: guest.full_name, messages: [], unreadIds: [] });
    setActiveKey(key); setPicking(false); setGuestSearch('');
  }

  async function send() {
    const text = compose.trim();
    if (!text || !active || sending) return;
    setSending(true);
    await sendText({ number: active.number, name: active.name || displayName(active), body: text });
    setCompose('');
    await refresh();
    setSending(false);
  }

  const pickList = useMemo(() => {
    const q = guestSearch.trim().toLowerCase();
    return guests
      .filter(g => g.phone?.trim())
      .filter(g => !q || [g.full_name, g.phone].filter(Boolean).some(v => v.toLowerCase().includes(q)))
      .slice(0, 40);
  }, [guests, guestSearch]);

  return (
    <div className="cv-overlay" onClick={onClose}>
      <div className="cv-modal" onClick={e => e.stopPropagation()}>
        {/* ── Sidebar ── */}
        <aside className="cv-side">
          <div className="cv-side-head">
            <h2>Messages</h2>
            <button className="cv-new" title="New message" onClick={() => { setPicking(true); setActiveKey(null); }}>
              <Icon d={P.edit} size={17} />
            </button>
          </div>
          <div className="cv-search">
            <Icon d={P.search} size={15} />
            <input placeholder="Search" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="cv-list">
            {!loaded && <div className="cv-list-empty">Loading…</div>}
            {loaded && missing && <div className="cv-list-empty">Run sms-inbound-schema.sql to enable conversations.</div>}
            {loaded && !missing && listed.length === 0 && (
              <div className="cv-list-empty">No replies yet. When someone texts back, they'll show up here.</div>
            )}
            {listed.map(t => (
              <button key={t.key} className={`cv-thread ${t.key === activeKey ? 'on' : ''}`} onClick={() => openThread(t.key)}>
                <span className="cv-ava">{initials(displayName(t))}</span>
                <span className="cv-thread-main">
                  <span className="cv-thread-top">
                    <span className="cv-thread-name">{displayName(t)}</span>
                    <span className="cv-thread-time">{new Date(t.lastAt).toLocaleDateString([], { month: 'numeric', day: 'numeric' })}</span>
                  </span>
                  <span className="cv-thread-prev">{t.lastDir === 'out' ? 'You: ' : ''}{t.lastBody}</span>
                </span>
                {t.unreadIds.length > 0 && <span className="cv-unread" />}
              </button>
            ))}
          </div>
        </aside>

        {/* ── Thread / compose ── */}
        <section className="cv-main">
          <button className="cv-close" onClick={onClose} aria-label="Close"><Icon d={P.close} size={18} /></button>

          {picking ? (
            <div className="cv-pick">
              <div className="cv-pick-head">New message</div>
              <div className="cv-search cv-pick-search">
                <Icon d={P.search} size={15} />
                <input autoFocus placeholder="Search guests…" value={guestSearch} onChange={e => setGuestSearch(e.target.value)} />
              </div>
              <div className="cv-pick-list">
                {pickList.length === 0 && <div className="cv-list-empty">No guests with a phone number.</div>}
                {pickList.map(g => (
                  <button key={g.id} className="cv-pick-row" onClick={() => startWith(g)}>
                    <span className="cv-ava sm">{initials(g.full_name)}</span>
                    <span className="cv-pick-info">
                      <span className="cv-thread-name">{g.full_name}</span>
                      <span className="cv-thread-prev">{formatPhone(g.phone)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : active ? (
            <>
              <header className="cv-conv-head">
                <span className="cv-ava sm">{initials(displayName(active))}</span>
                <div className="cv-conv-headinfo">
                  <span className="cv-conv-name">{displayName(active)}</span>
                  <span className="cv-conv-num">{formatPhone(active.number)}</span>
                </div>
              </header>

              <div className="cv-scroll" ref={scrollRef}>
                {active.messages.length === 0 && (
                  <div className="cv-thread-empty">Start of your conversation with {displayName(active)}.</div>
                )}
                {active.messages.map((m, i) => {
                  const prev = active.messages[i - 1];
                  const dir = m.direction || 'out';
                  const showSep = !prev || (new Date(m.created_at) - new Date(prev.created_at)) > 30 * 60 * 1000;
                  const failed = dir === 'out' && m.status === 'Failed';
                  return (
                    <div key={m.id || i}>
                      {showSep && <div className="cv-sep">{sepLabel(m.created_at)}</div>}
                      <div className={`cv-msg ${dir}`}>
                        <div className={`cv-bubble ${failed ? 'failed' : ''}`}>{m.body}</div>
                      </div>
                      {failed && <div className="cv-failed">Not delivered</div>}
                    </div>
                  );
                })}
              </div>

              <div className="cv-compose">
                <textarea
                  rows={1}
                  placeholder="Text message"
                  value={compose}
                  onChange={e => setCompose(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                />
                <button className="cv-send" onClick={send} disabled={sending || !compose.trim()} title="Send">
                  <Icon d={P.arrowUp} size={18} />
                </button>
              </div>
            </>
          ) : (
            <div className="cv-placeholder">
              <div className="cv-placeholder-ic"><Icon d={P.chat} size={30} /></div>
              <p>Select a conversation</p>
              <span>Replies to your texts appear on the left. Start a new one with the pencil.</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
