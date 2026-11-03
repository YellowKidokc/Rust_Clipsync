mod capture;
mod config;
mod secrets;
mod store;

use config::{Config, ConfigPatch};
use store::{Item, Query, Store};
use std::{path::PathBuf, sync::{Arc, Mutex}, thread, time::Duration};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub struct State {
    pub config: Mutex<Config>,
    /// Hash of the last clipboard text seen, so the watcher skips what we paste ourselves.
    pub last_hash: Mutex<u64>,
    config_path: PathBuf,
}

// ---------- commands called from the React side ----------

type Db<'a> = tauri::State<'a, Arc<Store>>;
fn err(e: rusqlite::Error) -> String { e.to_string() }

#[tauri::command]
fn list_items(db: Db, query: Query) -> Result<Vec<Item>, String> { db.list(query).map_err(err) }

#[tauri::command]
fn save_item(db: Db, item: Item) -> Result<Item, String> { db.save(item).map_err(err) }

#[tauri::command]
fn delete_item(db: Db, id: i64) -> Result<(), String> { db.delete(id).map_err(err) }

#[tauri::command]
fn set_pinned(db: Db, id: i64, pinned: bool) -> Result<(), String> { db.set_pinned(id, pinned).map_err(err) }

#[tauri::command]
fn mark_used(db: Db, id: i64) -> Result<(), String> { db.mark_used(id).map_err(err) }

#[tauri::command]
fn clear_clips(db: Db) -> Result<usize, String> { db.clear_clips().map_err(err) }

