// Supabase Edge Function — estimate per-zone attendance from livestream frame(s) with Claude vision.
//
// Deploy:
//   supabase functions deploy analyze-attendance
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// The frontend calls it (see src/lib/attendance.js → analyzeScreenshots) with:
//   supabase.functions.invoke('analyze-attendance', { body: { images, zones, context } })
//     images  = [{ media_type, data(base64, no prefix) }]  — one or more stills of fellowship time
//     zones   = [{ zone_key, section, row, capacity }]      — the fixed seat map (ROOM)
//     context = { service_date?, source_url?, frame_ts? }   — optional, for the prompt
//
// Returns: { zones: [{ zone_key, estimate }], total, confidence, model }


const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const MODEL = 'claude-opus-4-8';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY secret is not set on this function.');
    }

    const { images, zones, context = {} } = await req.json();
    if (!Array.isArray(images) || images.length === 0) throw new Error('No images provided.');
    if (!Array.isArray(zones) || zones.length === 0) throw new Error('No zone map provided.');

    const zoneList = zones
      .map((z: any) => `${z.zone_key} — ${z.section} section, row ${z.row}, ~${z.capacity} seats`)
      .join('\n');

    const prompt = [
      'You are estimating in-person church attendance during FELLOWSHIP TIME (people are mingling,',
      'standing, and moving between seats — count every visible person, seated or standing, and',
      'attribute each to the nearest seating zone).',
      '',
      'The worship center camera is fixed. It faces the congregation from the platform. There are',
      'three straight chair sections separated by two aisles — Left, Center (widest), Right — about',
      '11 rows deep, plus a curved choir loft on the platform behind the pulpit.',
      '',
      'Estimate how many people are in each of these zones. Do not exceed a zone\'s seat capacity by',
      'much; if unsure, give your best estimate. Zones:',
      '',
      zoneList,
      '',
      context.frame_ts ? `Frame timestamp: ${context.frame_ts}.` : '',
      'Return an estimate for EVERY zone_key listed (use 0 for empty zones), the summed total, and a',
      'confidence between 0 and 1 reflecting image clarity and how much of the room is visible.',
    ].filter(Boolean).join('\n');

    const content = [
      ...images.map((img: any) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.data },
      })),
      { type: 'text', text: prompt },
    ];

    const schema = {
      type: 'object',
      properties: {
        zones: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              zone_key: { type: 'string' },
              estimate: { type: 'integer' },
            },
            required: ['zone_key', 'estimate'],
            additionalProperties: false,
          },
        },
        total: { type: 'integer' },
        confidence: { type: 'number' },
      },
      required: ['zones', 'total', 'confidence'],
      additionalProperties: false,
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        output_config: { format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content }],
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Anthropic HTTP ${res.status}`);

    const text = (data.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Model did not return parseable JSON.');
      parsed = JSON.parse(m[0]);
    }

    // Trust the model's per-zone numbers but recompute the total for consistency.
    const zoneEstimates = (parsed.zones || []).map((z: any) => ({
      zone_key: z.zone_key,
      estimate: Math.max(0, Math.round(z.estimate || 0)),
    }));
    const total = zoneEstimates.reduce((n: number, z: any) => n + z.estimate, 0);

    return new Response(
      JSON.stringify({
        zones: zoneEstimates,
        total,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
        model: MODEL,
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
