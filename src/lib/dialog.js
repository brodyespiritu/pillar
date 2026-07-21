/*
 * In-app dialogs that work everywhere — including the Tauri desktop webview,
 * where native window.confirm / alert / prompt do NOT render (macOS WKWebView
 * suppresses them), which silently breaks any confirm()-gated action.
 *
 * Usage:
 *   if (!(await confirmDialog({ message: 'Delete?', danger: true }))) return;
 *   const val = await promptDialog({ message: 'New PIN', placeholder: '4 digits' });
 *   await alertDialog({ message: 'Saved.' });
 */
let handler = null;
export function _registerDialog(fn) { handler = fn; }

const normalize = opts => (typeof opts === 'string' ? { message: opts } : (opts || {}));

function open(config) {
  return new Promise(resolve => {
    if (!handler) {
      // Fallback (browser only) if the renderer isn't mounted yet.
      if (config.type === 'confirm') return resolve(window.confirm(config.message));
      if (config.type === 'prompt')  return resolve(window.prompt(config.message, config.defaultValue || ''));
      window.alert(config.message); return resolve(undefined);
    }
    handler({ ...config, resolve });
  });
}

export const confirmDialog = opts => open({ type: 'confirm', ...normalize(opts) });
export const promptDialog  = opts => open({ type: 'prompt',  ...normalize(opts) });
export const alertDialog   = opts => open({ type: 'alert',   ...normalize(opts) });
