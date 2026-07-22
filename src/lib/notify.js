// Notifications helper — native in the desktop app, Web API in the browser.
//
// In the installed Tauri desktop app we route through the native notification
// plugin (real macOS/Windows notifications). In a browser / PWA we use the Web
// Notification API. The same deployed bundle runs in both, so every path is
// guarded by isDesktopApp().

import {
  isPermissionGranted as tauriIsGranted,
  requestPermission as tauriRequest,
  sendNotification as tauriSend,
} from '@tauri-apps/plugin-notification';

/* Running inside the native (Tauri) desktop app. */
export function isDesktopApp() {
  return typeof window !== 'undefined' && !!(window.__TAURI__ || window.__TAURI_INTERNALS__ || window.isTauri);
}

/* Running inside an installed browser PWA (own window, no address bar). */
export function isInstalledPWA() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)')?.matches === true
    || window.navigator?.standalone === true;
}

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/* Synchronous best-effort read (Web API only; use getPermission() for desktop). */
export function notificationPermission() {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

/* Current permission — works in the desktop app too. 'granted' | 'default' | 'denied' | 'unsupported'. */
export async function getPermission() {
  if (isDesktopApp()) {
    try { return (await tauriIsGranted()) ? 'granted' : 'default'; }
    catch { return 'unsupported'; }   // old app build without the plugin
  }
  return notificationPermission();
}

/**
 * Request permission from a user gesture. Returns 'granted' | 'denied' | 'unsupported'.
 * On success, fires a confirmation notification so the user sees it work.
 */
export async function enableDesktopNotifications() {
  if (isDesktopApp()) {
    try {
      let granted = await tauriIsGranted();
      if (!granted) granted = (await tauriRequest()) === 'granted';
      if (granted) {
        tauriSend({ title: 'Notifications enabled', body: "You'll get desktop alerts from Pillar here." });
        return 'granted';
      }
      return 'denied';
    } catch {
      return 'unsupported';   // app predates the native plugin
    }
  }

  // Browser / PWA path
  if (!notificationsSupported()) return 'unsupported';
  try {
    let res = Notification.permission;
    if (res !== 'granted') {
      // Safari <16 uses the callback form; normalize both to a promise.
      res = await new Promise(resolve => {
        const p = Notification.requestPermission(resolve);
        if (p && typeof p.then === 'function') p.then(resolve);
      });
    }
    if (res === 'granted') {
      showNotification('Notifications enabled', { body: "You'll get desktop alerts from Pillar here.", tag: 'pillar-enabled' });
    }
    return res;
  } catch {
    return 'denied';
  }
}

/* Show a notification if allowed. Returns true if shown. */
export async function showNotification(title, options = {}) {
  if (isDesktopApp()) {
    try { await tauriSend({ title, body: options.body }); return true; }
    catch { return false; }
  }
  if (!notificationsSupported() || Notification.permission !== 'granted') return false;
  try { new Notification(title, options); return true; }
  catch { return false; }
}

/* What to tell the user when permission is blocked — no address bar assumed. */
export function blockedHelpText() {
  if (isDesktopApp()) {
    return 'Notifications are turned off for Pillar. Open System Settings → Notifications → Pillar and turn on “Allow Notifications,” then click Enable again.';
  }
  if (isInstalledPWA()) {
    return "Notifications are blocked. There's no address bar here, so re-allow them by opening pillar-bethesda.vercel.app in a normal Chrome or Safari tab and clicking Allow (padlock → Notifications → Allow) — the setting is shared with this installed app. Then reopen it and click Enable again.";
  }
  return "Notifications are blocked. Click the padlock in your browser's address bar → Notifications → Allow, then click Enable again.";
}

/* What to tell the user when the environment can't do notifications at all. */
export function unsupportedHelpText() {
  if (isDesktopApp()) {
    return 'Your installed Pillar app is out of date. Download the latest desktop app to turn on notifications.';
  }
  return 'This browser doesn’t support notifications. Try the Pillar web app in Chrome, Edge, or Safari.';
}
