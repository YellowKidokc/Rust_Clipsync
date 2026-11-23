use crate::{platform, Desktop};
use anyhow::{anyhow, ensure, Result};
use clip_core::Content;
use clipboard_rs::{
    common::RustImage, Clipboard, ClipboardContext, ClipboardHandler, ClipboardWatcher,
    ClipboardWatcherContext, ContentFormat, RustImageData,
};
use enigo::{Direction, Enigo, Key, Keyboard, Settings as InputSettings};
use image::{DynamicImage, RgbaImage};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tempfile::TempDir;

#[derive(PartialEq)]
enum Snapshot {
    Text(String),
    Image {
        width: usize,
        height: usize,
        rgba: Vec<u8>,
    },
    Files(Vec<PathBuf>),
}

impl Snapshot {
    fn fingerprint(&self) -> [u8; 32] {
        let mut digest = Sha256::new();
        match self {
            Self::Text(text) => {
                digest.update([0]);
                digest.update(text.as_bytes());
            }
            Self::Image {
                width,
                height,
                rgba,
            } => {
                digest.update([1]);
                digest.update(width.to_le_bytes());
                digest.update(height.to_le_bytes());
                digest.update(rgba);
            }
            Self::Files(paths) => {
                digest.update([2]);
                for path in paths {
                    let name = path.as_os_str().as_encoded_bytes();
                    digest.update(name.len().to_le_bytes());
                    digest.update(name);
                }
            }
        }
        digest.finalize().into()
    }

    fn read(self, max_size: usize) -> Result<Content> {
        Ok(match self {
            Self::Text(text) => {
                ensure!(text.len() <= max_size, "Text exceeds capture limit");
                Content::Text(text)
            }
            Self::Image {
                width,
                height,
                rgba,
            } => Content::Image {
                width,
                height,
                rgba,
            },
            Self::Files(paths) => {
                let mut files = Vec::new();
                let mut remaining = max_size;
                for path in paths {
                    let metadata = fs::symlink_metadata(&path)?;
                    ensure!(metadata.is_file(), "Only regular files can be captured");
                    ensure!(
                        metadata.len() <= remaining as u64,
                        "Files exceed capture limit"
                    );
                    let name = path
                        .file_name()
                        .ok_or_else(|| anyhow!("Missing file name"))?;
                    let file = File::open(&path)?;
                    let mut bytes = Vec::new();
                    file.take(remaining as u64 + 1).read_to_end(&mut bytes)?;
                    ensure!(bytes.len() <= remaining, "Files exceed capture limit");
                    remaining -= bytes.len();
                    files.push((name.to_string_lossy().into_owned(), bytes));
                }
                Content::Files(files)
            }
        })
    }
}

fn snapshot(context: &ClipboardContext, max_size: usize) -> Option<Snapshot> {
    if context.has(ContentFormat::Files) {
        let paths = context
            .get_files()
            .ok()?
            .into_iter()
            .map(|raw| {
                if raw.starts_with("file://") {
                    return url::Url::parse(&raw).ok()?.to_file_path().ok();
                }
                let path = PathBuf::from(raw);
                path.is_absolute().then_some(path)
            })
            .collect::<Option<Vec<_>>>()?;
        return (!paths.is_empty()).then_some(Snapshot::Files(paths));
    }
    if context.has(ContentFormat::Image) {
        let image = context.get_image().ok()?;
        let (width, height) = image.get_size();
        let size = u64::from(width)
            .checked_mul(u64::from(height))?
            .checked_mul(4)?;
        if size > max_size as u64 || size == 0 {
            return None;
        }
        return Some(Snapshot::Image {
            width: width as usize,
            height: height as usize,
            rgba: image.to_rgba8().ok()?.into_raw(),
        });
    }
    let text = context.get_text().ok()?;
    (!text.is_empty() && text.len() <= max_size).then_some(Snapshot::Text(text))
}

struct Secret {
    fingerprint: [u8; 32],
    sequence: Option<u32>,
    deadline: Instant,
}

