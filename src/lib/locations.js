import { supabase } from './supabase';

/*
 * Event locations — rooms and spaces, each with an optional photo.
 * Requires supabase/locations-schema.sql.
 *
 * events.location holds the location NAME as plain text, not a foreign key.
 * That keeps the public church website (which reads events straight over
 * PostgREST) working untouched, but it means a rename has to carry the events
 * with it — see renameLocation.
 */

export const BUCKET = 'location-photos';

/** Same leniency the church website uses to match a name to a location. */
export const locationKey = s =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export async function fetchLocations() {
  const { data, error } = await supabase.from('locations').select('*').order('name');
  if (error) {
    return { rows: [], missing: /relation|does not exist/i.test(error.message || ''), error };
  }
  return { rows: data || [], missing: false };
}

export const findLocation = (rows, name) => {
  const k = locationKey(name);
  return k ? (rows || []).find(l => locationKey(l.name) === k) || null : null;
};

export async function createLocation(name, fields = {}) {
  const clean = String(name || '').trim();
  if (!clean) return { error: new Error('Name is required.') };
  return supabase.from('locations').insert({ ...fields, name: clean }).select().single();
}

export async function updateLocation(id, patch) {
  return supabase.from('locations').update(patch).eq('id', id).select().single();
}

/** How many events point at this location name (lenient, like the website). */
export async function countEventsAt(name) {
  const { data, error } = await supabase.from('events').select('id, location');
  if (error) return { count: 0, error };
  const k = locationKey(name);
  return { count: (data || []).filter(e => locationKey(e.location) === k).length };
}

/*
 * Renaming has to update every event that used the old name. events.location
 * is the name itself, so renaming the row alone would leave those events
 * pointing at a location that no longer exists — they'd silently lose their
 * photo on the website.
 */
export async function renameLocation(id, oldName, newName) {
  const clean = String(newName || '').trim();
  if (!clean) return { error: new Error('Name is required.') };

  const { data, error } = await updateLocation(id, { name: clean });
  if (error) return { error };

  const { data: evs, error: readErr } = await supabase.from('events').select('id, location');
  if (readErr) return { data, error: null, eventsUpdated: 0, eventsError: readErr };

  const k = locationKey(oldName);
  const hits = (evs || []).filter(e => locationKey(e.location) === k);
  for (const e of hits) {
    const { error: upErr } = await supabase.from('events').update({ location: clean }).eq('id', e.id);
    if (upErr) return { data, error: null, eventsUpdated: 0, eventsError: upErr };
  }
  return { data, error: null, eventsUpdated: hits.length };
}

export async function deleteLocation(id) {
  return supabase.from('locations').delete().eq('id', id);
}

/* ── Photos ────────────────────────────────────────────── */

/*
 * Downscale before upload: the church's source photos are 10–20MB camera
 * originals and the website only needs a few hundred KB.
 *
 * createImageBitmap with imageOrientation:'from-image' is what makes a
 * phone photo come out the right way up — several of these carry EXIF
 * orientation, and reading the pixels without honouring it yields a
 * sideways image.
 */
export function downscaleImage(file, { maxEdge = 1500, quality = 0.8 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file.type?.startsWith('image/')) return reject(new Error('Please choose an image file.'));

    const draw = (src, w, h) => {
      const scale = Math.min(1, maxEdge / Math.max(w, h));   // never upscale
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, cw, ch);
      canvas.toBlob(
        b => (b ? resolve({ blob: b, width: cw, height: ch }) : reject(new Error('Could not process that image.'))),
        'image/jpeg', quality,
      );
    };

    if (typeof createImageBitmap === 'function') {
      createImageBitmap(file, { imageOrientation: 'from-image' })
        .then(bmp => draw(bmp, bmp.width, bmp.height))
        .catch(() => fallback());
      return;
    }
    fallback();

    function fallback() {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.onload = () => {
        const img = new Image();
        img.onload = () => draw(img, img.naturalWidth, img.naturalHeight);
        img.onerror = () => reject(new Error('That image could not be loaded.'));
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    }
  });
}

const slug = s => String(s || 'location').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Downscale, upload to the public bucket, return { url, size, width, height }. */
export async function uploadLocationPhoto(file, locationName) {
  const { blob, width, height } = await downscaleImage(file);
  // Unique path per upload so a replaced photo isn't served from cache.
  const path = `${slug(locationName)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' });
  if (error) return { error };
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path, size: blob.size, width, height };
}
