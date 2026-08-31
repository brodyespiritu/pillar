import { useState, useMemo, useRef, useId } from 'react';
import { P, Icon } from '../../lib/icons';
import { createLocation, locationKey } from '../../lib/locations';

/*
 * Searchable location picker for the event wizard.
 *
 * The value is the location NAME, not an id — events.location is text and the
 * church website reads it directly, so the picker has to hand back a name.
 *
 * The list renders in-flow rather than floating, matching the care form's
 * typeahead: inside a modal a floating list clips at the edge.
 */
export default function LocationPicker({ value, onChange, locations = [], onCreated, autoFocus }) {
  const [query, setQuery]   = useState(value || '');
  const [open, setOpen]     = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');
  const listId = useId();
  const blurTimer = useRef(null);

  const matches = useMemo(() => {
    const q = locationKey(query);
    if (!q) return locations;
    return locations.filter(l => locationKey(l.name).includes(q));
  }, [locations, query]);

  // Offer to create only when the typed name isn't already a location.
  const typed = query.trim();
  const exact = locations.some(l => locationKey(l.name) === locationKey(typed));
  const canCreate = !!typed && !exact;
  const rows = canCreate ? [...matches, { __create: true }] : matches;

  function commit(name) {
    setQuery(name);
    onChange(name);
    setOpen(false);
    setError('');
  }

  async function create(name) {
    setBusy(true); setError('');
    const { data, error: err } = await createLocation(name);
    setBusy(false);
    if (err) { setError(err.message); return; }
    onCreated?.(data);
    commit(data.name);
  }

  function choose(row) {
    if (row?.__create) return create(typed);
    if (row) commit(row.name);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(0); return; }
      if (!rows.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive(i => (i + d + rows.length) % rows.length);
      return;
    }
    if (e.key === 'Enter') {
      // Only intercept Enter while choosing — otherwise the wizard advances.
      if (open && rows.length) { e.preventDefault(); choose(rows[Math.min(active, rows.length - 1)]); }
      return;
    }
    if (e.key === 'Tab') setOpen(false);
  }

  return (
    <div className="loc-pick">
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && rows.length ? `${listId}-${Math.min(active, rows.length - 1)}` : undefined}
        value={query}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="Search rooms — or type a new one"
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150); }}
        onKeyDown={onKeyDown}
      />

      {open && (
        <div className="loc-list" id={listId} role="listbox"
          onMouseDown={() => clearTimeout(blurTimer.current)}>
          {rows.length === 0 && <p className="loc-none">No rooms yet — type a name to add one.</p>}

          {rows.map((row, i) => (row.__create ? (
            <button type="button" key="__create" id={`${listId}-${i}`} role="option"
              aria-selected={i === active}
              className={`loc-item loc-new ${i === active ? 'on' : ''}`}
              disabled={busy}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(row)}>
              <span className="loc-thumb loc-thumb-new"><Icon d={P.plus} size={16} /></span>
              <span className="loc-item-text">
                <span className="loc-name">{busy ? 'Adding…' : `Add "${typed}"`}</span>
                <span className="loc-sub">Creates a new location</span>
              </span>
            </button>
          ) : (
            <button type="button" key={row.id} id={`${listId}-${i}`} role="option"
              aria-selected={i === active}
              className={`loc-item ${i === active ? 'on' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(row)}>
              {row.photo_url
                ? <img className="loc-thumb" src={row.photo_url} alt="" loading="lazy" />
                : <span className="loc-thumb loc-thumb-empty"><Icon d={P.location} size={15} /></span>}
              <span className="loc-item-text">
                <span className="loc-name">{row.name}</span>
                <span className="loc-sub">{row.photo_url ? 'Has photo' : 'No photo yet'}</span>
              </span>
            </button>
          )))}
        </div>
      )}

      {error && <span className="field-err">{error}</span>}
    </div>
  );
}
