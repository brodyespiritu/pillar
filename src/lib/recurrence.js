/*
 * Repeat rules, as the browser needs them.
 *
 * Only the labels and the option list live here — the date arithmetic belongs
 * to the sender, which is the only thing that decides when a repeating message
 * actually goes out. Keeping the maths in one place means the schedule shown on
 * screen can never disagree with the schedule that fires.
 * See supabase/functions/_shared/recurrence.ts.
 */

export const REPEATS = [
  { key: 'none', label: 'Does not repeat' },
  { key: 'weekly', label: 'Every week' },
  { key: 'biweekly', label: 'Every 2 weeks' },
  { key: 'monthly', label: 'Every month' },
];

export const repeatLabel = r => REPEATS.find(x => x.key === r)?.label ?? 'Does not repeat';

/** "Every week on Sunday" — the weekday comes from the send time itself. */
export function repeatSummary(rule, date) {
  if (!rule || rule === 'none') return null;
  if (rule === 'monthly') {
    const day = date?.getDate();
    return day ? `Every month on the ${day}${ordinal(day)}` : 'Every month';
  }
  const dow = date?.toLocaleDateString('en-US', { weekday: 'long' });
  const every = rule === 'biweekly' ? 'Every 2 weeks' : 'Every week';
  return dow ? `${every} on ${dow}` : every;
}

const ordinal = n => {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
};
