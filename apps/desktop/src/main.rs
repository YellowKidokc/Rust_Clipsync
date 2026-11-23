#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capture;
mod ollama;
mod platform;
mod sync;

use anyhow::{anyhow, ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use capture::ClipboardState;
use clip_core::{Content, Item, Store};
use fs2::FileExt;
use image::{DynamicImage, ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Cursor, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use zeroize::Zeroizing;

const MAX_CLIP_BYTES: usize = 64 * 1024 * 1024;
type Command<T> = std::result::Result<T, String>;

#[derive(Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct Settings {
    text: bool,
    images: bool,
    files: bool,
    paused: bool,
    max_bytes: usize,
    ollama_url: String,
    model: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            text: true,
            images: true,
            files: true,
            paused: false,
            max_bytes: 10 * 1024 * 1024,
            ollama_url: "http://localhost:11434".into(),
            model: String::new(),
        }
    }
}

struct Desktop {
    directory: PathBuf,
    store: Mutex<Option<Store>>,
    settings: Mutex<Settings>,
    clipboard: Mutex<ClipboardState>,
    open_error: Mutex<Option<String>>,
    capture_status: Mutex<Option<String>>,
    paste_target: Mutex<isize>,
    sync: sync::SyncState,
    _lock: File,
}

fn result<T>(value: Result<T>) -> Command<T> {
    value.map_err(|error| format!("{error:#}"))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file =
        tempfile::NamedTempFile::new_in(path.parent().context("Missing file directory")?)?;
    file.write_all(bytes)?;
    file.as_file().sync_all()?;
    file.persist(path)?;
    Ok(())
}

fn keychain() -> Result<keyring::Entry> {
    Ok(keyring::Entry::new("com.clipsync.desktop", "vault-key")?)
}

