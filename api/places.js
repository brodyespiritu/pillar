// Vercel serverless proxy for Google Places Autocomplete (New).
//
// The API key lives here as an environment variable and never reaches the
// browser or the desktop app bundle — the client only ever calls /api/places.
//
//   GET /api/places?q=4844+Hea             → { suggestions: [{ placeId, main, secondary }] }
//   GET /api/places?q=north+col&kind=school → same shape, but schools instead of addresses
//   GET /api/places?place_id=<id>          → { street, line2, city, state, zip, formatted }
//
// Set GOOGLE_PLACES_API_KEY in the Vercel project's environment variables.

const KEY = process.env.GOOGLE_PLACES_API_KEY;
const BASE = 'https://places.googleapis.com/v1';

// Rank results near the church first — without this, "4844 Hearthstone"
// surfaces Maryland before Columbus. It's a bias, not a filter: an address
// anywhere in the US still appears, just below the local matches.
const NEAR_CHURCH = {
  circle: {
    center: { latitude: 32.4610, longitude: -84.9877 },   // Columbus, GA
    radius: 50000,                                         // 50 km — covers the metro
  },
};

export default async function handler(req, res) {
  if (!KEY) {
    // Not configured yet — report it plainly so the UI can stay quiet.
    return res.status(503).json({ error: 'Address lookup is not configured (GOOGLE_PLACES_API_KEY missing).' });
  }

  const { q = '', place_id: placeId = '', kind = 'address' } = req.query || {};

  // Google caps includedPrimaryTypes at 5 entries.
  const TYPES = kind === 'school'
    ? ['school', 'primary_school', 'secondary_school', 'preschool', 'university']
    : kind === 'hospital'
      ? ['hospital']
      : ['street_address', 'premise', 'subpremise'];

  try {
    if (placeId) {
      const r = await fetch(
        `${BASE}/places/${encodeURIComponent(placeId)}?fields=addressComponents,formattedAddress`,
        { headers: { 'X-Goog-Api-Key': KEY } },
      );
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || 'Place details failed.' });
      return res.status(200).json(toAddress(j));
    }

    if (String(q).trim().length < 3) return res.status(200).json({ suggestions: [] });

    const r = await fetch(`${BASE}/places:autocomplete`, {
      method: 'POST',
      headers: { 'X-Goog-Api-Key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: String(q),
        includedRegionCodes: ['us'],
        includedPrimaryTypes: TYPES,
        locationBias: NEAR_CHURCH,
      }),
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || 'Address lookup failed.' });

    const suggestions = (j.suggestions || [])
      .map(s => s.placePrediction)
      .filter(Boolean)
      .map(p => ({
        placeId: p.placeId,
        main: p.structuredFormat?.mainText?.text || p.text?.text || '',
        secondary: p.structuredFormat?.secondaryText?.text || '',
      }));
    return res.status(200).json({ suggestions });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

/* Google address components → the form's boxes. */
function toAddress(place) {
  const comps = place.addressComponents || [];
  const get = (type, short = false) => {
    const c = comps.find(x => (x.types || []).includes(type));
    return c ? (short ? c.shortText : c.longText) || '' : '';
  };
  return {
    street: [get('street_number'), get('route')].filter(Boolean).join(' '),
    line2: get('subpremise'),
    city: get('locality') || get('sublocality_level_1') || get('postal_town') || get('administrative_area_level_3'),
    state: get('administrative_area_level_1', true),
    zip: [get('postal_code'), get('postal_code_suffix')].filter(Boolean).join('-'),
    formatted: place.formattedAddress || '',
  };
}
