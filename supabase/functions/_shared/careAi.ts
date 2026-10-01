/*
 * The AI writer for care texts: the part that talks to Claude and keeps the
 * record. The wording rules and every check are in careWriter.ts.
 *
 * What a caller gets back is always something it can send. Pillar's wording is
 * the answer whenever the mode is off, the AI key is missing, the month's
 * limit is spent, the run is out of time, the AI cannot be reached or declines,
 * or its version fails a check — and in practice mode, always. Nothing here
 * can hold up or stop a care text; at worst it goes out as it always has.
 *
 * Every attempt is kept in care_ai_drafts, beside Pillar's wording, with what
 * was sent and why. That is the office's review list, the source of its
 * corrections, and the running total the monthly limit is checked against.
 *
 * One draft per text (`ref`): the half-hourly sweep and the instant alert can
 * both reach the same alert, and a digest whose send failed is tried again —
 * neither may write, or pay for, the same text twice.
 */

import type Anthropic from 'npm:@anthropic-ai/sdk@0.129.0';
import {
  CARE_AI_MODEL, EFFORT, MAX_TOKENS, OUTPUT_SCHEMA, audienceOf, costOf, parseLines, reviewRewrite,
  systemPrompt, tidyLines, userPrompt,
  type Audience, type CareText, type Example, type Mode,
} from './careWriter.ts';

export type { CareText };

const API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
export const aiConfigured = () => API_KEY.length > 0;

/*
 * The SDK is loaded the first time a text is actually written, not when the
 * care texts' functions start. With the AI off or no key added it is never
 * loaded at all, and if it ever failed to load, that one write fails (and
 * Pillar's wording goes out) instead of the function that sends the texts.
 */
type Sdk = typeof import('npm:@anthropic-ai/sdk@0.129.0');
let sdk: Promise<Sdk> | null = null;
const loadSdk = () => (sdk ??= import('npm:@anthropic-ai/sdk@0.129.0'));

export type Written = {
  parts: string[];             // what to send
  lines: string[] | null;      // the AI's lines, when it wrote any
  used: 'ai' | 'pillar';
  problems: string[];
  cost: number;
};

export type CareAiSetup = {
  mode: Mode;                  // as set in Pillar
  rules: Record<Audience, string>;
  examples: Record<Audience, Example[]>;
  capUsd: number;
  spentUsd: number;            // this calendar month, previews included
};

const monthStart = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

/* The settings, rules, examples and this month's spend — or null when
   care-ai-writer.sql has not been run, which reads as "off". */
export async function loadCareAi(supabase: any): Promise<CareAiSetup | null> {
  const { data: s, error } = await supabase.from('care_ai_settings')
    .select('mode, rules_deacons, rules_staff, monthly_cap_usd').eq('id', 1).maybeSingle();
  if (error || !s) return null;

  const { data: ex } = await supabase.from('care_ai_examples')
    .select('audience, original, wrote, should_read, why')
    .eq('active', true).order('created_at', { ascending: false }).limit(80);
  const examples: Record<Audience, Example[]> = { deacons: [], staff: [] };
  for (const e of ex || []) (examples[e.audience as Audience] || []).push(e);

  const { data: spent } = await supabase.from('care_ai_drafts')
    .select('cost_usd').gte('created_at', monthStart());
  const spentUsd = (spent || []).reduce((n: number, r: any) => n + (Number(r.cost_usd) || 0), 0);

  return {
    mode: (['off', 'practice', 'live'].includes(s.mode) ? s.mode : 'off') as Mode,
    rules: { deacons: s.rules_deacons || '', staff: s.rules_staff || '' },
    examples,
    capUsd: Number(s.monthly_cap_usd) || 0,
    spentUsd,
  };
}

/* An API failure in words the office can act on, without the raw response. */
function whyFailed(e: unknown, Lib: Sdk['default'] | null): string {
  if (!Lib) return 'The AI library could not be loaded.';
  if (e instanceof Lib.AuthenticationError) return 'The AI key was refused. Check ANTHROPIC_API_KEY in Supabase.';
  if (e instanceof Lib.PermissionDeniedError) return 'The AI account is not allowed to use this model.';
  if (e instanceof Lib.RateLimitError) return 'The AI was busy and asked us to slow down.';
  if (e instanceof Lib.APIConnectionTimeoutError) return 'The AI took too long to answer.';
  if (e instanceof Lib.BadRequestError) {
    return /credit balance/i.test(e.message)
      ? 'The AI account is out of credit.'
      : 'The AI turned the request down as malformed.';
  }
  if (e instanceof Lib.APIError) return `The AI service had a problem (${e.status ?? 'no status'}).`;
  if (e instanceof Lib.APIConnectionError) return 'The AI could not be reached.';
  return 'Something went wrong asking the AI.';
}

type Attempt = { lines: string[] | null; problems: string[]; model: string | null; usage: any; cost: number };

/*
 * One rewrite: Pillar's wording in, the AI's lines out, checked. Never throws.
 * `rules` overrides the saved rules (a preview of rules not saved yet).
 */
