import { useEffect, useMemo, useRef } from 'react';
import { drawHeatmap } from './heatCanvas';

/*
 * WorshipMap — an architectural floor plan of the building (perimeter offices &
 * classrooms, fan-shaped sanctuary seating, platform + choir, narthex rotunda,
 * parking) with a Snap-style glowing density overlay on the seating: sparse
 * areas read as a cool haze, the densest crowd glows orange/red.
 *
 * All geometry lives in a 960×720 logical space shared by the SVG and the canvas
 * so the glow lines up with the seats. Zone keys match src/lib/attendance.js.
 *
 * Props: read {zones}, highlight (section label | null), onHover(zoneKey|null).
 */

const W = 960, H = 720;

/* ── Sanctuary fan (focal = platform, opens down-right toward the seats) ── */
const F = { x: 372, y: 236 };
const R_IN = 80, R_OUT = 236, ROWS = 11;
const ROW_STEP = (R_OUT - R_IN) / ROWS;
const AISLE = 2.5;
const SECTIONS = [
  { key: 'R', label: 'Right',  a0: 6,  a1: 32 },
  { key: 'C', label: 'Center', a0: 32, a1: 58 },
  { key: 'L', label: 'Left',   a0: 58, a1: 84 },
];
const CHOIR_R = 42, CHOIR_A0 = 14, CHOIR_A1 = 78, CHOIR_N = 6;

const rad = d => (d * Math.PI) / 180;
const pt = (r, a) => [F.x + r * Math.cos(rad(a)), F.y + r * Math.sin(rad(a))];

// Zone centroids (positions only) — value comes from the read at draw time.
const CENTROIDS = [
  ...SECTIONS.flatMap(sec => {
    const mid = (sec.a0 + sec.a1) / 2;
    return Array.from({ length: ROWS }, (_, r) => {
      const [x, y] = pt(R_IN + (r + 0.5) * ROW_STEP, mid);
      return { zone_key: `${sec.key}${r}`, section: sec.label, x, y, r: 28 + r * 1.8 };
    });
  }),
  ...Array.from({ length: CHOIR_N }, (_, i) => {
    const a = CHOIR_A0 + ((i + 0.5) / CHOIR_N) * (CHOIR_A1 - CHOIR_A0);
    const [x, y] = pt(CHOIR_R, a);
    return { zone_key: `ch${i}`, section: 'Choir', x, y, r: 24 };
  }),
];

// Decorative seat marks (little chairs along each curved row) for the plan look.
const SEAT_MARKS = SECTIONS.flatMap(sec =>
  Array.from({ length: ROWS }, (_, r) => {
    const radius = R_IN + (r + 0.5) * ROW_STEP;
    const a0 = sec.a0 + AISLE, a1 = sec.a1 - AISLE;
    const arc = radius * rad(a1 - a0);
    const n = Math.max(1, Math.round(arc / 12));
    return Array.from({ length: n }, (_, k) => {
      const a = a0 + ((k + 0.5) / n) * (a1 - a0);
      const [x, y] = pt(radius, a);
      return { x, y, a: a + 90, section: sec.label };
    });
  }).flat(),
);
const CHOIR_MARKS = Array.from({ length: CHOIR_N }, (_, i) => {
  const a = CHOIR_A0 + ((i + 0.5) / CHOIR_N) * (CHOIR_A1 - CHOIR_A0);
  const [x, y] = pt(CHOIR_R, a);
  return { x, y, a: a + 90 };
});
const SECTION_LABEL_POS = SECTIONS.map(sec => {
  const [x, y] = pt((R_IN + R_OUT) / 2 + 6, (sec.a0 + sec.a1) / 2);
  return { ...sec, x, y };
});

/* ── Perimeter rooms (light architectural boxes) ── */
const officeCells = Array.from({ length: 7 }, (_, i) => ({ x: 250 + i * 71, y: 72, w: 71, h: 60 }));
const leftCells = [
  { x: 110, y: 72, h: 96 }, { x: 110, y: 168, h: 96 },
  { x: 110, y: 264, h: 100 }, { x: 110, y: 364, h: 106 },
].map(c => ({ ...c, w: 140 }));
const rightCells = [
  { x: 640, y: 150, h: 74 }, { x: 640, y: 224, h: 74 }, { x: 640, y: 298, h: 82 },
].map(c => ({ ...c, w: 110 }));
const bottomCells = Array.from({ length: 3 }, (_, i) => ({ x: 250 + i * 90, y: 470, w: 90, h: 80 }));

