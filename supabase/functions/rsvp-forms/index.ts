// Supabase Edge Function — the public side of RSVP forms at bethesda.rsvp.
//
// Deploy (public — the congregation calls it, not the app):
//   supabase functions deploy rsvp-forms --no-verify-jwt
//
//   GET                 the open forms, and whether a dinner is taking reservations
//   GET  ?slug=<slug>   one open form, to fill in
//   POST { slug, answers, startedAt, website }   one sign-up
//
// Anonymous visitors never read or write the tables. Only what a form needs to
// render leaves here, and a sign-up is checked field by field before it is saved.
// The people a form is linked to are looked up here from staff and the contact
// list; no phone number supplied by a visitor is ever texted.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { activeDinner } from '../_shared/dinnerAck.ts';
import { cleanFields, validateAnswers, summarize, noticeText } from '../_shared/rsvpForms.ts';
import { splitMessage } from '../_shared/smsParts.ts';
import { last10 } from '../_shared/phone.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/* One device may sign up a handful of times in a few minutes (a family), not more. */
const PER_DEVICE = 6;
const PER_DEVICE_WINDOW_MIN = 10;
/* A form stops accepting from the open web past this many in a day. */
const PER_FORM_DAY = 2000;
/* Texts about responses pause past this many an hour, so a flood cannot bury a phone. */
const TEXTS_PER_HOUR = 40;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const cleanSlug = (s: unknown) => String(s ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 32);

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/* Only what the page needs to draw the form. */
const publicForm = (f: any) => ({
  slug: f.slug, title: f.title, description: f.description || '', fields: cleanFields(f.fields),
});

/* Text the people this form is linked to about one response. */
async function notify(supabase: any, form: any, responseId: string, values: Record<string, string>) {
  const links = Array.isArray(form.notify) ? form.notify : [];
  const staffIds = links.filter((l: any) => l?.type === 'staff').map((l: any) => l.id).filter(Boolean);
  const contactIds = links.filter((l: any) => l?.type === 'contact').map((l: any) => l.id).filter(Boolean);
  if (!staffIds.length && !contactIds.length) return;

  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await supabase.from('rsvp_responses')
    .select('id', { count: 'exact', head: true })
    .eq('form_id', form.id).gt('notified', 0).gte('created_at', hourAgo);
  if ((count ?? 0) >= TEXTS_PER_HOUR) {
    console.warn(`rsvp-forms: text limit reached for form ${form.id}; response saved, no text sent`);
    return;
  }

  const people: { phone: string; name: string }[] = [];
  if (staffIds.length) {
    const { data } = await supabase.from('staff').select('name, phone, active').in('id', staffIds);
    for (const s of data || []) if (s.active !== false && last10(s.phone).length === 10) people.push({ phone: s.phone, name: s.name || '' });
  }
  if (contactIds.length) {
    const { data } = await supabase.from('sms_contacts').select('name, phone, opted_out').in('id', contactIds);
    for (const c of data || []) if (!c.opted_out && last10(c.phone).length === 10) people.push({ phone: c.phone, name: c.name || '' });
  }
  const seen = new Set<string>();
  const to = people.filter(p => (seen.has(last10(p.phone)) ? false : (seen.add(last10(p.phone)), true)));
  if (!to.length) return;

  const { header, lines } = noticeText(form.title, cleanFields(form.fields), values);
  const parts = splitMessage(header, lines);

  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-prospect-sms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
    /* 'Notice': a heads-up, not a question — replies to it are not answers to it. */
    body: JSON.stringify({
      status: 'Notice',
      messages: to.flatMap(p => parts.map(body => ({ to_number: p.phone, to_name: p.name, body }))),
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.maintenance) console.warn('rsvp-forms: response texts not sent:', out?.error || (out?.maintenance ? 'maintenance' : res.status));
  await supabase.from('rsvp_responses').update({ notified: Number(out?.sent) || 0 }).eq('id', responseId);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    if (req.method === 'GET') {
      const slug = cleanSlug(new URL(req.url).searchParams.get('slug'));
      if (slug) {
        const { data } = await supabase.from('rsvp_forms')
          .select('slug, title, description, fields, status').eq('slug', slug).maybeSingle();
        if (!data) return json({ error: 'This sign-up link is not valid.' }, 404);
        if (data.status !== 'open') return json({ error: 'This sign-up is closed.' }, 410);
        return json({ form: publicForm(data) });
      }

      const [{ data: forms }, dinner] = await Promise.all([
        supabase.from('rsvp_forms').select('slug, title, description, fields')
          .eq('status', 'open').order('created_at', { ascending: true }).limit(24),
        activeDinner(supabase, Date.now()),
      ]);
      return json({
        forms: (forms || []).map(publicForm),
        dinner: dinner
          ? { open: true, menu: (Array.isArray(dinner.rsvp_menu) ? dinner.rsvp_menu : []).map(String).slice(0, 12) }
          : { open: false },
      });
    }

    if (req.method !== 'POST') return json({ error: 'Use GET or POST.' }, 405);

    const body = await req.json().catch(() => ({}));

    /* A field people cannot see, and a form filled faster than anyone can type:
       both are scripts. They are told it worked and nothing is kept. */
    const started = Number(body?.startedAt);
    if (String(body?.website ?? '').trim() || !Number.isFinite(started) || Date.now() - started < 1500) {
      return json({ ok: true });
    }

    const slug = cleanSlug(body?.slug);
    const { data: form } = await supabase.from('rsvp_forms')
      .select('id, slug, title, fields, notify, status').eq('slug', slug).maybeSingle();
    if (!form) return json({ error: 'This sign-up link is not valid.' }, 404);
    if (form.status !== 'open') return json({ error: 'This sign-up is closed.' }, 410);

    const fields = cleanFields(form.fields);
    const { values, errors } = validateAnswers(fields, body?.answers);
    if (Object.keys(errors).length) {
      return json({ error: 'Please check the highlighted answers.', fields: errors }, 400);
    }

    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
    const ipHash = await sha256(`${form.id}|${ip}`);
    const since = new Date(Date.now() - PER_DEVICE_WINDOW_MIN * 60_000).toISOString();
    const dayAgo = new Date(Date.now() - 864e5).toISOString();
    const [{ count: recent }, { count: today }] = await Promise.all([
      supabase.from('rsvp_responses').select('id', { count: 'exact', head: true })
        .eq('form_id', form.id).eq('ip_hash', ipHash).gte('created_at', since),
      supabase.from('rsvp_responses').select('id', { count: 'exact', head: true })
        .eq('form_id', form.id).gte('created_at', dayAgo),
    ]);
    if ((recent ?? 0) >= PER_DEVICE) return json({ error: 'That is a lot of sign-ups at once. Please wait a few minutes and try again.' }, 429);
    if ((today ?? 0) >= PER_FORM_DAY) return json({ error: 'This sign-up is not taking more responses right now.' }, 429);

    const who = summarize(fields, values);
    const { data: saved, error } = await supabase.from('rsvp_responses').insert({
      form_id: form.id, answers: values, name: who.name || null, phone: who.phone || null,
      email: who.email || null, ip_hash: ipHash,
    }).select('id').single();
    if (error) throw new Error(error.message);

    /* Texts go out after the answer does — nobody waits on a phone network to see "You're registered". */
    const work = notify(supabase, form, saved.id, values).catch(e => console.error('rsvp-forms notify:', e));
    // @ts-ignore -- provided by the edge runtime
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
    else await work;

    return json({ ok: true, title: form.title, name: who.name });
  } catch (e) {
    console.error('rsvp-forms error:', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
