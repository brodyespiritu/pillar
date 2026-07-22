// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod mail;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            mail::email_test,
            mail::email_fetch,
            mail::email_send
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