fn read_key() -> Result<Option<clip_crypto::Key>> {
    match keychain()?.get_password() {
        Ok(secret) => {
            let secret = Zeroizing::new(secret);
            let mut key = Zeroizing::new([0; 32]);
            hex::decode_to_slice(secret.as_bytes(), key.as_mut())
                .context("Invalid ClipSync key in the OS keychain")?;
            Ok(Some(key))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error).context("Could not read the OS keychain"),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    ready: bool,
    error: Option<String>,
    capture_error: Option<String>,
    settings: Settings,
}

#[tauri::command]
fn status(state: State<'_, Desktop>) -> Status {
    Status {
        ready: state.store.lock().unwrap().is_some(),
        error: state.open_error.lock().unwrap().clone(),
        capture_error: state.capture_status.lock().unwrap().clone(),
        settings: state.settings.lock().unwrap().clone(),
    }
}

#[tauri::command]
async fn initialize(app: AppHandle, passphrase: String) -> Command<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let passphrase = Zeroizing::new(passphrase);
        let state = app.state::<Desktop>();
        let mut store = state.store.lock().unwrap();
        if store.is_some() {
            return Ok(());
        }
        result((|| {
            let path = state.directory.join("clips.sqlite");
            let key = match read_key() {
                Ok(Some(key)) => key,
                other => {
                    other?;
                    ensure!(
                        !path.exists(),
                        "Restore the ClipSync key in the OS keychain to open this vault"
                    );
                    if passphrase.is_empty() {
                        *state.open_error.lock().unwrap() = None;
                        let _ = app.emit("vault-ready", ());
                        return Ok(());
                    }
                    ensure!(
                        passphrase.chars().count() >= 12,
                        "Use a passphrase of at least 12 characters"
                    );
                    let salt = clip_crypto::random::<16>()?;
                    let key = clip_crypto::derive(passphrase.as_bytes(), &salt)?;
                    write_atomic(&state.directory.join("salt"), &salt)?;
                    let encoded = Zeroizing::new(hex::encode(key.as_ref()));
                    keychain()?
                        .set_password(&encoded)
                        .context("Could not save the key in the OS keychain")?;
                    key
                }
            };
            *store = Some(Store::open(&path, key)?);
            *state.open_error.lock().unwrap() = None;
            let _ = app.emit("vault-ready", ());
            Ok(())
        })())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn with_store<T>(state: &Desktop, f: impl FnOnce(&mut Store) -> Result<T>) -> Result<T> {
    let mut lock = state.store.lock().unwrap();
    f(lock.as_mut().context("Create the ClipSync vault first")?)
}

#[tauri::command]
fn search(state: State<'_, Desktop>, query: String) -> Command<Vec<Item>> {
    result(with_store(&state, |store| store.list(&query, 150)))
}

#[derive(Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "lowercase")]
enum Preview {
    Text(String),
    Image(String),
    File(Vec<String>),
    Secret,
}

#[tauri::command]
async fn preview(app: AppHandle, id: String) -> Command<Preview> {
    tauri::async_runtime::spawn_blocking(move || {
        result((|| {
            let state = app.state::<Desktop>();
            let clip = with_store(&state, |store| store.get(&id))?;
            if clip.item.is_secret {
                return Ok(Preview::Secret);
            }
            Ok(match clip.content {
                Content::Text(text) => Preview::Text(text.chars().take(24_000).collect()),
                Content::Files(files) => {
                    Preview::File(files.into_iter().map(|(name, _)| name).collect())
                }
                Content::Image {
                    width,
                    height,
                    rgba,
                } => {
                    let image = RgbaImage::from_raw(width as u32, height as u32, rgba)
                        .context("Invalid image")?;
                    let mut bytes = Cursor::new(Vec::new());
                    DynamicImage::ImageRgba8(image)
                        .thumbnail(740, 740)
                        .write_to(&mut bytes, ImageFormat::Png)?;
                    Preview::Image(format!(
                        "data:image/png;base64,{}",
                        STANDARD.encode(bytes.into_inner())
                    ))
                }
            })
        })())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn keep(app: AppHandle, id: String, kept: bool) -> Command<()> {
    result(with_store(&app.state::<Desktop>(), |store| {
        store.set_kept(&id, kept)
    }))?;
    let _ = app.emit("clips-changed", ());
    Ok(())
}

#[tauri::command]
fn remove(app: AppHandle, id: String) -> Command<()> {
    result(with_store(&app.state::<Desktop>(), |store| {
        store.delete(&id)
    }))?;
    let _ = app.emit("clips-changed", ());
    Ok(())
}

#[tauri::command]
async fn copy(window: WebviewWindow, id: String, paste: bool) -> Command<()> {
    tauri::async_runtime::spawn_blocking(move || {
        result((|| {
            ensure!(
                !paste || window.label() == "popup",
                "Quick paste is available from the popup"
            );
            let state = window.state::<Desktop>();
            let clip = with_store(&state, |store| store.get(&id))?;
            state
                .clipboard
                .lock()
                .unwrap()
                .set_for_paste(clip.content, clip.item.is_secret)?;
            if paste {
                window.hide()?;
                std::thread::sleep(Duration::from_millis(80));
                let target = *state.paste_target.lock().unwrap();
                if let Err(error) = platform::restore(target).and_then(|()| capture::send_paste()) {
                    let _ = window.show();
                    let _ = window.set_focus();
                    return Err(error).context("Could not send paste to the previous app");
                }
            }
            Ok(())
        })())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Command<()> {
    result((|| {
        ensure!(
            (1..=MAX_CLIP_BYTES).contains(&settings.max_bytes),
            "Maximum clip size must be between 1 byte and 64 MiB"
        );
        ollama::endpoint(&settings.ollama_url)?;
        ensure!(settings.model.len() <= 256, "Model name is too long");
        let state = app.state::<Desktop>();
        let mut current = state.settings.lock().unwrap();
        write_atomic(
            &state.directory.join("settings.json"),
            &serde_json::to_vec_pretty(&settings)?,
        )?;
        *current = settings;
        Ok(())
    })())?;
    let _ = app.emit("settings-changed", ());
    Ok(())
}

#[tauri::command]
async fn run_ai(app: AppHandle, id: String, action: ollama::Action) -> Command<()> {
    result(ollama::run(&app, &id, action).await)?;
    let _ = app.emit("clips-changed", ());
    Ok(())
}

#[tauri::command]
fn dismiss(window: WebviewWindow) -> Command<()> {
    window.hide().map_err(|error| error.to_string())
}

fn setup(app: &mut tauri::App) -> Result<()> {
    let directory = app.path().app_local_data_dir()?;
    fs::create_dir_all(&directory)?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(directory.join("instance.lock"))?;
    FileExt::try_lock_exclusive(&lock).context("ClipSync is already running")?;
    let settings = match fs::read(directory.join("settings.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).context("Invalid ClipSync settings")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Settings::default(),
        Err(error) => return Err(error.into()),
    };
    let path = directory.join("clips.sqlite");
    let (store, error) = match read_key().and_then(|key| match key {
        Some(key) => Store::open(&path, key).map(Some),
        None if path.exists() => Err(anyhow!(
            "Restore the ClipSync key in the OS keychain to open this vault"
        )),
        None => Ok(None),
    }) {
        Ok(store) => (store, None),
        Err(error) => (None, Some(format!("{error:#}"))),
    };
    let sync = sync::SyncState::load(&directory);
    app.manage(Desktop {
        directory,
        store: Mutex::new(store),
        settings: Mutex::new(settings),
        clipboard: ClipboardState::new()?,
        open_error: Mutex::new(error),
        capture_status: Mutex::new(None),
        paste_target: Mutex::new(0),
        sync,
        _lock: lock,
    });

    let open = MenuItem::with_id(app, "open", "Open ClipSync", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let raw_icon = image::load_from_memory(include_bytes!("../icons/icon.png"))?.into_rgba8();
    let (width, height) = raw_icon.dimensions();
    TrayIconBuilder::new()
        .icon(tauri::image::Image::new_owned(
            raw_icon.into_raw(),
            width,
            height,
        ))
        .tooltip("ClipSync")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    if let Err(error) = app
        .global_shortcut()
        .on_shortcut("Ctrl+Shift+V", |app, _, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            if let Some(popup) = app.get_webview_window("popup") {
                if popup.is_visible().unwrap_or(false) {
                    let _ = popup.hide();
                    return;
                }
                *app.state::<Desktop>().paste_target.lock().unwrap() = platform::foreground();
                let _ = popup.show();
                let _ = popup.set_focus();
            }
        })
    {
        *app.state::<Desktop>().capture_status.lock().unwrap() =
            Some(format!("Could not register Ctrl+Shift+V: {error}"));
    }
    if let Err(error) = capture::start(app.handle()) {
        *app.state::<Desktop>().capture_status.lock().unwrap() = Some(error.to_string());
    }
    sync::start(app.handle());
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| Ok(setup(app)?))
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            status,
            initialize,
            search,
            preview,
            keep,
            remove,
            copy,
            save_settings,
            run_ai,
            dismiss,
            sync::sync_status,
            sync::configure_sync,
            sync::pause_sync
        ])
        .build(tauri::generate_context!())
        .expect("Could not build ClipSync")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Desktop>().clipboard.lock().unwrap().cleanup();
            }
        });
}