async function attempt(
  setup: CareAiSetup, text: CareText, timeoutMs: number, rules?: string, given?: Anthropic,
): Promise<Attempt> {
  const audience = audienceOf(text.kind);
  let Lib: Sdk['default'] | null = null;
  try {
    Lib = (await loadSdk()).default;
    const client = given ?? new Lib({ apiKey: API_KEY, maxRetries: 1 });
    const res = await client.beta.messages.create({
      model: CARE_AI_MODEL,
      max_tokens: MAX_TOKENS[text.kind],
      /* A declined request is re-run on Anthropic's recommended substitute
         rather than coming back empty. */
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: EFFORT[text.kind], format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      /* The rules and examples are the same for every text to one audience, so
         the morning's run of deacon summaries reads them from the cache. */
      system: [{
        type: 'text',
        text: systemPrompt(audience, rules ?? setup.rules[audience], setup.examples[audience]),
        cache_control: { type: 'ephemeral' },
      }],
      messages: [{ role: 'user', content: userPrompt(text.kind, text.original, { header: text.header }) }],
    }, { timeout: Math.max(5_000, timeoutMs) });

    const cost = costOf(res.model, res.usage);
    const base = { model: res.model, usage: res.usage, cost };
    if (res.stop_reason === 'refusal') return { ...base, lines: null, problems: ['The AI declined to write this one.'] };
    if (res.stop_reason === 'max_tokens') return { ...base, lines: null, problems: ['It ran out of room before finishing.'] };

    const raw = res.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('');
    const parsed = parseLines(raw);
    if (!parsed) return { ...base, lines: null, problems: ['Its answer could not be read.'] };
    const lines = tidyLines(parsed, { header: text.header });
    const problems = reviewRewrite({
      original: text.original, lines, parts: lines.length ? text.build(lines) : [],
      originalParts: text.originalParts, people: text.people,
    });
    return { ...base, lines, problems };
  } catch (e) {
    console.error('care AI:', (e as Error)?.message || e);
    return { lines: null, problems: [whyFailed(e, Lib)], model: null, usage: null, cost: 0 };
  }
}

async function record(supabase: any, text: CareText, mode: 'practice' | 'live' | 'preview',
  a: Attempt, used: 'ai' | 'pillar') {
  const u = a.usage || {};
  const { error } = await supabase.from('care_ai_drafts').insert({
    kind: text.kind, audience: audienceOf(text.kind), label: text.label, ref: text.ref, mode,
    original: text.original, header: text.header || null, people: text.people,
    written: a.lines ? a.lines.join('\n') : null, used, problems: a.problems,
    model: a.model, cost_usd: Number(a.cost.toFixed(5)),
    input_tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
    output_tokens: u.output_tokens || null,
  });
  /* A duplicate ref is the other path having written this text first. */
  if (error && error.code !== '23505') console.error('care AI draft not kept:', error.message);
}

export type CareWriter = { mode: Mode; write(text: CareText): Promise<Written> };

/*
 * The writer for one run. `budgetMs` bounds how long the run may spend on the
 * AI in all: past it, texts go out in Pillar's wording rather than late.
 */
export async function openCareWriter(
  supabase: any, { budgetMs = 60_000, client }: { budgetMs?: number; client?: Anthropic } = {},
): Promise<CareWriter> {
  const setup = aiConfigured() ? await loadCareAi(supabase).catch(() => null) : null;
  const mode: Mode = setup ? setup.mode : 'off';
  const deadline = Date.now() + budgetMs;

  const pillar = (text: CareText, problems: string[] = []): Written =>
    ({ parts: text.originalParts, lines: null, used: 'pillar', problems, cost: 0 });

  async function write(text: CareText): Promise<Written> {
    if (!setup || mode === 'off') return pillar(text);

    /* Written already (a retried send): use that, and pay nothing more. */
    if (text.ref) {
      const { data: prior } = await supabase.from('care_ai_drafts')
        .select('written, problems').eq('ref', text.ref).maybeSingle();
      if (prior) {
        const lines = prior.written ? String(prior.written).split('\n') : null;
        const ok = mode === 'live' && lines && !(prior.problems || []).length;
        return ok ? { parts: text.build(lines!), lines, used: 'ai', problems: [], cost: 0 } : pillar(text, prior.problems || []);
      }
    }

    const draftMode = mode === 'live' ? 'live' : 'practice';
    if (setup.spentUsd >= setup.capUsd) {
      const a = { lines: null, problems: [`This month's AI limit ($${setup.capUsd.toFixed(2)}) is used up.`], model: null, usage: null, cost: 0 };
      await record(supabase, text, draftMode, a, 'pillar');
      return pillar(text, a.problems);
    }
    const left = deadline - Date.now();
    if (left < 5_000) {
      const a = { lines: null, problems: ['There was no time left in this run to write it.'], model: null, usage: null, cost: 0 };
      await record(supabase, text, draftMode, a, 'pillar');
      return pillar(text, a.problems);
    }

    const a = await attempt(setup, text, left, undefined, client);
    setup.spentUsd += a.cost;
    const send = mode === 'live' && a.lines && a.lines.length > 0 && !a.problems.length;
    await record(supabase, text, draftMode, a, send ? 'ai' : 'pillar');
    return send
      ? { parts: text.build(a.lines!), lines: a.lines, used: 'ai', problems: [], cost: a.cost }
      : { ...pillar(text, a.problems), lines: a.lines, cost: a.cost };
  }

  return { mode, write };
}

/*
 * A rewrite for the office to look at, not to send: the Care Texts page's
 * "try again with these rules". Counted toward the month like any other.
 */
export async function previewCareText(supabase: any, text: CareText, rules?: string, client?: Anthropic) {
  if (!aiConfigured()) return { error: 'The AI key has not been added yet.' };
  const setup = await loadCareAi(supabase);
  if (!setup) return { error: 'Run supabase/care-ai-writer.sql first.' };
  if (setup.spentUsd >= setup.capUsd) {
    return { error: `This month's AI limit ($${setup.capUsd.toFixed(2)}) is used up.` };
  }
  const a = await attempt(setup, text, 45_000, rules, client);
  await record(supabase, { ...text, ref: null }, 'preview', a, 'pillar');
  return {
    lines: a.lines, problems: a.problems, cost: a.cost,
    parts: a.lines && a.lines.length ? text.build(a.lines) : [],
  };
}

/* Run `fn` over `items`, `limit` at a time, in order of results. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
