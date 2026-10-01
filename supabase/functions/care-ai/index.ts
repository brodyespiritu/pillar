/*
 * The Care Texts page's server half: what the page cannot see or do itself.
 *
 *   status   whether the AI key is in place (never the key), the mode, and
 *            this month's spend against the limit — Cares access
 *   preview  one of the AI's past texts, written again with the rules on the
 *            page (saved or not) and today's corrections. Nothing is sent; the
 *            cost counts toward the month — Cares edit access
 *
 * Everything else on that page (rules, mode, corrections, the drafts) is read
 * and written straight from the app, under row-level security
 * (care-ai-writer.sql).
 *
 * Deploy with --no-verify-jwt: callers are checked here (authorizeCares), the
 * way send-prospect-sms checks its own.
 *   supabase functions deploy care-ai --no-verify-jwt
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { authorizeCares } from '../_shared/callers.ts';
import { aiConfigured, loadCareAi, previewCareText } from '../_shared/careAi.ts';
import { CARE_AI_MODEL, type CareText, type Kind } from '../_shared/careWriter.ts';
import { splitMessage } from '../_shared/smsParts.ts';
import { packDigest } from '../_shared/careDigest.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const KINDS: Kind[] = ['deacon_alert', 'deacon_summary', 'staff_digest'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405);

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');

    if (action === 'status') {
      const who = await authorizeCares(req, supabase, 'view');
      if (!who.ok) return json({ error: who.error }, who.status);
      const setup = await loadCareAi(supabase);
      return json({
        configured: aiConfigured(),
        setUp: !!setup,
        model: CARE_AI_MODEL,
        mode: setup?.mode ?? 'off',
        spentUsd: Number((setup?.spentUsd ?? 0).toFixed(4)),
        capUsd: setup?.capUsd ?? 0,
      });
    }

    if (action === 'preview') {
      const who = await authorizeCares(req, supabase, 'edit');
      if (!who.ok) return json({ error: who.error }, who.status);

      const { data: d } = await supabase.from('care_ai_drafts')
        .select('kind, label, original, header, people').eq('id', String(body?.draftId || '')).maybeSingle();
      if (!d || !KINDS.includes(d.kind)) return json({ error: 'That text is no longer on record.' }, 404);

      /* Rebuilt from the draft: the same text, cut into the same texts. */
      const lines = String(d.original).split('\n');
      const digest = d.kind === 'staff_digest';
      const header = String(d.header || '');
      const text: CareText = {
        kind: d.kind, ref: null, label: d.label || '', original: d.original, people: d.people || [],
        header: digest ? header : undefined,
        originalParts: digest ? packDigest(header, lines) : splitMessage(lines[0] ?? '', lines.slice(1)),
        build: digest ? (l: string[]) => packDigest(header, l) : (l: string[]) => splitMessage(l[0] ?? '', l.slice(1)),
      };
      const rules = typeof body?.rules === 'string' ? body.rules.slice(0, 6000) : undefined;
      const out = await previewCareText(supabase, text, rules);
      if ('error' in out) return json({ error: out.error }, 409);
      return json({
        text: out.lines ? out.lines.join('\n') : null,
        problems: out.problems,
        cost: Number(out.cost.toFixed(4)),
        parts: out.parts.length,
      });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    console.error('care-ai:', (e as Error)?.message || e);
    return json({ error: 'Something went wrong. Try again in a moment.' }, 500);
  }
});
