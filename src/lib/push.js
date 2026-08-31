import { supabase } from './supabase';

/*
 * Web Push — notifications that arrive when Pillar is closed.
 *
 * Distinct from lib/notify.js, which shows a notification from a page that is
 * already open. That one needs nothing but permission; this one needs a service
 * worker, a subscription, and a server willing to push to it.
 *
 * The platform rule that shapes everything here: iOS supports Web Push only for
 * a PWA that has been added to the Home Screen. In an ordinary Safari tab the
 * APIs are simply absent, so this reports that plainly rather than throwing or
 * pretending to have subscribed.
 */

const PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

export const pushSupported = () =>
  typeof window !== 'undefined'
  && 'serviceWorker' in navigator
  && 'PushManager' in window
  && 'Notification' in window;

/* True when running as an installed app rather than a browser tab. iOS only
 * grants push in the former. */
export const installedAsApp = () =>
  typeof window !== 'undefined'
  && (window.matchMedia?.('(display-mode: standalone)').matches
      || window.navigator.standalone === true);

const isIOS = () =>
  typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/**
 * Why push cannot be turned on here, or null when it can.
 * Worth surfacing verbatim — "nothing happened" is the worst possible answer to
 * someone who just tapped a switch.
 */
export function pushBlockedReason() {
  if (!pushSupported()) {
    return isIOS() && !installedAsApp()
      ? 'On iPhone, notifications work once Pillar is added to the Home Screen. Tap Share, then Add to Home Screen, and open it from there.'
      : 'This browser does not support notifications.';
  }
  if (isIOS() && !installedAsApp()) {
    return 'On iPhone, notifications work once Pillar is added to the Home Screen. Tap Share, then Add to Home Screen, and open it from there.';
  }
  if (!PUBLIC_KEY) return 'Push is not configured on this deployment yet.';
  if (Notification.permission === 'denied') {
    return 'Notifications are blocked for this site in your browser settings.';
  }
  return null;
}

/* The VAPID public key travels as base64url and PushManager wants raw bytes. */
function keyBytes(b64) {
  const pad = b64.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function registerWorker() {
  if (!pushSupported()) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); }
  catch (e) { console.error('service worker did not register:', e); return null; }
}

/** Already subscribed in this browser? */
export async function pushEnabled() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return Boolean(await reg?.pushManager.getSubscription());
}

/**
 * Ask, subscribe, and store. Must be called from a user gesture — Safari
 * ignores a permission prompt that was not.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export async function enablePush(staffId) {
  const blocked = pushBlockedReason();
  if (blocked) return { ok: false, reason: blocked };

  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerWorker());
  if (!reg) return { ok: false, reason: 'The notification service could not start.' };
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, reason: 'Notifications were not allowed.' };
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      /* Required by every browser now: a push must be shown, not used silently. */
      userVisibleOnly: true,
      applicationServerKey: keyBytes(PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    staff_id: staffId ?? null,
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? b64(sub.getKey('p256dh')),
    auth: json.keys?.auth ?? b64(sub.getKey('auth')),
    user_agent: navigator.userAgent.slice(0, 300),
  }, { onConflict: 'endpoint' });

  if (error) {
    /* Do not leave a live browser subscription the server has no record of —
       it would receive nothing and look broken. */
    await sub.unsubscribe().catch(() => {});
    return { ok: false, reason: `Could not save the subscription: ${error.message}` };
  }
  return { ok: true };
}

export async function disablePush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe().catch(() => {});
}
