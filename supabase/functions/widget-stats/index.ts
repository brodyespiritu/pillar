// Supabase Edge Function — aggregate stats for the macOS desktop widget.
//
// Deploy:  npx supabase functions deploy widget-stats --no-verify-jwt --use-api
//
// PUBLIC endpoint (the widget has no login session), so it returns ONLY
// aggregate counts — never names, phones, or any other personal data.
// Week boundary mirrors the app: Sunday 7:00 AM in the church's timezone
// (America/New_York), day-granular for date-only columns.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TZ = 'America/New_York';
const RESET_HOUR = 7;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

/* Wall-clock parts of an instant in the church timezone. */
function nyParts(d: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { y: +get('year'), m: +get('month'), d: +get('day'), h: +get('hour') % 24, weekday: wd };
}

/* UTC instant for a church-timezone wall time (one DST refinement pass). */
function nyWallToUtc(y: number, m: number, d: number, h: number) {
  let guess = Date.UTC(y, m - 1, d, h);
  for (let i = 0; i < 2; i++) {
    const p = nyParts(new Date(guess));
    const diff = Date.UTC(p.y, p.m - 1, p.d, p.h) - Date.UTC(y, m - 1, d, h);
    if (!diff) break;
    guess -= diff;
  }
  return new Date(guess);
}

const dateStr = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const now = new Date();
    const p = nyParts(now);

    // Most recent Sunday 7:00 AM church time.
    let back = p.weekday;
    if (p.weekday === 0 && p.h < RESET_HOUR) back = 7;
    const anchor = new Date(Date.UTC(p.y, p.m - 1, p.d - back, 12));   // noon avoids day drift
    const a = nyParts(anchor);
    const weekStart = nyWallToUtc(a.y, a.m, a.d, RESET_HOUR);

    // Day-granular strings for date-only columns (lexicographic compare is safe).
    const endAnchor = nyParts(new Date(anchor.getTime() + 6 * 864e5));
    const startDate = dateStr(a.y, a.m, a.d);
    const endDate = dateStr(endAnchor.y, endAnchor.m, endAnchor.d);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const PROSPECT_TYPES = ['Prospect', 'Potential Prospect'];
    const [guestsQ, prospectsQ, careQ] = await Promise.all([
      admin.from('guests').select('id', { count: 'exact', head: true })
        .not('type', 'in', `(${PROSPECT_TYPES.map(t => `"${t}"`).join(',')})`)
        .gte('last_visit', startDate).lte('last_visit', endDate),
      admin.from('guests').select('id', { count: 'exact', head: true })
        .in('type', PROSPECT_TYPES).eq('not_prospect', false)
        .gte('created_at', weekStart.toISOString()),
      admin.from('care_members').select('id', { count: 'exact', head: true })
        .eq('status', 'Active'),
    ]);

    // Next Sunday 10:30 AM service, church time.
    const daysToSunday = (7 - p.weekday) % 7;
    const sameDayServiceOk = p.weekday === 0 && p.h < 11;
    const sAnchor = nyParts(new Date(now.getTime() + (sameDayServiceOk ? 0 : (daysToSunday || 7)) * 864e5));
    const nextService = nyWallToUtc(sAnchor.y, sAnchor.m, sAnchor.d, 10);   // 10:00 hour; minutes below
    const nextServiceIso = new Date(nextService.getTime() + 30 * 60e3).toISOString();

    const fmt = (ds: string) => {
      const [yy, mm, dd] = ds.split('-').map(Number);
      return new Date(Date.UTC(yy, mm - 1, dd, 12)).toLocaleDateString('en-US',
        { month: 'short', day: 'numeric', timeZone: 'UTC' });
    };

    return new Response(JSON.stringify({
      guestsThisWeek: guestsQ.count ?? 0,
      prospectsThisWeek: prospectsQ.count ?? 0,
      careActive: careQ.count ?? 0,
      weekLabel: `${fmt(startDate)} – ${fmt(endDate)}`,
      nextService: nextServiceIso,
      generatedAt: now.toISOString(),
    }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500, headers: cors,
    });
  }
});
