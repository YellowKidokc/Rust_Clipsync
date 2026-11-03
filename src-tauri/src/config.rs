use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    /// Optional. When sync_enabled and this is set, new clips are also pushed to {api_url}/clips/push.
    /// The app works fully without it.
    pub api_url: String,
    pub sync_enabled: bool,
    /// Clip history size (pinned clips are always kept).
    pub max_clips: i64,
    pub device_id: String,
    pub capture_enabled: bool,
    pub hotkey: String,
    pub autostart: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            api_url: String::new(),
            sync_enabled: false,
            max_clips: 1000,
            device_id: format!("desktop-{}", std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "pc".into()).to_lowercase()),
            capture_enabled: true,
            hotkey: "ctrl+shift+space".into(),
            autostart: true,
        }
    }
}

/// Partial update sent from the front end (Settings view).
#[derive(Deserialize, Default)]
pub struct ConfigPatch {
    pub api_url: Option<String>,
    pub sync_enabled: Option<bool>,
    pub max_clips: Option<i64>,
    pub device_id: Option<String>,
    pub capture_enabled: Option<bool>,
    pub hotkey: Option<String>,
    pub autostart: Option<bool>,
}

impl Config {
    pub fn load(path: &PathBuf) -> Self {
        fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }
    pub fn save(&self, path: &PathBuf) {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::write(path, serde_json::to_string_pretty(self).unwrap_or_default());
    }
    pub fn apply(&mut self, p: ConfigPatch) {
        if let Some(v) = p.api_url { self.api_url = if v.trim().is_empty() { String::new() } else { normalize_api(&v) }; }
        if let Some(v) = p.sync_enabled { self.sync_enabled = v; }
        if let Some(v) = p.max_clips { self.max_clips = v.clamp(10, 100_000); }
        if let Some(v) = p.device_id { if !v.trim().is_empty() { self.device_id = v; } }
        if let Some(v) = p.capture_enabled { self.capture_enabled = v; }
        if let Some(v) = p.hotkey { self.hotkey = v; }
        if let Some(v) = p.autostart { self.autostart = v; }
    }
}

pub fn normalize_api(raw: &str) -> String {
    let t = raw.trim().trim_end_matches('/');
    if t.ends_with("/api") { t.to_string() } else { format!("{t}/api") }
}