impl Secret {
    fn new(fingerprint: [u8; 32], sequence: Option<u32>) -> Self {
        Self {
            fingerprint,
            sequence,
            deadline: Instant::now() + Duration::from_secs(30),
        }
    }
}

struct OwnWrite {
    fingerprint: [u8; 32],
    sequence: Option<u32>,
    at: Instant,
}

impl OwnWrite {
    fn matches(&self, fingerprint: [u8; 32], sequence: Option<u32>) -> bool {
        self.fingerprint == fingerprint
            && self.sequence == sequence
            && self.at.elapsed() < Duration::from_secs(2)
    }
}

pub struct ClipboardState {
    context: ClipboardContext,
    own_write: Option<OwnWrite>,
    secret: Option<Secret>,
    files: Vec<TempDir>,
}

impl ClipboardState {
    pub fn new() -> Result<Mutex<Self>> {
        Ok(Mutex::new(Self {
            context: ClipboardContext::new().map_err(|error| anyhow!(error.to_string()))?,
            own_write: None,
            secret: None,
            files: Vec::new(),
        }))
    }

    pub fn cleanup(&mut self) {
        if let Some(secret) = &mut self.secret {
            secret.deadline = Instant::now();
            let _ = self.clear_expired();
        }
        self.files.clear();
    }

    fn clear_expired(&mut self) -> Result<()> {
        let Some(secret) = &self.secret else {
            return Ok(());
        };
        if Instant::now() < secret.deadline {
            return Ok(());
        }
        if let Some(sequence) = secret.sequence {
            platform::clear_if_current(sequence)?;
        } else if snapshot(&self.context, crate::MAX_CLIP_BYTES)
            .is_some_and(|current| current.fingerprint() == secret.fingerprint)
        {
            self.context
                .clear()
                .map_err(|error| anyhow!(error.to_string()))?;
        }
        self.secret = None;
        Ok(())
    }

    pub fn set_for_paste(&mut self, content: Content, is_secret: bool) -> Result<()> {
        let data = match content {
            Content::Text(text) => Snapshot::Text(text),
            Content::Image {
                width,
                height,
                rgba,
            } => Snapshot::Image {
                width,
                height,
                rgba,
            },
            Content::Files(files) => {
                ensure!(
                    !is_secret,
                    "Secret files cannot be restored through the clipboard"
                );
                let directory = tempfile::Builder::new()
                    .prefix("clipsync-paste-")
                    .tempdir()?;
                let mut paths = Vec::with_capacity(files.len());
                for (index, (name, bytes)) in files.into_iter().enumerate() {
                    let basename = Path::new(&name)
                        .file_name()
                        .ok_or_else(|| anyhow!("Invalid file name"))?;
                    let parent = directory.path().join(index.to_string());
                    fs::create_dir(&parent)?;
                    let path = parent.join(basename);
                    fs::write(&path, bytes)?;
                    paths.push(path);
                }
                self.files.push(directory);
                Snapshot::Files(paths)
            }
        };
        let fingerprint = data.fingerprint();
        match data {
            Snapshot::Text(text) => self.context.set_text(text),
            Snapshot::Image {
                width,
                height,
                rgba,
            } => {
                let image = RgbaImage::from_raw(width as u32, height as u32, rgba)
                    .ok_or_else(|| anyhow!("Invalid image"))?;
                self.context
                    .set_image(RustImageData::from_dynamic_image(DynamicImage::ImageRgba8(
                        image,
                    )))
            }
            Snapshot::Files(paths) => {
                #[cfg(target_os = "linux")]
                let paths = paths
                    .iter()
                    .map(|path| {
                        url::Url::from_file_path(path)
                            .map(|uri| uri.to_string())
                            .map_err(|()| anyhow!("Invalid file path"))
                    })
                    .collect::<Result<Vec<_>>>()?;
                #[cfg(not(target_os = "linux"))]
                let paths = paths
                    .iter()
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect();
                self.context.set_files(paths)
            }
        }
        .map_err(|error| anyhow!(error.to_string()))?;
        let sequence = platform::sequence();
        self.own_write = Some(OwnWrite {
            fingerprint,
            sequence,
            at: Instant::now(),
        });
        self.secret = is_secret.then(|| Secret::new(fingerprint, sequence));
        Ok(())
    }
}

