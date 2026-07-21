import { supabase } from './supabase';

export const STATUSES = ['Active', 'Inactive'];

export async function fetchChurchMembers() {
  const { data, error } = await supabase.from('church_members').select('*').order('name');
  if (error) return { rows: [], missing: true };
  return { rows: data || [], missing: false };
}

export async function saveChurchMember(member) {
  const payload = { ...member };
  if (payload.birthday === '') payload.birthday = null;
  if (member.id) {
    const { data, error } = await supabase.from('church_members').update(payload).eq('id', member.id).select().single();
    return { data, error };
  }
  delete payload.id;
  const { data, error } = await supabase.from('church_members').insert(payload).select().single();
  return { data, error };
}

export async function deleteChurchMember(id) {
  return supabase.from('church_members').delete().eq('id', id);
}

/*
 * Attach a person to a ministry on their member profile.
 * Matches an existing member by name (case-insensitive); if none exists,
 * creates one. The ministry is added to the member's `tags` (dedup'd),
 * which is what the Members page shows under "Groups".
 * Returns the up-to-date member row (or { error }).
 */
export async function attachMinistry(name, ministry) {
  const clean = (name || '').trim();
  if (!clean) return { error: new Error('Name is required.') };

  const { data: existing } = await supabase
    .from('church_members').select('*').ilike('name', clean).limit(1);
  const member = existing?.[0];

  if (member) {
    const tags = (member.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    if (!tags.some(t => t.toLowerCase() === ministry.toLowerCase())) tags.push(ministry);
    const { data, error } = await supabase.from('church_members')
      .update({ tags: tags.join(', ') }).eq('id', member.id).select().single();
    return { data, error, created: false };
  }

  const { data, error } = await supabase.from('church_members')
    .insert({ name: clean, tags: ministry, status: 'Active' }).select().single();
  return { data, error, created: true };
}

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
}

/* Read an image file, downscale/crop to a square thumbnail, return a compact JPEG data URI */
export function fileToAvatarDataUrl(file, size = 400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // center-crop to a square, then scale to `size`
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('That image could not be loaded.'));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
