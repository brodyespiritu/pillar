import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import { fetchChurchMembers, initials } from '../../lib/members';
import '../home/HomePage.css';
import './reports.css';

/* Grouped query fields (mirrors Realm's report field picker). */
const FIELD_GROUPS = [
  { label: 'Account', options: [
    'Date Last Logged In', 'Date Marked Inactive', 'Individual Status', 'Profile',
  ] },
  { label: 'Check-In', options: [
    'Emergency Contact (Children only)',
  ] },
  { label: 'Contact Info', options: [
    'Address', 'Address Line 1', 'Address Line 2', 'Address City', 'Address Country',
    'Address Postal Code', 'Address Region', 'Address State', 'Email', 'Family Name',
    'First Name', 'Last Name', 'Middle Name', 'Phone Number', 'Preferred Name',
  ] },
  { label: 'Groups', options: [
    'Date First Attended', 'Date Last Attended', 'Group Type', 'Leader Position',
    'Ministry Area', 'Ministry Area Attribute', 'Roster Type',
  ] },
];

/* Which member field a chosen report field reads from the imported directory.
   Fields not present in the imported data are simply omitted (searching them
   tells the user they aren't available yet). */
const nameParts = m => (m.name || '').trim().split(/\s+/).filter(Boolean);
const FIELD_ACCESSORS = {
  'First Name':      m => nameParts(m)[0] || '',
  'Last Name':       m => { const p = nameParts(m); return p.length > 1 ? p[p.length - 1] : ''; },
  'Middle Name':     m => { const p = nameParts(m); return p.length > 2 ? p.slice(1, -1).join(' ') : ''; },
  'Preferred Name':  m => m.name || '',
  'Profile':         m => m.name || '',
  'Family Name':     m => m.family_name || '',
  'Email':           m => m.email || '',
  'Phone Number':    m => m.phone || '',
  'Individual Status': m => m.member_status || m.status || '',
  'Address':          m => m.address || '',
  'Address Line 1':   m => m.address || '',
  'Address Line 2':   m => m.address || '',
  'Address City':     m => m.address || '',
  'Address Country':  m => m.address || '',
  'Address Postal Code': m => m.address || '',
  'Address Region':   m => m.address || '',
  'Address State':    m => m.address || '',
};

const MAX_RESULTS = 60;
const OPERATORS = ['contains', 'is', 'starts with', 'ends with'];

function matches(val, q, op) {
  val = val.toLowerCase();
  switch (op) {
    case 'is':          return val === q;
    case 'starts with': return val.startsWith(q);
    case 'ends with':   return val.endsWith(q);
    default:            return val.includes(q);
  }
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const [field, setField] = useState('');
  const [open, setOpen] = useState(false);
  const [op, setOp] = useState('contains');
  const [q, setQ] = useState('');
  const [members, setMembers] = useState([]);
  const ddRef = useRef(null);

  useEffect(() => { fetchChurchMembers().then(d => setMembers(d.rows || [])); }, []);

  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (ddRef.current && !ddRef.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  function choose(o) { setField(o); setOpen(false); setQ(''); }

  const accessor = FIELD_ACCESSORS[field];
  const query = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!field || !accessor || !query) return [];
    const out = [];
    for (const m of members) {
      const val = accessor(m);
      if (val && matches(val, query, op)) out.push({ m, val });
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }, [members, field, query, op, accessor]);

  const openMember = m => navigate('/members', { state: { openMember: m.id } });

  return (
    <div className="hp2-wrap">
      <TopNav />
      <main className="hp2-scroll">

        {/* ── Hero (grey) ── */}
        <section className="hero">
          <div className="hero-inner">
            <span className="hero-pill">Reporting</span>
            <h1 className="hero-title">Reports</h1>
            <p className="hero-sub">
              Search your congregation by any field — pick one below, then type to
              find matching members.
            </p>

            {/* Custom field dropdown */}
            <div className="rp-field" ref={ddRef}>
              <button
                type="button"
                className={`rp-trigger ${open ? 'open' : ''} ${field ? '' : 'placeholder'}`}
                onClick={() => setOpen(o => !o)}
                aria-haspopup="listbox"
                aria-expanded={open}
              >
                <span className="rp-trigger-label">{field || 'Choose a field…'}</span>
                <Icon d={P.chevron} size={18} className="rp-trigger-ic" />
              </button>

              {open && (
                <div className="rp-menu" role="listbox">
                  {FIELD_GROUPS.map(g => (
                    <div className="rp-group" key={g.label}>
                      <p className="rp-group-label">{g.label}</p>
                      {g.options.map(o => (
                        <button
                          key={o}
                          type="button"
                          role="option"
                          aria-selected={field === o}
                          className={`rp-option ${field === o ? 'selected' : ''}`}
                          onClick={() => choose(o)}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* An "If <field> <operator>" clause animates in, search bar to its right */}
            {field && (
              <div className="rp-clause" key={field}>
                <div className="rp-if">
                  <span className="rp-if-kw">If</span>
                  <span className="rp-if-field">{field}</span>
                  <select className="rp-if-op" value={op} onChange={e => setOp(e.target.value)} aria-label="Condition">
                    {OPERATORS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="rp-search">
                  <Icon d={P.search} size={19} />
                  <input
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder="Value…"
                    autoComplete="off"
                    autoFocus
                  />
                  {q && <button type="button" className="hero-search-x" onClick={() => setQ('')} aria-label="Clear"><Icon d={P.close} size={16} /></button>}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Results (below the grey) ── */}
        <section className="roles">
          <div className="roles-inner">
            {field && !accessor && (
              <p className="rp-note">“{field}” isn’t in your imported data yet. Try First Name, Last Name, Email, Phone Number, Address, or Family Name.</p>
            )}
            {field && accessor && !query && (
              <p className="rp-note">Type above to search members by {field.toLowerCase()}.</p>
            )}
            {field && accessor && query && results.length === 0 && (
              <p className="rp-note">No members match “{q.trim()}” in {field}.</p>
            )}
            {results.length > 0 && (
              <div className="rp-results">
                <p className="rp-results-count">{results.length}{results.length === MAX_RESULTS ? '+' : ''} {results.length === 1 ? 'match' : 'matches'}</p>
                {results.map(({ m, val }) => (
                  <button key={m.id} type="button" className="rp-result" onClick={() => openMember(m)}>
                    <span className="rp-result-avatar">
                      {m.photo_url ? <img src={m.photo_url} alt="" /> : <span>{initials(m.name)}</span>}
                    </span>
                    <span className="rp-result-text">
                      <span className="rp-result-name">{m.name}</span>
                      <span className="rp-result-sub">{field}: {val}</span>
                    </span>
                    <Icon d={P.chevR} size={16} className="rp-result-caret" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