/// Copy without pasting (from the main window).
#[tauri::command]
fn copy_text(state: tauri::State<Arc<State>>, text: String) -> Result<(), String> {
    *state.last_hash.lock().unwrap() = capture::hash(&text);
    arboard::Clipboard::new().and_then(|mut c| c.set_text(text)).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_config(state: tauri::State<Arc<State>>) -> Config {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn set_config(app: AppHandle, state: tauri::State<Arc<State>>, patch: ConfigPatch) -> Result<Config, String> {
    let old = state.config.lock().unwrap().clone();
    let mut cfg = old.clone();
    cfg.apply(patch);
    if cfg.hotkey != old.hotkey {
        let gs = app.global_shortcut();
        gs.register(cfg.hotkey.as_str()).map_err(|e| format!("hotkey '{}': {e}", cfg.hotkey))?;
        let _ = gs.unregister(old.hotkey.as_str());
    }
    if cfg.autostart != old.autostart {
        let al = app.autolaunch();
        let _ = if cfg.autostart { al.enable() } else { al.disable() };
    }
    cfg.save(&state.config_path);
    *state.config.lock().unwrap() = cfg.clone();
    if let Some(item) = app.try_state::<CheckMenuItem<tauri::Wry>>() {
        let _ = item.set_checked(cfg.capture_enabled);
    }
    Ok(cfg)
}

/// Paste from the picker: clipboard ← text, hide picker (focus returns to the previous app), Ctrl+V.
#[tauri::command]
fn paste_text(app: AppHandle, state: tauri::State<Arc<State>>, text: String) -> Result<(), String> {
    *state.last_hash.lock().unwrap() = capture::hash(&text); // don't re-capture our own paste
    arboard::Clipboard::new().and_then(|mut c| c.set_text(text)).map_err(|e| e.to_string())?;
    if let Some(w) = app.get_webview_window("picker") {
        let _ = w.hide();
    }
    thread::spawn(|| {
        thread::sleep(Duration::from_millis(120));
        send_paste();
    });
    Ok(())
}

#[tauri::command]
fn hide_picker(app: AppHandle) {
    if let Some(w) = app.get_webview_window("picker") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn show_main(app: AppHandle) {
    hide_picker(app.clone());
    show_window(&app, "main");
}

fn send_paste() {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    let Ok(mut e) = Enigo::new(&Settings::default()) else { return };
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;
    let _ = e.key(modifier, Direction::Press);
    let _ = e.key(Key::Unicode('v'), Direction::Click);
    let _ = e.key(modifier, Direction::Release);
}

// ---------- windows ----------

fn show_window(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Toggle the picker, placed at the mouse cursor and kept on the cursor's monitor.
fn toggle_picker(app: &AppHandle) {
    let Some(w) = app.get_webview_window("picker") else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    place_at_cursor(app, &w);
    let _ = w.show();
    let _ = w.set_focus();
    let _ = w.emit("picker-shown", ());
}

fn place_at_cursor(app: &AppHandle, w: &WebviewWindow) {
    let Ok(cursor) = app.cursor_position() else { return };
    let size = w.outer_size().unwrap_or(tauri::PhysicalSize::new(560, 440));
    let (mut x, mut y) = (cursor.x as i32 + 8, cursor.y as i32 + 8);
    if let Ok(Some(m)) = app.monitor_from_point(cursor.x, cursor.y) {
        let (mp, ms) = (m.position(), m.size());
        let (right, bottom) = (mp.x + ms.width as i32, mp.y + ms.height as i32);
        if x + size.width as i32 > right { x = (cursor.x as i32 - size.width as i32 - 8).max(mp.x); }
        if y + size.height as i32 > bottom { y = (cursor.y as i32 - size.height as i32 - 8).max(mp.y); }
    }
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

// ---------- app ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch (e.g. from the Start menu) just opens the main window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_window(app, "main")))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_picker(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![get_config, set_config, paste_text, hide_picker, show_main, list_items, save_item, delete_item, set_pinned, mark_used, clear_clips, copy_text])
        .setup(|app| {
            let handle = app.handle().clone();
            let dir = app.path().app_config_dir()?;
            let config_path = dir.join("config.json");
            let cfg = Config::load(&config_path);
            cfg.save(&config_path);

            let state = Arc::new(State {
                config: Mutex::new(cfg.clone()),
                last_hash: Mutex::new(0),
                config_path,
            });
            app.manage(state.clone());
            let store = Arc::new(Store::open(&app.path().app_data_dir()?.join("clipsync.db"))?);
            app.manage(store.clone());

            if let Err(e) = app.global_shortcut().register(cfg.hotkey.as_str()) {
                eprintln!("could not register hotkey {}: {e}", cfg.hotkey);
            }
            let al = app.autolaunch();
            if cfg.autostart && !al.is_enabled().unwrap_or(false) {
                let _ = al.enable();
            }

            // Tray
            let open = MenuItem::with_id(app, "open", "Open ClipSync", true, None::<&str>)?;
            let picker = MenuItem::with_id(app, "picker", "Quick picker\tCtrl+Shift+Space", true, None::<&str>)?;
            let capture = CheckMenuItem::with_id(app, "capture", "Capture clipboard", true, cfg.capture_enabled, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&open, &picker, &capture, &sep, &quit])?;
            app.manage(capture.clone());

            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().cloned().expect("bundle icon"))
                .tooltip("ClipSync")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, ev| match ev.id().as_ref() {
                    "open" => show_window(app, "main"),
                    "picker" => toggle_picker(app),
                    "capture" => {
                        let st = app.state::<Arc<State>>();
                        let mut c = st.config.lock().unwrap();
                        c.capture_enabled = !c.capture_enabled;
                        c.save(&st.config_path);
                        let _ = capture.set_checked(c.capture_enabled);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                        show_window(tray.app_handle(), "main");
                    }
                })
                .build(app)?;

            capture::spawn(handle.clone(), state, store, dir.join("queue.json"));

            // Launched by hand (not by autostart): show the main window once.
            if !std::env::args().any(|a| a == "--hidden") {
                show_window(&handle, "main");
            }
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            // Closing the main window keeps the app in the tray.
            ("main", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = window.hide();
            }
            // The picker disappears as soon as it loses focus, like a menu.
            ("picker", WindowEvent::Focused(false)) => {
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running ClipSync");
}
