// Keep long-lived clients on the latest build.
//
// Pillar's desktop apps are thin Tauri shells that load the live site remotely,
// so a webview can hold a cached index.html and keep running an old JS bundle
// (that's how someone ends up missing newer sections like "App"). This polls the
// deployed index.html; when its hashed entry bundle changes — i.e. a new deploy —
// it reloads once so the fresh build takes over. No-ops during local dev, where
// the entry isn't a hashed /assets/index-*.js file.

const ENTRY_RE = /\/assets\/index-[^"']+\.js/;
let running = null;   // the bundle we booted with

function entryFrom(html) {
  const m = html.match(ENTRY_RE);
  return m ? m[0] : null;
}

async function check() {
  if (!running) return;                 // dev, or we couldn't detect our own bundle
  try {
    const res = await fetch('/index.html?ts=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const latest = entryFrom(await res.text());
    if (latest && latest !== running) window.location.reload();
  } catch { /* offline or blocked — try again next tick */ }
}

export function startAutoUpdate() {
  // What bundle is this page actually running?
  const src = [...document.querySelectorAll('script[src]')]
    .map(s => s.getAttribute('src') || '')
    .find(s => ENTRY_RE.test(s));
  running = src || null;
  if (!running) return;                 // local dev — nothing to poll

  check();
  setInterval(check, 5 * 60 * 1000);    // every 5 min
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}
