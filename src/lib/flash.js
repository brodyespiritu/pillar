/*
 * A brief green wash across the top of the screen, to say a change was saved.
 *
 * Some actions announce themselves — a form closes, a list reorders, a dialog
 * confirms. Others change the database and leave the screen looking exactly as
 * it did: moving somebody to their own household, marking a member inactive,
 * changing a care category. Those are the ones this is for. Without it the only
 * way to know it worked is to go and check.
 *
 * Imperative, and registered the same way lib/dialog.js is, so any action can
 * call it without threading a callback down through the page it lives on.
 *
 * Usage:
 *   import { flashSaved } from '../../lib/flash';
 *   await createNewHousehold(m);
 *   flashSaved();
 */

let handler = null;

export function _registerFlash(fn) { handler = fn; }

/* Silent when nothing is mounted to show it — a saved record must never be
   held up by the thing that was only ever going to congratulate it. */
export function flashSaved(label = 'Saved') {
  handler?.(label);
}
