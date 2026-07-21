---
name: pillar-attendance-heatmap
description: Dashboard attendance heat map + the AI-from-livestream pipeline that populates it
metadata:
  node_type: memory
  type: project
---

The Pillar home dashboard shows a compact **attendance card** (just the estimated headcount) in the left column. Clicking it opens a **full-screen worship-center view** with a left filter rail. This replaced the earlier always-on inline heat map (the old `AttendanceHeatmap.jsx` was deleted).

**Components:**
- [AttendanceCard.jsx](../../src/pages/home/AttendanceCard.jsx) — dashboard card, number only, opens the full screen.
- [AttendanceFullScreen.jsx](../../src/pages/home/AttendanceFullScreen.jsx) — overlay. Left rail: Heat-map/Trends toggle, service-date selector, area filter chips (All / Left / Center / Right / Choir), per-area breakdown bars, legend, "Analyze a livestream frame". Filtering a section dims the others on the map and refocuses the trends. Trends view = attendance-by-service bar chart + fill-by-area bars + latest/avg/peak/change stats, built from `fetchRecentReads(8)` (or `sampleHistory(8)`).
- [WorshipMap.jsx](../../src/pages/home/WorshipMap.jsx) — an **architectural floor plan** (SVG: perimeter offices/classrooms/restrooms, fan of curved seat rows, platform + choir, narthex rotunda + driveway + parking) with a **Snap-style glowing density overlay** on a `<canvas>` ([heatCanvas.js](../../src/pages/home/heatCanvas.js)): soft blurred blobs colorized through a gradient (cool blue haze → glowing red core). SVG + canvas share one 960×720 space so the glow aligns with the seats. This replaced the earlier discrete-colored-cell fan. Tune colors/radius/blur in heatCanvas.js.
- Styles in [attendance.css](../../src/pages/home/attendance.css).

**Room model is the single source of truth:** `src/lib/attendance.js` → `SECTIONS`/`CHOIR` + `buildZones()`. Left / Center-widest / Right (11 rows, ~9/14/9 seats) + 6-cell choir loft. Zone keys `L0..L10`, `C0..C10`, `R0..R10`, `ch0..ch5` — shared by the map, `sampleRead(seed)`/`sampleHistory()` fallbacks, and the vision prompt so nothing drifts. `heatColor(t)` (green→amber→red scale) and `sectionTotals()` also live here.

**Pipeline (Claude vision, chosen backend):**
- Staff click the "AI estimate / Sample" pill → `AttendanceIntakeModal` → upload a livestream **screenshot** of fellowship time (a still is the realistic v1 input since the camera is fixed; auto-pulling a frame from a YouTube URL is a later step). URL/timestamp are stored for provenance.
- `analyzeScreenshots()` → `supabase.functions.invoke('analyze-attendance', {images, zones, context})`.
- Edge function `supabase/functions/analyze-attendance/index.ts`: raw `fetch` to Anthropic Messages API, **model `claude-opus-4-8`**, base64 image blocks + `output_config.format` json_schema forcing `{zones:[{zone_key,estimate}], total, confidence}`. Keeps `ANTHROPIC_API_KEY` server-side (mirrors the SMS→Telnyx edge-function pattern in [sms.js](../../src/lib/sms.js)).
- `saveRead()` writes `attendance_reads` + `attendance_zones`. Dashboard reads the newest `status='done'` row via `fetchLatestRead()`; falls back to `sampleRead()` when none.

**Setup still required (like the SMS module):** run `supabase/attendance-schema.sql`, `supabase functions deploy analyze-attendance`, `supabase secrets set ANTHROPIC_API_KEY=…`. Until then the panel shows stable sample data.

Follows [[pillar-design-reference]] tokens. Same connect/verify + edge-function seam is reusable for other AI features.
