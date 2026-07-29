import { useEffect, useMemo, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import {
  fetchRecentReads, sampleHistory, SECTION_LABELS, CAPACITY, heatColor,
} from '../../lib/attendance';
import WorshipMap from './WorshipMap';
import AttendanceIntakeModal from './AttendanceIntakeModal';
import TopNav from '../../components/TopNav';
import './attendance.css';

const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
const fmtLong = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' }) : '—';

export default function AttendanceFullScreen({ onClose }) {
  const [history, setHistory] = useState([]);
  const [isSample, setIsSample] = useState(true);
  const [idx, setIdx] = useState(0);          // index into history (selected service)
  const [view, setView] = useState('map');     // 'map' | 'trends'
  const [section, setSection] = useState('All');
  const [hoverZone, setHoverZone] = useState(null);
  const [intake, setIntake] = useState(false);

  const load = async () => {
    let real = null;
    try { real = await fetchRecentReads(8); } catch { /* ignore */ }
    const h = real || sampleHistory(8);
    setHistory(h);
    setIsSample(!real);
    setIdx(h.length - 1);
  };
  useEffect(() => { load(); }, []);

  const read = history[idx] || null;
  const highlight = section === 'All' ? null : section;

  // Escape closes
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const zoneReadout = useMemo(() => {
    if (!read || !hoverZone) return null;
    const z = (read.zones || []).find(z => z.zone_key === hoverZone);
    return z ? { ...z } : null;
  }, [read, hoverZone]);

  return (
    <div className="afs-overlay">
      <TopNav />
      <div className="afs-body">
      <aside className="afs-rail">
        <div className="afs-rail-head">
          <div>
            <p className="afs-eyebrow">Bethesda Baptist Church</p>
            <h2>Attendance</h2>
          </div>
        </div>

        {/* View toggle */}
        <div className="afs-seg">
          <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>Heat map</button>
          <button className={view === 'trends' ? 'on' : ''} onClick={() => setView('trends')}>Trends</button>
        </div>

        {/* Service selector (map view) */}
        {view === 'map' && (
          <label className="afs-select">
            <span>Service</span>
            <select value={idx} onChange={e => setIdx(Number(e.target.value))}>
              {history.map((h, i) => (
                <option key={i} value={i}>{fmtLong(h.service_date)} · {h.total}</option>
              ))}
            </select>
          </label>
        )}

        {/* Area filter */}
        <div className="afs-group">
          <p className="afs-group-title">Areas</p>
          <div className="afs-chips">
            <button className={section === 'All' ? 'on' : ''} onClick={() => setSection('All')}>All areas</button>
            {SECTION_LABELS.map(s => (
              <button key={s} className={section === s ? 'on' : ''} onClick={() => setSection(s)}>{s}</button>
            ))}
          </div>
        </div>

        {/* Per-section breakdown for the selected service */}
        {read && (
          <div className="afs-group">
            <p className="afs-group-title">By area · {fmtDate(read.service_date)}</p>
            <div className="afs-breakdown">
              {SECTION_LABELS.map(s => {
                const t = read.sections?.[s] || { estimate: 0, capacity: 0 };
                const pct = t.capacity ? Math.round((t.estimate / t.capacity) * 100) : 0;
                return (
                  <button key={s} className={`afs-brow ${section === s ? 'on' : ''}`} onClick={() => setSection(section === s ? 'All' : s)}>
                    <span className="afs-brow-name">{s}</span>
                    <span className="afs-brow-bar"><span style={{ width: `${pct}%`, background: heatColor(pct / 100) }} /></span>
                    <span className="afs-brow-val">{t.estimate}<em>/{t.capacity}</em></span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="afs-legend">
          <span>Empty</span>
          <span className="afs-legend-bar" />
          <span>Packed</span>
        </div>

        <button className="afs-analyze" onClick={() => setIntake(true)}>Analyze a livestream frame</button>
        {isSample && <p className="afs-sample-note">Showing sample data — run an analysis to populate real reads.</p>}
      </aside>

      <main className="afs-main">
        <button className="afs-close" onClick={onClose} aria-label="Close"><Icon d={P.close} size={18} /></button>

        {view === 'map' ? (
          <div className="afs-mapwrap">
            <div className="afs-map-head">
              <div>
                <h3>{fmtLong(read?.service_date)}</h3>
                <p>{highlight ? `${highlight} area` : 'All areas'} · fellowship time</p>
              </div>
              <div className="afs-map-count">
                <span className="afs-count-num">≈ {zoneReadout ? zoneReadout.estimate : read?.total ?? 0}</span>
                <span className="afs-count-label">
                  {zoneReadout
                    ? `${zoneReadout.section} · ${zoneReadout.estimate} of ${zoneReadout.capacity} seats`
                    : `people · ${read?.capacity ? Math.round((read.total / read.capacity) * 100) : 0}% full`}
                </span>
              </div>
            </div>
            <div className="afs-map">
              <WorshipMap read={read} highlight={highlight} onHover={setHoverZone} />
            </div>
          </div>
        ) : (
          <Trends history={history} section={section} />
        )}
      </main>
      </div>

      {intake && (
        <AttendanceIntakeModal onClose={() => setIntake(false)} onSaved={() => { setIntake(false); load(); }} />
      )}
    </div>
  );
}

/* ── Trends view ── */
function Trends({ history, section }) {
  const series = history.map(h => ({
    date: h.service_date,
    value: section === 'All' ? h.total : (h.sections?.[section]?.estimate ?? 0),
    cap: section === 'All' ? CAPACITY : (h.sections?.[section]?.capacity ?? 0),
  }));
  const values = series.map(s => s.value);
  const peak = Math.max(1, ...values);
  const latest = values[values.length - 1] ?? 0;
  const avg = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
  const prev = values[values.length - 2] ?? latest;
  const delta = latest - prev;
  const capNow = series[series.length - 1]?.cap || 1;

  return (
    <div className="afs-trends">
      <div className="afs-map-head">
        <div>
          <h3>Attendance trends</h3>
          <p>{section === 'All' ? 'Whole room' : `${section} area`} · last {history.length} services</p>
        </div>
      </div>

      <div className="afs-stats">
        <Stat label="Latest" value={latest} sub={`${Math.round((latest / capNow) * 100)}% full`} />
        <Stat label="Average" value={avg} sub={`over ${history.length}`} />
        <Stat label="Peak" value={peak} sub="best service" />
        <Stat label="Change" value={`${delta >= 0 ? '+' : ''}${delta}`}
              sub="vs last" tone={delta >= 0 ? 'up' : 'down'} />
      </div>

      <div className="afs-chart-card">
        <p className="afs-chart-title">Attendance by service</p>
        <div className="afs-bars">
          {series.map((s, i) => (
            <div className="afs-bar-col" key={i}>
              <span className="afs-bar-num">{s.value}</span>
              <div className="afs-bar-track">
                <div className="afs-bar-fill"
                     style={{ height: `${(s.value / peak) * 100}%`, background: heatColor((s.value / (s.cap || peak))) }} />
              </div>
              <span className="afs-bar-date">{fmtDate(s.date)}</span>
            </div>
          ))}
        </div>
      </div>

      {section === 'All' && (
        <div className="afs-chart-card">
          <p className="afs-chart-title">Fill by area · latest service</p>
          <div className="afs-areabars">
            {SECTION_LABELS.map(s => {
              const t = history[history.length - 1]?.sections?.[s] || { estimate: 0, capacity: 0 };
              const pct = t.capacity ? Math.round((t.estimate / t.capacity) * 100) : 0;
              return (
                <div className="afs-areabar" key={s}>
                  <span className="afs-areabar-name">{s}</span>
                  <div className="afs-areabar-track"><div style={{ width: `${pct}%`, background: heatColor(pct / 100) }} /></div>
                  <span className="afs-areabar-val">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className="afs-stat">
      <span className={`afs-stat-num ${tone || ''}`}>{value}</span>
      <span className="afs-stat-label">{label}</span>
      <span className="afs-stat-sub">{sub}</span>
    </div>
  );
}
