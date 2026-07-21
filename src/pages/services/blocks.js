import { P } from '../../lib/icons';

/*
 * Service-planner building blocks. Everything here is in-memory only —
 * the planner never saves or syncs; a plan lives for the session.
 */

export const SERVICE_TIMES = ['8:30 AM', '10:30 AM'];

export const MUSICAL_KEYS = [
  'C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B',
  'Am', 'A#m', 'Bm', 'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m',
];

/*
 * kind drives which fields a block shows:
 *  music  → song title + key
 *  sermon → title + notes
 *  item   → label (name) + notes  (Welcome, Prayer, custom, …)
 */
export const PALETTE = [
  { kind: 'music',  label: 'Music',       icon: P.book,    color: '#8B5CF6', desc: 'Song + key' },
  { kind: 'sermon', label: 'Sermon',      icon: P.mic,     color: '#006BFF', desc: 'Title + notes' },
  { kind: 'item',   label: 'Welcome',     icon: P.handshake, color: '#10B981' },
  { kind: 'item',   label: 'Prayer',      icon: P.heart,   color: '#EF4444' },
  { kind: 'item',   label: 'Baptism',     icon: P.water,   color: '#06B6D4' },
  { kind: 'item',   label: 'Invitation',  icon: P.star,    color: '#F59E0B' },
  { kind: 'item',   label: 'Recognition', icon: P.check,   color: '#22C55E' },
  { kind: 'item',   label: 'Custom',      icon: P.plus,    color: '#476788', desc: 'Name your own', custom: true },
];

let _uid = 0;
export const nextId = () => `blk_${Date.now().toString(36)}_${_uid++}`;

/* Create a fresh block from a palette entry. */
export function makeBlock(p, name) {
  const base = { id: nextId(), kind: p.kind, color: p.color, icon: p.icon };
  if (p.kind === 'music')  return { ...base, title: '', musicKey: '' };
  if (p.kind === 'sermon') return { ...base, title: '', notes: '' };
  return { ...base, label: name || p.label, notes: '' };
}

export function blockTitle(b) {
  if (b.kind === 'music')  return b.title || 'Song';
  if (b.kind === 'sermon') return b.title || 'Sermon';
  return b.label || 'Item';
}
