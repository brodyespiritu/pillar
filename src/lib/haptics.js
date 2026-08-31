/*
 * Haptic feedback.
 *
 * iOS Safari has never implemented navigator.vibrate, so a purely web approach
 * buzzes on Android and does nothing at all on an iPhone — which is most of the
 * phones this runs on. Inside the native shell we therefore hand the request
 * across to React Native, which calls into the Taptic Engine through
 * expo-haptics; in a browser we fall back to navigator.vibrate, and where
 * neither exists this is a silent no-op.
 *
 * Used sparingly and on purpose. Apple's guidance is that haptics mark a change
 * of state, not every tap — a phone that buzzes at everything is a phone people
 * turn the haptics off on, and then it cannot tell them anything.
 */

/* Millisecond patterns for the navigator.vibrate fallback. Deliberately short:
 * a vibration motor is blunt next to a Taptic Engine and a long buzz reads as a
 * malfunction rather than as feedback. */
const PATTERN = {
  select:  6,
  light:   9,
  medium: 15,
  heavy:  24,
  success: [10, 45, 18],
  warning: [16, 55, 16],
  error:   [20, 45, 20, 45, 20],
};

const bridge = () =>
  (typeof window !== 'undefined' && window.__PILLAR_NATIVE__
    && window.ReactNativeWebView?.postMessage) || null;

/**
 * @param {'select'|'light'|'medium'|'heavy'|'success'|'warning'|'error'} kind
 */
export function haptic(kind = 'light') {
  const post = bridge();
  if (post) {
    /* Never let a feedback flourish break the thing it was decorating. */
    try { post(JSON.stringify({ type: 'haptic', kind })); } catch { /* ignore */ }
    return;
  }
  try { navigator?.vibrate?.(PATTERN[kind] ?? PATTERN.light); } catch { /* ignore */ }
}

/* Named for the moment rather than the intensity, so call sites read as intent
 * and the mapping can be tuned in one place. */
export const tapSelect  = () => haptic('select');   // picked one of several
export const tapOpen    = () => haptic('light');    // a sheet or menu appears
export const tapClose   = () => haptic('select');   // it goes away again
export const tapConfirm = () => haptic('medium');   // committed to something
export const tapSaved   = () => haptic('success');  // it worked
export const tapFailed  = () => haptic('error');    // it did not
