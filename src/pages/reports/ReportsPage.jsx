import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import TopNav from '../../components/TopNav';
import { P, Icon } from '../../lib/icons';
import { fetchChurchMembers, initials, isHiddenProspect, isInactive, isArchived, memberTags, assignedToDeacon, groupByFamily } from '../../lib/members';
import { fetchContacts, fetchGroups, fetchMemberships } from '../../lib/broadcast';
import { normPhone, formatPhone } from '../../lib/conversations';
import { printHtml } from '../../lib/printDoc';
import { buildReportDoc, buildDeaconRosterDoc } from './reportDoc';
import '../home/HomePage.css';
import './reports.css';

/*
 * Lists, not search fields: choosing one shows everyone in that state right
 * away. These are people parked out of the directory from a member profile —
 * nothing is deleted, and this is where they're found again.
 */
const LISTS = {
  Prospects: isHiddenProspect,
  Inactive:  isInactive,
};

/* Grouped query fields (mirrors Realm's report field picker). */
/* Everyone on the texting list. Not a member field — it reads sms_contacts,
   which is a different set of people from the directory. */
const SMS_FIELD = 'SMS';

const FIELD_GROUPS = [
  { label: 'Status', options: Object.keys(LISTS) },
  { label: 'Communication', options: [SMS_FIELD] },
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
    /* First, because it is the one in this section that actually searches
       anything — the rest are placeholders from the import format and have no
       accessor behind them yet. 'Group Type' in particular is a different thing
       entirely: a category on an imported roster, not the group a person is in. */
    'Group',
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
  /*
   * Group is the one field a person can hold several of, so it returns a list
   * and the matcher tests each. "is equal to Deacons" then means one of their
   * groups is exactly Deacons, rather than their whole comma-separated tag
   * string being the word Deacons — which no one's ever is.
   *
   * Both senses of "group" are searched: the tags on the member record, and the
   * SMS groups they belong to. The two are separate lists in Pillar and a name
   * like "Deacons" usually exists in both; asking which one somebody meant is
   * not a question worth putting to whoever is running a report.
   */
  'Group':            (m, ctx) => ctx?.groupsOf?.(m) || [],
};

const MAX_RESULTS = 60;
const OPERATORS = ['contains', 'is', 'starts with', 'ends with'];

