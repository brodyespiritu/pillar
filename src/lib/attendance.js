import { supabase } from './supabase';

/*
 * Attendance model + data layer.
 *
 * ROOM is the single source of truth for seating zones and their capacities.
 * It's shared by three consumers so they never drift:
 *   1. the heat-map graphic (src/pages/home/AttendanceHeatmap.jsx) — geometry keyed by zone_key
 *   2. the sample generator below (used until a real read exists)
 *   3. the analyze-attendance edge function's vision prompt (zone list sent to Claude)
 *
 * Zone keys: sections are `${key}${rowIndex}` (e.g. "C3"), choir cells are `ch${i}`.
 */

export const SECTIONS = [
  { key: 'L', label: 'Left',   rows: 11, seats: 9  },
  { key: 'C', label: 'Center', rows: 11, seats: 14 },
  { key: 'R', label: 'Right',  rows: 11, seats: 9  },
];
export const CHOIR = { key: 'ch', cells: 6, seats: 8 };

/** Flat zone list with capacities. */
export function buildZones() {
  const zones = [];
  for (const s of SECTIONS) {
    for (let r = 0; r < s.rows; r++) {
      zones.push({ zone_key: `${s.key}${r}`, section: s.label, row: r + 1, capacity: s.seats });
    }
  }
  for (let i = 0; i < CHOIR.cells; i++) {
    zones.push({ zone_key: `${CHOIR.key}${i}`, section: 'Choir', row: 1, capacity: CHOIR.seats });
  }
  return zones;
}

export const CAPACITY = buildZones().reduce((n, z) => n + z.capacity, 0);
const CAP_BY_KEY = Object.fromEntries(buildZones().map(z => [z.zone_key, z.capacity]));

export const SECTION_LABELS = ['Left', 'Center', 'Right', 'Choir'];

