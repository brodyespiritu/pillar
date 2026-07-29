// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod mail;

use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Base site the app shell loads; the widget is a route on the same origin so
/// it shares the signed-in Supabase session with the main window.
const SITE: &str = "https://pillar-bethesda.vercel.app";
const WIDGET_LABEL: &str = "calendar-widget";

/// Open (or focus) the small always-on-top calendar widget window.
#[tauri::command]
fn open_calendar_widget(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    // Already open → bring it forward rather than stacking duplicates.
    if let Some(win) = app.get_webview_window(WIDGET_LABEL) {
        let _ = win.unminimize();
        let _ = win.show();
        return win.set_focus().map_err(|e| e.to_string());
    }

    let url = format!("{SITE}/widget/calendar")
        .parse()
        .map_err(|_| "bad widget url".to_string())?;

    WebviewWindowBuilder::new(&app, WIDGET_LABEL, WebviewUrl::External(url))
        .title("Pillar Calendar")
        .inner_size(390.0, 580.0)
        .min_inner_size(320.0, 380.0)
        .always_on_top(true)
        .resizable(true)
        .skip_taskbar(false)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            open_calendar_widget,
            mail::email_test,
            mail::email_fetch,
            mail::email_send
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
