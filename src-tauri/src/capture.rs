//! Clipboard watcher: polls the clipboard, masks secrets, saves new text to the local store.
//! Only if sync is turned on in Settings is it also pushed to an API; failed pushes are queued.
use crate::{secrets, store::Store, State};
use serde_json::json;
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::PathBuf,
    sync::Arc,
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter};

const POLL: Duration = Duration::from_millis(500);
const MAX_LEN: usize = 200_000; // bigger pastes are skipped; they belong in uploads, not clips
const MAX_QUEUE: usize = 500;

pub fn hash(s: &str) -> u64 {
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

pub fn spawn(app: AppHandle, state: Arc<State>, store: Arc<Store>, queue_path: PathBuf) {
    thread::spawn(move || {
        let mut clipboard = match arboard::Clipboard::new() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("clipboard unavailable: {e}");
                return;
            }
        };
        let mut queue: Vec<serde_json::Value> = fs::read_to_string(&queue_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        // Don't capture whatever was already on the clipboard at startup.
        if let Ok(t) = clipboard.get_text() {
            *state.last_hash.lock().unwrap() = hash(&t);
        }
        let mut ticks: u32 = 0;
        loop {
            thread::sleep(POLL);
            ticks = ticks.wrapping_add(1);
            let cfg = state.config.lock().unwrap().clone();

            let mut captured = false;
            if let Ok(text) = clipboard.get_text() {
                let h = hash(&text);
                let mut last = state.last_hash.lock().unwrap();
                if h != *last {
                    *last = h;
                    drop(last);
                    if cfg.capture_enabled && !text.trim().is_empty() && text.len() <= MAX_LEN {
                        let m = secrets::mask(&text);
                        if let Err(e) = store.add_clip(&m.text, !m.found.is_empty(), cfg.max_clips) {
                            eprintln!("store: {e}");
                        }
                        if cfg.sync_enabled && !cfg.api_url.is_empty() {
                        queue.push(json!({
                            "content": m.text,
                            "device_id": cfg.device_id,
                            "device_type": std::env::consts::OS,
                            "metadata": { "masked": !m.found.is_empty(), "secrets": m.found, "source": "desktop" },
                            "captured_at": now_ms(),
                        }));
                        if queue.len() > MAX_QUEUE {
                            queue.drain(..queue.len() - MAX_QUEUE);
                        }
                        }
                        captured = true;
                        let _ = app.emit("clip-captured", ());
                    }
                }
            }

            // Flush right after a capture, otherwise retry every ~15s.
            if !queue.is_empty() && cfg.sync_enabled && !cfg.api_url.is_empty() && (captured || ticks % 30 == 0) {
                flush(&cfg.api_url, &mut queue);
                let _ = fs::write(&queue_path, serde_json::to_string(&queue).unwrap_or_default());
            }
        }
    });
}

fn flush(api: &str, queue: &mut Vec<serde_json::Value>) {
    let url = format!("{api}/clips/push");
    while let Some(item) = queue.first() {
        match ureq::post(&url).timeout(Duration::from_secs(8)).send_json(item.clone()) {
            Ok(_) => {
                queue.remove(0);
            }
            // 4xx other than 429: the Worker rejected this clip; drop it rather than block the queue.
            Err(ureq::Error::Status(code, _)) if (400..500).contains(&code) && code != 429 => {
                eprintln!("clip rejected: HTTP {code}");
                queue.remove(0);
            }
            Err(_) => break, // offline: keep for later
        }
    }
}

fn now_ms() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}
