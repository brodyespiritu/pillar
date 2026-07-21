import { useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { WIDGETS, SIZES, SIZE_LABEL } from './widgets';
import { lastContacted, CATEGORY_COLORS } from '../../lib/care';
import { isProspect } from '../../lib/guests';
import { catColor, fmtTime, parseISO } from '../../lib/calendar';

const initials = n => (n || '?').trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
const stop = e => e.stopPropagation();

/* Blue pill text — the "Featured"-style badge */
function badgeText(type, d) {
  switch (type) {
    case 'cares':      return d.attention.length ? `${d.attention.length} to check on` : 'All cared for';
    case 'calendar':   return d.weekEvents ? `${d.weekEvents} this week` : 'Nothing this week';
    case 'guests':     return d.gstats.prospects ? `${d.gstats.prospects} to follow up` : 'All followed up';
    case 'members':    return `${d.memberCount} in directory`;
    case 'email':      return 'Inbox';
    case 'sms':        return 'Broadcast';
    case 'attendance': return d.latest.total ? `≈ ${d.latest.total} last time` : 'Attendance';
    case 'analytics':  return 'Coming soon';
    default:           return '';
  }
}

/* ── interactive bodies (medium / large) ── */
function CaresBody({ size, d, onQuickLog }) {
  if (!d.attention.length) return <p className="hw-calm">🌤️ Everyone’s been cared for.</p>;
  const list = d.attention.slice(0, size === 'large' ? 4 : 2);
  return (
    <div className="hw-rows">
      {list.map(m => (
        <div key={m.id} className="hw-row">
          <span className="hw-ava" style={{ '--c': CATEGORY_COLORS[m.category] || '#8AA0B6' }}>{initials(m.full_name)}</span>
          <span className="hw-row-main">
            <span className="hw-row-name">{m.full_name}</span>
            <span className="hw-row-sub">{m.category} · {lastContacted(m) ? `last ${new Date(lastContacted(m)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'no visits'}</span>
          </span>
          <button className="hw-mini" onClick={e => { stop(e); onQuickLog(m.id); }}>Say hi</button>
        </div>
      ))}
    </div>
  );
}

function CalendarBody({ size, d }) {
  const [open, setOpen] = useState(null);
  if (!d.upcoming.length) return <p className="hw-calm">Nothing scheduled yet.</p>;
  const list = d.upcoming.slice(0, size === 'large' ? 4 : 2);
  return (
    <div className="hw-rows">
      {list.map(e => {
        const dt = parseISO(e.start_date);
        const isOpen = open === e.id;
        return (
          <div key={e.id} className="hw-cal">
            <button className="hw-row hw-rowbtn" onClick={ev => { stop(ev); setOpen(isOpen ? null : e.id); }}>
              <span className="hw-chip" style={{ '--c': catColor(e.category) }}>
                <em>{dt.getDate()}</em><b>{dt.toLocaleDateString('en-US', { month: 'short' })}</b>
              </span>
              <span className="hw-row-main">
                <span className="hw-row-name">{e.title}</span>
                <span className="hw-row-sub">{dt.toLocaleDateString('en-US', { weekday: 'short' })}{e.start_time ? ` · ${fmtTime(e.start_time)}` : ''}</span>
              </span>
              <Icon d={isOpen ? P.arrowUp : P.arrowDown} size={14} />
            </button>
            {isOpen && (
              <div className="hw-cal-detail">
                {e.start_time && <span>🕑 {fmtTime(e.start_time)}{e.end_time ? `–${fmtTime(e.end_time)}` : ''}</span>}
                {e.location && <span>📍 {e.location}</span>}
                {e.category && <span>🏷️ {e.category}</span>}
                {!e.start_time && !e.location && !e.category && <span className="hw-row-sub">No extra details.</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GuestsBody({ size, d, onOpen }) {
  const [tab, setTab] = useState('guests');
  const rows = (d.guests || []).filter(g => (tab === 'prospects' ? isProspect(g) : !isProspect(g)));
  const list = rows.slice(0, size === 'large' ? 4 : 2);
  return (
    <>
      <div className="hw-seg" onClick={stop}>
        <button className={tab === 'guests' ? 'on' : ''} onClick={() => setTab('guests')}>Guests</button>
        <button className={tab === 'prospects' ? 'on' : ''} onClick={() => setTab('prospects')}>Prospects</button>
      </div>
      {list.length === 0 ? <p className="hw-calm">No {tab} yet.</p> : (
        <div className="hw-rows">
          {list.map(g => (
            <button key={g.id} className="hw-row hw-rowbtn" onClick={e => { stop(e); onOpen(g); }}>
              <span className="hw-ava" style={{ '--c': '#8AA0B6' }}>{initials(g.full_name)}</span>
              <span className="hw-row-main">
                <span className="hw-row-name">{g.full_name}</span>
                <span className="hw-row-sub">{g.type}{g.first_visit ? ` · ${new Date(g.first_visit).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</span>
              </span>
              <Icon d={P.arrowRight} size={14} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function MembersBody({ size, d, onOpen }) {
  const [q, setQ] = useState('');
  const rows = (d.memberRows || []);
  const matches = q.trim()
    ? rows.filter(m => [m.name, m.email, m.phone, m.tags].filter(Boolean).some(v => v.toLowerCase().includes(q.toLowerCase())))
    : rows;
  const list = matches.slice(0, size === 'large' ? 4 : 2);
  return (
    <>
      <div className="hw-search" onClick={stop}>
        <Icon d={P.search} size={14} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search members…" />
      </div>
      {list.length === 0 ? <p className="hw-calm">{q ? 'No matches.' : 'No members yet.'}</p> : (
        <div className="hw-rows">
          {list.map(m => (
            <button key={m.id} className="hw-row hw-rowbtn" onClick={e => { stop(e); onOpen(m); }}>
              <span className="hw-ava" style={{ '--c': '#8AA0B6' }}>{m.photo_url ? <img src={m.photo_url} alt="" /> : initials(m.name)}</span>
              <span className="hw-row-main">
                <span className="hw-row-name">{m.name}</span>
                <span className="hw-row-sub">{m.tags || m.email || m.phone || 'Member'}</span>
              </span>
              <Icon d={P.arrowRight} size={14} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function StatBody({ type, d }) {
  const MAP = {
    cares:      { n: d.care.active, label: 'in care' },
    calendar:   { n: d.weekEvents, label: 'this week' },
    guests:     { n: d.gstats.prospects, label: 'to follow up' },
    members:    { n: d.memberCount, label: 'members' },
    email:      { n: null, label: 'Read & compose' },
    sms:        { n: null, label: 'Text everyone' },
    attendance: { n: d.latest.total ? `≈${d.latest.total}` : '—', label: 'last gathering' },
  }[type] || { n: null, label: '' };
  return (
    <div className="hw-stat">
      {MAP.n !== null ? <span className="hw-big">{MAP.n}</span> : null}
      <span className="hw-stat-label">{MAP.label}</span>
    </div>
  );
}

function Content({ type, size, d, onQuickLog, onOpen }) {
  if (WIDGETS[type].soon) return <p className="hw-soon-text">Usage & trends — we’re wiring this up next.</p>;
  const rich = size !== 'small';
  if (rich && type === 'cares')    return <CaresBody size={size} d={d} onQuickLog={onQuickLog} />;
  if (rich && type === 'calendar') return <CalendarBody size={size} d={d} />;
  if (rich && type === 'guests')   return <GuestsBody size={size} d={d} onOpen={onOpen} />;
  if (rich && type === 'members')  return <MembersBody size={size} d={d} onOpen={onOpen} />;
  return <StatBody type={type} d={d} />;
}

export default function HomeWidget({ item, data, editing, dragging, onClick, onOpenItem, onQuickLog,
  onRemove, onResize, onDragStart, onDragEnd, onDragOver, onDrop }) {
  const meta = WIDGETS[item.type];
  if (!meta) return null;

  return (
    <div
      className={`hw ${item.size} ${editing ? 'editing' : ''} ${dragging ? 'dragging' : ''}`}
      draggable={editing}
      onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={onDragOver} onDrop={onDrop}
      onClick={() => { if (!editing) onClick(); }}
      role="button"
    >
      <div className="hw-top">
        <span className="hw-badge">{badgeText(item.type, data)}</span>
        <span className="hw-mark"><Icon d={meta.icon} size={15} /></span>
      </div>

      <div className="hw-title">{meta.title}</div>

      <div className="hw-main">
        <Content type={item.type} size={item.size} d={data} onQuickLog={onQuickLog} onOpen={onOpenItem} />
      </div>

      {meta.action && (
        <div className="hw-action">{meta.action}<Icon d={P.arrowRight} size={15} /></div>
      )}

      {editing && (
        <>
          <button className="hw-remove" onClick={e => { e.stopPropagation(); onRemove(); }} title="Remove"><Icon d={P.close} size={13} /></button>
          <div className="hw-sizes" onClick={e => e.stopPropagation()}>
            {SIZES.filter(s => meta.sizes.includes(s)).map(s => (
              <button key={s} className={item.size === s ? 'on' : ''} onClick={() => onResize(s)}>{SIZE_LABEL[s]}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