function matches(val, q, op) {
  /* A multi-valued field matches when any one of its values does. */
  if (Array.isArray(val)) return val.some(v => matches(v, q, op));
  val = String(val || '').toLowerCase();
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
  const [contacts, setContacts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const ddRef = useRef(null);

  useEffect(() => { fetchChurchMembers().then(d => setMembers(d.rows || [])); }, []);
  useEffect(() => { fetchContacts().then(d => setContacts(d.rows || [])); }, []);
  /* Both kinds of group, loaded once: the tags on a member record and the SMS
     groups they are a contact in. */
  useEffect(() => { fetchGroups().then(d => setGroups(d.rows || d || [])); }, []);
  useEffect(() => { fetchMemberships().then(d => setMemberships(d || [])); }, []);

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

  const listFilter = LISTS[field];
  const accessor = FIELD_ACCESSORS[field];

  /*
   * Every group a person belongs to, from both places Pillar keeps them.
   *
   * Tags live on the member record; SMS groups are a separate many-to-many
   * joined through sms_contacts by phone, because a contact row is not the same
   * row as a member. Built once and cached — resolving this per member per
   * keystroke would walk the whole membership table on every character typed.
   */
  const groupsOf = useMemo(() => {
    const nameById = new Map(groups.map(g => [g.id, String(g.name || '').trim()]));
    /* contact id -> the SMS groups that contact is in */
    const byContact = new Map();
    for (const gm of memberships) {
      const n = nameById.get(gm.group_id);
      if (!n) continue;
      if (!byContact.has(gm.contact_id)) byContact.set(gm.contact_id, []);
      byContact.get(gm.contact_id).push(n);
    }
    /* phone -> those same groups, which is how a member is reached from here */
    const byPhone = new Map();
    for (const c of contacts) {
      const k = normPhone(c.phone);
      const gs = byContact.get(c.id);
      if (!k || !gs?.length) continue;
      byPhone.set(k, [...(byPhone.get(k) || []), ...gs]);
    }
    return m => {
      const out = new Set(memberTags(m));
      for (const n of byPhone.get(normPhone(m.phone)) || []) out.add(n);
      return [...out];
    };
  }, [groups, memberships, contacts]);
  const isSms = field === SMS_FIELD;
  const query = q.trim().toLowerCase();

  /* A member row for each texting contact where one exists, so the list can
     show a photo and open the profile. Matched on the number, which is the
     only thing the two tables share. */
  const memberByPhone = useMemo(() => {
    const map = new Map();
    for (const m of members) { const k = normPhone(m.phone); if (k) map.set(k, m); }
    return map;
  }, [members]);

  const smsResults = useMemo(() => {
    if (!isSms) return [];
    const out = [];
    for (const c of contacts) {
      const phone = String(c.phone || '').trim();
      if (!phone) continue;
      const name = c.name || '';
      if (query && !name.toLowerCase().includes(query) && !normPhone(phone).includes(query.replace(/\D/g, ''))) continue;
      const m = memberByPhone.get(normPhone(phone));
      out.push({ m: m || { id: `sms-${c.id}`, name, photo_url: null }, val: formatPhone(phone), contact: c });
    }
    return out.sort((a, b) => (a.m.name || '').localeCompare(b.m.name || ''));
  }, [isSms, contacts, query, memberByPhone]);

  const results = useMemo(() => {
    // A list shows everyone in that state immediately; typing narrows by name.
    if (listFilter) {
      const out = [];
      for (const m of members) {
        if (!listFilter(m)) continue;
        if (query && !(m.name || '').toLowerCase().includes(query)) continue;
        out.push({ m, val: m.name || '' });
        if (out.length >= MAX_RESULTS) break;
      }
      return out;
    }
    if (!field || !accessor || !query) return [];
    const out = [];
    for (const m of members) {
      // Parked records are found through their own list, not general search.
      if (isArchived(m)) continue;
      const val = accessor(m, { groupsOf });
      if (val && matches(val, query, op)) out.push({ m, val });
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }, [members, field, query, op, accessor, listFilter, groupsOf]);

  const shown = isSms ? smsResults : results;

  /* The list as printed — the whole set, not the 60 the screen caps at. */
  function print() {
    const rows = shown.map(({ m, val, contact }) => ({
      name: m.name || '(no name)',
      detail: isSms ? val : (listFilter ? ([m.email, m.phone].filter(Boolean).join(' · ')) : val),
      extra: isSms ? (contact?.email || memberByPhone.get(normPhone(contact?.phone))?.email || '') : '',
    }));
    const { html, filename } = buildReportDoc({
      title: isSms ? 'Pillar SMS list' : field,
      subtitle: isSms
        ? 'Everyone signed up to receive texts from Bethesda Baptist Church'
        : (listFilter ? `Everyone marked ${field.toLowerCase()}` : `${field} ${op} “${q.trim()}”`),
      columns: isSms ? ['Name', 'Mobile', 'Email'] : ['Name', field],
      rows, withExtra: isSms,
    });
    printHtml(html, { filename });
  }

  /*
   * The deacon roster — every deacon and the households they shepherd.
   *
   * Stands apart from the Print button above, which prints whatever the filters
   * are showing. This one always prints the same thing, so it does not depend on
   * anyone having searched the right way first.
   */
  const deaconRoster = useMemo(() => {
    const assigned = members.filter(m => m.deacon_id && !isArchived(m));
    const ids = [...new Set(assigned.map(m => m.deacon_id))];
    const byId = new Map(members.map(m => [m.id, m]));

    return ids
      .map(id => byId.get(id))
      .filter(Boolean)
      .map(d => ({
        name: d.name || '(no name)',
        phone: formatPhone(d.phone) || '',
        /* Grouped into households, so a family of four reads as one visit. */
        households: groupByFamily(assignedToDeacon(assigned, d.id)).map(g => ({
          label: g.label,
          members: g.members.map(m => ({ name: m.name || '', phone: formatPhone(m.phone) || '' })),
        })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [members]);

  function printRoster() {
    const { html, filename } = buildDeaconRosterDoc({ deacons: deaconRoster });
    printHtml(html, { filename });
  }

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
                  <span className="rp-if-kw">{listFilter || isSms ? 'Showing' : 'If'}</span>
                  <span className="rp-if-field">{field}</span>
                  {/* "starts with" is meaningless for a list — it's already the whole set. */}
                  {!listFilter && !isSms && (
                    <select className="rp-if-op" value={op} onChange={e => setOp(e.target.value)} aria-label="Condition">
                      {OPERATORS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  )}
                  {(listFilter || isSms) && <span className="rp-if-count">{shown.length}</span>}
                </div>
                <div className="rp-search">
                  <Icon d={P.search} size={19} />
                  <input
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder={listFilter || isSms ? 'Filter by name…' : 'Value…'}
                    autoComplete="off"
                    autoFocus
                  />
                  {q && <button type="button" className="hero-search-x" onClick={() => setQ('')} aria-label="Clear"><Icon d={P.close} size={16} /></button>}
                </div>
              </div>
            )}

            {/* Under the fields, because it prints whatever they are showing. */}
            {shown.length > 0 && (
              <button type="button" className="rp-print" onClick={print}
                      title={`Print this list of ${shown.length}`}>
                <Icon d={P.print} size={18} />
                <span>Print</span>
              </button>
            )}

            {/* Always available: it does not depend on the filters above. */}
            {deaconRoster.length > 0 && (
              <button type="button" className="rp-print ghost" onClick={printRoster}
                      title={`Print all ${deaconRoster.length} deacons and their families`}>
                <Icon d={P.print} size={18} />
                <span>Print deacon roster</span>
              </button>
            )}
          </div>
        </section>

        {/* ── Results (below the grey) ── */}
        <section className="roles">
          <div className="roles-inner">
            {isSms && shown.length === 0 && (
              <p className="rp-note">
                {query
                  ? `Nobody on the texting list matches “${q.trim()}”.`
                  : 'Nobody is on the texting list yet. Add people from the SMS page, under Contacts.'}
              </p>
            )}
            {field && !accessor && !listFilter && !isSms && (
              <p className="rp-note">“{field}” isn’t in your imported data yet. Try First Name, Last Name, Email, Phone Number, Address, or Family Name.</p>
            )}
            {listFilter && results.length === 0 && (
              <p className="rp-note">
                {query
                  ? `No one in ${field} matches “${q.trim()}”.`
                  : `Nobody is marked ${field.toLowerCase()} right now. Mark someone from their member profile — the ⋯ menu.`}
              </p>
            )}
            {field && accessor && !listFilter && !isSms && !query && (
              <p className="rp-note">Type above to search members by {field.toLowerCase()}.</p>
            )}
            {field && accessor && !listFilter && !isSms && query && results.length === 0 && (
              <p className="rp-note">No members match “{q.trim()}” in {field}.</p>
            )}
            {shown.length > 0 && (
              <div className="rp-results">
                <p className="rp-results-count">{shown.length}{!isSms && shown.length === MAX_RESULTS ? '+' : ''} {shown.length === 1 ? 'match' : 'matches'}</p>
                {shown.map(({ m, val, contact }) => (
                  <button key={m.id} type="button" className="rp-result"
                    onClick={() => String(m.id).startsWith('sms-') ? null : openMember(m)}>
                    <span className="rp-result-avatar">
                      {m.photo_url ? <img src={m.photo_url} alt="" /> : <span>{initials(m.name)}</span>}
                    </span>
                    <span className="rp-result-text">
                      <span className="rp-result-name">{m.name}</span>
                      {/* "Inactive: Ed Inactive" says nothing — for a list, show
                          how to reach them instead. */}
                      <span className="rp-result-sub">
                        {isSms
                          ? ([val, contact?.email || m.email].filter(Boolean).join(' · '))
                          : listFilter
                            ? ([m.email, m.phone].filter(Boolean).join(' · ') || 'No contact details on file')
                            : `${field}: ${val}`}
                      </span>
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