struct Notify(mpsc::Sender<Option<String>>);

impl ClipboardHandler for Notify {
    fn on_clipboard_change(&mut self) {
        let _ = self.0.send(platform::source_app());
    }
}

pub fn start(app: &AppHandle) -> Result<()> {
    let (sender, receiver) = mpsc::channel();
    let mut watcher = ClipboardWatcherContext::new_with_interval(Duration::from_millis(75))
        .map_err(|error| anyhow!(error.to_string()))?;
    watcher.add_handler(Notify(sender));
    std::thread::spawn(move || watcher.start_watch());
    let app = app.clone();
    std::thread::spawn(move || loop {
        let state = app.state::<Desktop>();
        {
            let mut clipboard = state.clipboard.lock().unwrap();
            if let Err(error) = clipboard.clear_expired() {
                report(&app, &error);
            }
        };
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(source) => {
                if let Err(error) = ingest(&app, source) {
                    report(&app, &error);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                report(&app, &anyhow!("Clipboard watcher stopped"));
                break;
            }
        }
    });
    Ok(())
}

fn report(app: &AppHandle, error: &anyhow::Error) {
    let status = error.to_string();
    *app.state::<Desktop>().capture_status.lock().unwrap() = Some(status.clone());
    let _ = app.emit("capture-error", status);
}

fn ingest(app: &AppHandle, source: Option<String>) -> Result<()> {
    let state = app.state::<Desktop>();
    let settings = state.settings.lock().unwrap().clone();
    if settings.paused || state.store.lock().unwrap().is_none() {
        return Ok(());
    }
    let mut clipboard = state.clipboard.lock().unwrap();
    let sequence = platform::sequence();
    let Some(data) = snapshot(&clipboard.context, settings.max_bytes) else {
        clipboard.own_write = None;
        return Ok(());
    };
    if sequence != platform::sequence() {
        return Ok(());
    }
    let fingerprint = data.fingerprint();
    if clipboard
        .own_write
        .take()
        .is_some_and(|write| write.matches(fingerprint, sequence))
    {
        return Ok(());
    }
    let content = match data {
        Snapshot::Text(_) if !settings.text => return Ok(()),
        Snapshot::Image { .. } if !settings.images => return Ok(()),
        Snapshot::Files(_) if !settings.files => return Ok(()),
        data => match data.read(settings.max_bytes) {
            Ok(content) => content,
            Err(_) => return Ok(()),
        },
    };
    let concealed = clipboard
        .context
        .available_formats()
        .unwrap_or_default()
        .iter()
        .any(|format| {
            matches!(
                format.as_str(),
                "org.nspasteboard.ConcealedType" | "ExcludeClipboardContentFromMonitorProcessing"
            )
        });
    let secret = concealed || content.is_secret();
    if sequence != platform::sequence() {
        return Ok(());
    }
    if secret {
        clipboard.secret = Some(Secret::new(fingerprint, sequence));
    }
    drop(clipboard);
    if let Some(store) = state.store.lock().unwrap().as_mut() {
        store.add(content, source, secret)?;
        let _ = app.emit("clips-changed", ());
    }
    Ok(())
}

pub fn send_paste() -> Result<()> {
    let mut enigo = Enigo::new(&InputSettings::default())?;
    let modifier = if cfg!(target_os = "macos") {
        Key::Meta
    } else {
        Key::Control
    };
    enigo.key(modifier, Direction::Press)?;
    let paste = enigo.key(Key::Unicode('v'), Direction::Click);
    let release = enigo.key(modifier, Direction::Release);
    paste?;
    release?;
    Ok(())
}
