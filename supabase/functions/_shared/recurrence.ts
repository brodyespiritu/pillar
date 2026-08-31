/*
 * When a repeating message goes out next.
 *
 * Worked out on the wall clock in the church's own zone, never by adding
 * milliseconds. A week is not always 168 hours: across the two days a year when
 * clocks change, adding 7×24h to a Sunday noon send lands at 11:00 or 13:00,
 * and a dinner invitation would start drifting an hour every autumn.
 */

export type Repeat = 'none' | 'weekly' | 'biweekly' | 'monthly';

export const CHURCH_ZONE = 'America/New_York';

export const REPEATS: { key: Repeat; label: string }[] = [
  { key: 'none', label: 'Does not repeat' },
  { key: 'weekly', label: 'Every week' },
  { key: 'biweekly', label: 'Every 2 weeks' },
  { key: 'monthly', label: 'Every month' },
];

/* The wall-clock reading of an instant, in a given zone. */
function partsIn(ts: number, zone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(ts))) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  return {
    y: +p.year, mo: +p.month, d: +p.day,
    h: +p.hour % 24, mi: +p.minute, s: +p.second,
  };
}

const offsetAt = (ts: number, zone: string) => {
  const p = partsIn(ts, zone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - ts;
};

/*
 * The instant a wall-clock time names in a zone. Resolved twice because the
 * first guess uses the offset on the wrong side of a clock change.
 */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, zone = CHURCH_ZONE): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const once = guess - offsetAt(guess, zone);
  return guess - offsetAt(once, zone);
}

const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

/**
 * The next send time after `prev`, or null when the schedule does not repeat.
 * Keeps the same local time of day, and the same weekday for weekly rules.
 */
export function nextOccurrence(
  prev: string | number | Date,
  repeat: Repeat | string | null | undefined,
  zone = CHURCH_ZONE,
): string | null {
  if (!repeat || repeat === 'none') return null;
  const ts = prev instanceof Date ? prev.getTime()
    : typeof prev === 'number' ? prev : Date.parse(String(prev));
  if (!Number.isFinite(ts)) return null;

  const p = partsIn(ts, zone);

  if (repeat === 'weekly' || repeat === 'biweekly') {
    /* Stepped as a plain calendar date — UTC has no clock changes, so the day
       arithmetic is exact — then given back the local time it had. */
    const stepped = new Date(Date.UTC(p.y, p.mo - 1, p.d) + (repeat === 'weekly' ? 7 : 14) * 864e5);
    return new Date(zonedToUtc(
      stepped.getUTCFullYear(), stepped.getUTCMonth() + 1, stepped.getUTCDate(), p.h, p.mi, zone,
    )).toISOString();
  }

  if (repeat === 'monthly') {
    let y = p.y, mo = p.mo + 1;
    if (mo > 12) { mo = 1; y += 1; }
    // The 31st in a 30-day month means the last day of it, not the 1st of the next.
    const d = Math.min(p.d, daysInMonth(y, mo));
    return new Date(zonedToUtc(y, mo, d, p.h, p.mi, zone)).toISOString();
  }

  return null;
}

/** How a repeat rule reads on screen. */
export const repeatLabel = (r: Repeat | string | null | undefined) =>
  REPEATS.find(x => x.key === r)?.label ?? 'Does not repeat';
