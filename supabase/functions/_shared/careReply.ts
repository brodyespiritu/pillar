/*
 * The conversational half of Cares-by-text: what to say back, and how to read
 * the answer to a question we asked.
 *
 * Pure functions — the caller does the database work. Kept separate from
 * careIntake so the whole exchange can be replayed in tests without a network.
 */

import type { Person } from './careIntake.ts';

export const last10 = (s: string) => String(s || '').replace(/\D/g, '').slice(-10);
export const keyword = (t: string) => String(t || '').trim().toLowerCase().replace(/[^a-z]/g, '');

/* A question goes stale — an answer hours later is almost certainly about
   something else, and resuming then would file it against the wrong person. */
export const THREAD_TTL_MIN = 120;
export const threadIsFresh = (updatedAt: string, now = new Date()) =>
  !!updatedAt && (now.getTime() - new Date(updatedAt).getTime()) / 60000 < THREAD_TTL_MIN;

const first = (n: string) => String(n || '').split(/\s+/)[0] || n;

export function askChoice(options: Person[]): string {
  const list = options.slice(0, 4).map((o, i) => `${i + 1}. ${o.name}`).join('\n');
  return `Which one?\n${list}\nReply with the number, or a full name.`;
}

export const askPerson = () =>
  'Who is that about? Reply with their name.';

export const askReason = (person: Person) =>
  `What's going on with ${first(person.name)}?`;

export const askNew = (name: string) =>
  `I don't have ${name} in the directory. Reply YES to add them to Cares anyway, or send a different name.`;

export const confirmCreate = (name: string, category: string, notes: string) =>
  `Added ${name} to Cares (${category}): ${notes}\nReply UNDO to remove.`;

export const confirmUpdate = (name: string, notes: string) =>
  `Logged for ${name}: ${notes}\nReply UNDO to remove.`;

export const confirmUndo = (what: string) => `Removed ${what}.`;
export const nothingToUndo = () => 'Nothing recent to undo.';

/*
 * Read a reply to "which one?" — a number, or a name typed out. Anything else
 * is treated as a fresh message rather than forced into the old question.
 */
export function readChoice(text: string, options: Person[]): Person | null {
  const t = String(text || '').trim();
  const n = Number(t.replace(/[^\d]/g, ''));
  if (/^\s*\d+\s*[.)]?\s*$/.test(t) && n >= 1 && n <= options.length) return options[n - 1];

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const q = norm(t);
  if (!q) return null;
  return options.find(o => norm(o.name) === q)
      || options.find(o => norm(o.name).startsWith(q) && q.length >= 3)
      || null;
}

export const isYes = (t: string) => ['yes', 'y', 'yep', 'yeah', 'ok', 'okay', 'sure', 'add'].includes(keyword(t));
export const isNo  = (t: string) => ['no', 'n', 'nope', 'cancel', 'nevermind', 'never'].includes(keyword(t));
