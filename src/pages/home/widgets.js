import { P } from '../../lib/icons';

/*
 * Home widget catalog. Layout is a list of { id, type, size } instances,
 * persisted to localStorage per user. Sizes are iOS-style: small / medium / large.
 * One consistent style: dark navy card, blue pill, arrow action.
 */

export const SIZES = ['small', 'medium', 'large'];
export const SIZE_LABEL = { small: 'S', medium: 'M', large: 'L' };
export const SIZE_SPAN = {
  small:  { col: 1, row: 1 },
  medium: { col: 2, row: 1 },
  large:  { col: 2, row: 2 },
};

export const WIDGETS = {
  cares:     { title: 'Cares',        icon: P.heart,    to: '/cares',    action: 'Open cares',    sizes: ['small', 'medium', 'large'] },
  calendar:  { title: 'Calendar',     icon: P.calendar, to: '/calendar', action: 'Open calendar', sizes: ['small', 'medium', 'large'] },
  guests:    { title: 'Guests',       icon: P.users,    to: '/guests',   action: 'Open guests',   sizes: ['small', 'medium', 'large'] },
  members:   { title: 'Members',      icon: P.person,   to: '/members',  action: 'Open members',  sizes: ['small', 'medium', 'large'] },
  email:     { title: 'Email',        icon: P.mail,     to: '/email',    action: 'Open inbox',    sizes: ['small', 'medium'] },
  sms:       { title: 'SMS',          icon: P.chat,     to: '/sms',      action: 'Open SMS',      sizes: ['small', 'medium'] },
  attendance:{ title: 'Attendance',   icon: P.grid,                     action: 'View map',      sizes: ['small', 'medium'] },
  analytics: { title: 'App Analytics', icon: P.radio,   soon: true,      sizes: ['small', 'medium', 'large'] },
};

export const ADDABLE = Object.keys(WIDGETS);

export const DEFAULT_LAYOUT = [
  { type: 'cares',    size: 'large' },
  { type: 'calendar', size: 'medium' },
  { type: 'members',  size: 'medium' },
  { type: 'guests',   size: 'medium' },
  { type: 'email',    size: 'small' },
  { type: 'sms',      size: 'small' },
];

let _uid = 0;
export const widgetId = () => `w_${Date.now().toString(36)}_${_uid++}`;

const withIds = list => list
  .filter(w => WIDGETS[w.type])
  .map(w => ({ id: w.id || widgetId(), type: w.type, size: WIDGETS[w.type].sizes.includes(w.size) ? w.size : WIDGETS[w.type].sizes[0] }));

const KEY = uid => `pillar:home-layout:${uid || 'anon'}`;

export function loadLayout(uid) {
  try {
    const raw = localStorage.getItem(KEY(uid));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return withIds(parsed);
    }
  } catch { /* fall through to default */ }
  return withIds(DEFAULT_LAYOUT);
}

export function saveLayout(uid, layout) {
  try { localStorage.setItem(KEY(uid), JSON.stringify(layout.map(({ type, size }) => ({ type, size })))); }
  catch { /* ignore quota / private mode */ }
}
