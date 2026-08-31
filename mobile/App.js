import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, BackHandler, Platform, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import { useNetworkState } from 'expo-network';
import * as Haptics from 'expo-haptics';

/*
 * Pillar, as a phone app.
 *
 * The window shows the deployed site rather than a bundled copy — the same
 * arrangement as the Tauri desktop build, whose window.url also points at
 * Vercel. One codebase, and a web deploy reaches every phone at once with no
 * store review in between.
 *
 * What makes it an app rather than a browser tab lives in this file: the splash
 * held until the first paint, the Android back button wired to history, calls
 * and emails handed to the phone instead of trapped in the view, and a real
 * screen when the network drops rather than Chrome's dinosaur.
 */

const SITE = Constants.expoConfig?.extra?.pillarSite || 'https://pillar-bethesda.vercel.app';

/* Ours, plus Supabase for any auth round trip. Everything else is somebody
 * else's website and belongs in the phone's browser. */
const INTERNAL = /^https:\/\/(pillar-bethesda\.vercel\.app|[a-z0-9-]+\.supabase\.co)([/?#]|$)/i;

const BRAND = '#2C3A4B';   /* the theme-color index.html already declares */
const SURFACE = '#FFFFFF';

SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions?.({ duration: 220, fade: true });

/*
 * Tells the web app it is inside the native shell, and hands it the status-bar
 * insets. A WebView does not resolve env(safe-area-inset-*) the way Safari
 * does, so the page reads --pillar-safe-top / --pillar-safe-bottom instead and
 * falls back to env() when it is opened in a browser.
 *
 * The shell used to paint a white band over the bottom inset. That worked, but
 * it meant a sheet could never reach the bottom of the screen — there was
 * always a white strip under it.
 */
const beforeLoad = (top, bottom) => `
  window.__PILLAR_NATIVE__ = true;
  document.documentElement.classList.add('pillar-native');
  document.documentElement.style.setProperty('--pillar-safe-top', '${top}px');
  document.documentElement.style.setProperty('--pillar-safe-bottom', '${bottom}px');
  true;
`;

function Shell() {
  const insets = useSafeAreaInsets();
  const web = useRef(null);
  const canGoBack = useRef(false);

  const [failed, setFailed] = useState(false);
  const [booting, setBooting] = useState(true);
  const [attempt, setAttempt] = useState(0);

  /* Splash covers the first paint. The timer is a backstop: a load that never
   * settles must not leave the user staring at a logo. */
  useEffect(() => {
    const t = setTimeout(() => { setBooting(false); SplashScreen.hideAsync().catch(() => {}); }, 12000);
    return () => clearTimeout(t);
  }, []);

  /* expo-network rather than NetInfo: it ships inside Expo Go, so the app can
   * be tried on a real phone without a native build. isInternetReachable stays
   * undefined while it is still being probed, which is not the same as false. */
  const net = useNetworkState();
  const online = net.isInternetReachable !== false && net.isConnected !== false;

  /* Android's back button should walk the site's history before it closes the
   * app — otherwise one tap from anywhere drops you out. */
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current && web.current) { web.current.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, []);

  const settle = useCallback(() => {
    setBooting(false);
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  const retry = useCallback(() => {
    setFailed(false);
    setBooting(true);
    setAttempt(n => n + 1);
  }, []);

  /*
 * The web side cannot reach the Taptic Engine — iOS Safari has no
 * navigator.vibrate — so it posts across and this plays the real thing.
 * Anything unrecognised is ignored rather than guessed at.
 */
const IMPACT = {
  light:  Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy:  Haptics.ImpactFeedbackStyle.Heavy,
};
const NOTIFY = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error:   Haptics.NotificationFeedbackType.Error,
};

function playHaptic(kind) {
  /* Fire and forget: a failed buzz must never surface as an error in the app. */
  const done = () => {};
  if (kind === 'select') return Haptics.selectionAsync().catch(done);
  if (IMPACT[kind]) return Haptics.impactAsync(IMPACT[kind]).catch(done);
  if (NOTIFY[kind]) return Haptics.notificationAsync(NOTIFY[kind]).catch(done);
  return undefined;
}

/* tel:, mailto: and sms: matter here — the SMS and Cares pages are full of
   * phone numbers, and a number that does nothing when tapped is the giveaway
   * that something is only pretending to be an app. */
  /* The only thing the page is allowed to ask for across this channel. */
  const onMessage = useCallback(e => {
    let msg;
    try { msg = JSON.parse(e?.nativeEvent?.data ?? ''); } catch { return; }
    if (msg?.type === 'haptic') playHaptic(msg.kind);
  }, []);

  const route = useCallback(req => {
    const url = String(req?.url || '');
    if (req?.isTopFrame === false) return true;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return true;
    if (url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) return true;
    if (INTERNAL.test(url)) return true;
    Linking.openURL(url).catch(() => {});
    return false;
  }, []);

  const offline = !online;
  const blocked = offline || failed;

  return (
    <View style={styles.root}>
      <StatusBar style="light" translucent backgroundColor="transparent" />

      <View style={styles.body}>
        {!blocked && (
          <WebView
            key={attempt}
            ref={web}
            source={{ uri: SITE }}
            style={styles.web}
            /* Matches the hero so the gap before first paint is not white. */
            containerStyle={styles.web}
            applicationNameForUserAgent="Pillar/1.2.0"
            injectedJavaScriptBeforeContentLoaded={beforeLoad(insets.top, insets.bottom)}
            /* Re-applied after load, so a rotation cannot leave it stale. */
            injectedJavaScript={beforeLoad(insets.top, insets.bottom)}
            onShouldStartLoadWithRequest={route}
            onMessage={onMessage}
            onNavigationStateChange={s => { canGoBack.current = Boolean(s.canGoBack); }}
            onLoadEnd={settle}
            onError={() => { setFailed(true); settle(); }}
            onHttpError={e => {
              /* Only a broken shell counts. A 404 on one asset is the site's problem. */
              if (e?.nativeEvent?.statusCode >= 500) { setFailed(true); settle(); }
            }}
            /* Supabase keeps its session in localStorage; without this Android
             * signs the user out on every launch. */
            domStorageEnabled
            javaScriptEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            /* target=_blank should reach onShouldStartLoadWithRequest rather
             * than silently opening a window Android never shows. */
            setSupportMultipleWindows={false}
            /*
             * iOS puts a grey bar with up/down arrows and a Done tick above the
             * keyboard for form navigation. Pillar's forms do their own paging
             * with a Next button, so the bar is a second, uglier control for
             * something the sheet already handles.
             */
            hideKeyboardAccessoryView
            allowsBackForwardNavigationGestures
            pullToRefreshEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            overScrollMode="never"
            startInLoadingState={false}
          />
        )}

        {blocked && (
          <View style={styles.panel}>
            <Text style={styles.title}>{offline ? 'No connection' : 'Pillar is unreachable'}</Text>
            <Text style={styles.note}>
              {offline
                ? 'Pillar needs a connection to reach the church records. Reconnect and try again.'
                : 'The site did not respond. It may be mid-deploy — give it a moment and try again.'}
            </Text>
            <TouchableOpacity style={styles.button} onPress={retry} activeOpacity={0.8}>
              <Text style={styles.buttonText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {booting && !blocked && (
          <View style={styles.veil} pointerEvents="none">
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        )}
      </View>

    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BRAND },
  body: { flex: 1, backgroundColor: SURFACE },
  web: { flex: 1, backgroundColor: BRAND },
  veil: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: BRAND },
  panel: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, backgroundColor: SURFACE },
  title: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 10, textAlign: 'center' },
  note: { fontSize: 15, lineHeight: 22, color: '#6B7280', textAlign: 'center', marginBottom: 28 },
  button: {
    minHeight: 48, paddingHorizontal: 32, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#006BFF',
  },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