export default function WorshipMap({ read, highlight = null, onHover }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  const byKey = useMemo(() => {
    const m = {};
    for (const z of read?.zones || []) m[z.zone_key] = z;
    return m;
  }, [read]);

  // Points for the glow, filtered by the active area.
  const points = useMemo(() => CENTROIDS
    .filter(c => !highlight || c.section === highlight)
    .map(c => ({ x: c.x, y: c.y, r: c.r, value: byKey[c.zone_key]?.estimate ?? 0 }))
    .filter(p => p.value > 0),
  [byKey, highlight]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const max = Math.max(1, ...points.map(p => p.value));
    drawHeatmap(canvas, points, { blur: 18, max });
  }, [points]);

  // Coarse hover — nearest zone centroid within reach.
  const onMove = e => {
    if (!onHover) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const lx = ((e.clientX - rect.left) / rect.width) * W;
    const ly = ((e.clientY - rect.top) / rect.height) * H;
    let best = null, bd = 40 * 40;
    for (const c of CENTROIDS) {
      if (highlight && c.section !== highlight) continue;
      const d = (c.x - lx) ** 2 + (c.y - ly) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    onHover(best?.zone_key ?? null);
  };

  const dimSection = section => highlight && highlight !== section ? 0.28 : 1;

  return (
    <div className="wm-plan" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => onHover?.(null)}>
      <svg className="wm-svg" viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={`Worship center floor plan, ${read?.total ?? 0} people`}>
        {/* building shell */}
        <rect x="108" y="66" width="644" height="490" rx="6"
              fill="var(--surface)" stroke="var(--text-3)" strokeWidth="2" />

        {/* perimeter rooms */}
        <g fill="none" stroke="#C3D0E2" strokeWidth="1.4">
          {officeCells.map((c, i) => <rect key={`o${i}`} x={c.x} y={c.y} width={c.w} height={c.h} />)}
          {leftCells.map((c, i) => <rect key={`l${i}`} x={c.x} y={c.y} width={c.w} height={c.h} />)}
          {rightCells.map((c, i) => <rect key={`r${i}`} x={c.x} y={c.y} width={c.w} height={c.h} />)}
          {bottomCells.map((c, i) => <rect key={`b${i}`} x={c.x} y={c.y} width={c.w} height={c.h} />)}
          {/* restrooms */}
          <rect x="520" y="470" width="60" height="80" />
          <rect x="580" y="470" width="60" height="80" />
        </g>

        {/* room labels */}
        <g className="wm-room-label">
          <text x="465" y="106" textAnchor="middle">OFFICES</text>
          <text x="180" y="120" textAnchor="middle">STORAGE</text>
          <text x="180" y="320" textAnchor="middle">SOUND</text>
          <text x="695" y="192" textAnchor="middle">CLASS</text>
          <text x="340" y="516" textAnchor="middle">CLASSROOMS</text>
        </g>

        {/* platform */}
        <path d={`M ${pt(12, 88)[0]},${pt(12, 88)[1]}
                  A 12 12 0 0 1 ${pt(12, 2)[0]},${pt(12, 2)[1]}
                  L ${pt(76, 2)[0]},${pt(76, 2)[1]}
                  A 76 76 0 0 0 ${pt(76, 88)[0]},${pt(76, 88)[1]} Z`}
              fill="#EEF3FB" stroke="#C3D0E2" strokeWidth="1.4" />
        <text x={F.x - 6} y={F.y + 4} textAnchor="middle" className="wm-label">PLATFORM</text>

        {/* choir marks */}
        {CHOIR_MARKS.map((s, i) => (
          <rect key={`c${i}`} x={s.x - 5} y={s.y - 4} width="10" height="8" rx="1.5"
                transform={`rotate(${s.a} ${s.x} ${s.y})`}
                fill="#DCE6F3" stroke="#C3D0E2" strokeWidth="0.8" />
        ))}

        {/* seat marks (curved rows) */}
        {SEAT_MARKS.map((s, i) => (
          <rect key={`s${i}`} x={s.x - 3.4} y={s.y - 4.2} width="6.8" height="8.4" rx="1.4"
                transform={`rotate(${s.a} ${s.x} ${s.y})`}
                fill="#E4EBF5" stroke="#C6D2E4" strokeWidth="0.7"
                opacity={dimSection(s.section)} />
        ))}

        {/* section labels */}
        {SECTION_LABEL_POS.map(s => (
          <text key={s.key} x={s.x} y={s.y} textAnchor="middle" className="wm-section-label"
                opacity={highlight && highlight !== s.label ? 0.3 : 0.9}
                style={{ paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 4 }}>{s.label}</text>
        ))}
        <text x="470" y="250" textAnchor="middle" className="wm-area-label">SANCTUARY</text>

        {/* narthex rotunda + driveway */}
        <ellipse cx="800" cy="606" rx="150" ry="112" fill="#F3F6FB" stroke="#D7E0EE" strokeWidth="1.4" />
        <path d="M 720 520 Q 700 560 720 600" fill="none" stroke="#C3D0E2" strokeWidth="1.4" />
        <circle cx="726" cy="608" r="58" fill="var(--surface)" stroke="#C3D0E2" strokeWidth="1.6" />
        {Array.from({ length: 14 }, (_, i) => {
          const a = (i / 14) * Math.PI * 2;
          return <circle key={i} cx={726 + 70 * Math.cos(a)} cy={608 + 70 * Math.sin(a)} r="4"
                         fill="var(--surface)" stroke="#C3D0E2" strokeWidth="1" />;
        })}
        <text x="726" y="612" textAnchor="middle" className="wm-label">NARTHEX</text>

        {/* parking */}
        <g fill="none" stroke="#C3D0E2" strokeWidth="1.4">
          <rect x="330" y="588" width="30" height="54" rx="4" />
          <rect x="366" y="588" width="30" height="54" rx="4" />
          <rect x="820" y="150" width="54" height="30" rx="4" />
          <rect x="820" y="184" width="54" height="30" rx="4" />
        </g>
      </svg>

      {/* glowing density overlay */}
      <canvas ref={canvasRef} className="wm-heat" width={W} height={H} />
    </div>
  );
}