/* Deterministic 0..1 pseudo-noise so the sample looks organic but never flickers */
const noise = (a, b) => {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/* ── Shared heat scale: faint blue (empty) → green → amber → red (packed) ── */
const HEAT_STOPS = [
  [0.00, [226, 235, 247]],
  [0.18, [ 74, 173, 128]],
  [0.50, [245, 197,  66]],
  [0.78, [242, 138,  52]],
  [1.00, [225,  74,  74]],
];
export function heatColor(t) {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [p1, c1] = HEAT_STOPS[i];
    if (x <= p1) {
      const [p0, c0] = HEAT_STOPS[i - 1];
      const f = (x - p0) / (p1 - p0 || 1);
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  const c = HEAT_STOPS[HEAT_STOPS.length - 1][1];
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Sum estimate/capacity per section label. */
export function sectionTotals(zones) {
  const m = { Left: { estimate: 0, capacity: 0 }, Center: { estimate: 0, capacity: 0 },
              Right: { estimate: 0, capacity: 0 }, Choir: { estimate: 0, capacity: 0 } };
  for (const z of zones || []) {
    const s = m[z.section];
    if (s) { s.estimate += z.estimate || 0; s.capacity += z.capacity || 0; }
  }
  return m;
}

/**
 * Deterministic sample read — shown when no real analysis exists yet.
 * `seed` varies the pattern so a synthetic history has week-to-week variation.
 */
export function sampleRead(seed = 0) {
  const zones = buildZones().map(z => {
    let occ;
    if (z.section === 'Choir') {
      const i = Number(z.zone_key.slice(CHOIR.key.length));
      occ = 0.55 + (noise(i + seed * 3.1, 7) - 0.5) * 0.35;
    } else {
      const r = z.row - 1;
      const centerness = z.section === 'Center' ? 1 : 0.72;
      const frontness = 1 - Math.abs((r + 0.5) / 11 - 0.4) * 1.6;
      occ = 0.26 + centerness * 0.34 + frontness * 0.3 + (noise(r + seed * 2.7, z.section.length + seed) - 0.5) * 0.28;
    }
    occ = Math.max(0.04, Math.min(0.98, occ));
    return { ...z, estimate: Math.round(occ * z.capacity) };
  });
  const total = zones.reduce((n, z) => n + z.estimate, 0);
  return { total, capacity: CAPACITY, zones, sections: sectionTotals(zones), sample: true, service_date: null };
}

/** Deterministic synthetic weekly history — used for trends until real reads exist. */
export function sampleHistory(weeks = 8) {
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i * 7);
    const r = sampleRead(i + 1);
    out.push({
      service_date: d.toISOString().slice(0, 10),
      total: r.total, capacity: CAPACITY,
      zones: r.zones, sections: r.sections, sample: true,
    });
  }
  return out;
}

/** Recent completed reads (oldest → newest) with per-zone + per-section data. Null if none. */
export async function fetchRecentReads(limit = 8) {
  const { data: reads } = await supabase
    .from('attendance_reads')
    .select('*')
    .eq('status', 'done')
    .order('service_date', { ascending: false })
    .limit(limit);
  if (!reads?.length) return null;

  const ids = reads.map(r => r.id);
  const { data: zones } = await supabase.from('attendance_zones').select('*').in('read_id', ids);
  const byRead = {};
  for (const z of zones || []) (byRead[z.read_id] ||= []).push(z);

  return reads
    .map(r => ({
      ...r,
      total: r.total_estimate,
      capacity: r.capacity || CAPACITY,
      zones: byRead[r.id] || [],
      sections: sectionTotals(byRead[r.id] || []),
      sample: false,
    }))
    .reverse();
}

/** Most recent completed read + its per-zone estimates, or null. */
export async function fetchLatestRead() {
  const { data: read } = await supabase
    .from('attendance_reads')
    .select('*')
    .eq('status', 'done')
    .order('service_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!read) return null;

  const { data: zones } = await supabase
    .from('attendance_zones')
    .select('*')
    .eq('read_id', read.id);

  return {
    ...read,
    total: read.total_estimate,
    capacity: read.capacity || CAPACITY,
    zones: zones || [],
    sample: false,
  };
}

/**
 * Run the AI headcount on one or more screenshots of the livestream.
 * `images` = [{ media_type, data }] where data is base64 (no data: prefix).
 * Returns { zones: [{zone_key, estimate}], total, confidence, model }.
 */
export async function analyzeScreenshots(images, context = {}) {
  const { data, error } = await supabase.functions.invoke('analyze-attendance', {
    body: { images, zones: buildZones(), context },
  });
  if (error) {
    const reason = /not found|Failed to fetch|non-2xx/i.test(error.message || '')
      ? 'Analysis backend not deployed. Deploy supabase/functions/analyze-attendance and set ANTHROPIC_API_KEY.'
      : (error.message || String(error));
    throw new Error(reason);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Persist an analysis result as a new read + its zones. */
export async function saveRead({ service_date, source_url, frame_ts, result, note }) {
  const { data: read, error } = await supabase
    .from('attendance_reads')
    .insert({
      service_date,
      source_url: source_url || null,
      frame_ts: frame_ts || null,
      total_estimate: result.total,
      capacity: CAPACITY,
      confidence: result.confidence ?? null,
      model: result.model || null,
      status: 'done',
      note: note || null,
    })
    .select()
    .single();
  if (error) throw error;

  const rows = (result.zones || []).map(z => ({
    read_id: read.id,
    zone_key: z.zone_key,
    estimate: Math.max(0, Math.min(z.estimate ?? 0, CAP_BY_KEY[z.zone_key] ?? z.estimate ?? 0)),
    capacity: CAP_BY_KEY[z.zone_key] ?? 0,
  }));
  if (rows.length) await supabase.from('attendance_zones').insert(rows);

  return read;
}

/** Read a File/Blob as { media_type, data } with base64 (no data: prefix). */
export function fileToImagePart(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve({ media_type: file.type || 'image/jpeg', data: result.slice(comma + 1) });
    };
    reader.readAsDataURL(file);
  });
}
