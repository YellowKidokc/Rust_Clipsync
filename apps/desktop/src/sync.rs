use crate::{result, with_store, write_atomic, Command, Desktop};
use anyhow::{ensure, Context, Result};
use clip_core::sync::{valid_id, Event, MAX_ENVELOPE};
use clip_crypto::Key;
use futures_util::StreamExt;
use reqwest::{redirect::Policy, Client, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{Mutex as AsyncMutex, Notify};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue},
};
use zeroize::Zeroizing;

#[derive(Clone, Deserialize, Serialize)]
struct Config {
    url: String,
    account: String,
    device: String,
    paused: bool,
}

#[derive(Clone)]
struct Session {
    config: Config,
    key: Key,
    token: Zeroizing<String>,
}

#[derive(Deserialize)]
struct Identity {
    account: String,
    device: String,
}

#[derive(Deserialize)]
struct Receipt {
    seq: i64,
}

#[derive(Serialize)]
pub struct Status {
    connected: bool,
    paused: bool,
    error: Option<String>,
}

pub struct SyncState {
    session: Mutex<Option<Session>>,
    error: Mutex<Option<String>>,
    configure: AsyncMutex<()>,
    wake: Notify,
}

fn config_file(directory: &Path) -> PathBuf {
    directory.join("sync.json")
}

fn parse_url(origin: &str) -> Result<Url> {
    let url = Url::parse(origin).context("Enter a valid relay origin")?;
    let loopback = match url.host() {
        Some(url::Host::Domain("localhost")) => true,
        Some(url::Host::Ipv4(host)) => host.is_loopback(),
        Some(url::Host::Ipv6(host)) => host.is_loopback(),
        _ => false,
    };
    ensure!(
        url.host().is_some()
            && (url.scheme() == "https" || (url.scheme() == "http" && loopback))
            && url.username().is_empty()
            && url.password().is_none()
            && url.path() == "/"
            && url.query().is_none()
            && url.fragment().is_none(),
        "Use an HTTPS relay origin, or HTTP on loopback for local testing"
    );
    Ok(url)
}

fn client() -> Result<Client> {
    Ok(Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(60))
        .build()?)
}

fn parse_key(value: &str) -> Result<Key> {
    let mut key = Zeroizing::new([0; 32]);
    let hex_key = value
        .strip_prefix("cskey_")
        .context("Enter a ClipSync shared key")?;
    hex::decode_to_slice(hex_key, key.as_mut()).context("Invalid ClipSync shared key")?;
    Ok(key)
}

fn account(key: &Key) -> String {
    let mut digest = Sha256::new();
    digest.update(b"clipsync-account-v1:");
    digest.update(key.as_ref());
    hex::encode(digest.finalize())
}

fn valid_token(token: &str) -> bool {
    token.strip_prefix("csdev_").is_some_and(|key| {
        key.len() == 64
            && key
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

impl Config {
    fn binding(&self) -> String {
        format!("{}/{}/{}", self.url, self.account, self.device)
    }

    fn keychain(&self) -> Result<keyring::Entry> {
        let id = hex::encode(Sha256::digest(self.binding()));
        Ok(keyring::Entry::new(
            "com.clipsync.desktop",
            &format!("sync-{id}"),
        )?)
    }
}

impl Session {
    fn load(directory: &Path) -> Result<Option<Self>> {
        let path = config_file(directory);
        let data = match std::fs::read(path) {
            Ok(data) => data,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let config: Config = serde_json::from_slice(&data)?;
        ensure!(
            parse_url(&config.url)?.as_str() == config.url && valid_id(&config.device),
            "Invalid sync settings"
        );
        let credentials = Zeroizing::new(
            config
                .keychain()?
                .get_password()
                .context("Sync credentials unavailable in the OS keychain")?,
        );
        let (key, token) = credentials
            .split_once(':')
            .context("Invalid sync credentials")?;
        let key = parse_key(key)?;
        ensure!(
            account(&key) == config.account && valid_token(token),
            "Invalid sync credentials"
        );
        Ok(Some(Self {
            config,
            key,
            token: Zeroizing::new(token.to_owned()),
        }))
    }

    fn url(&self, path: &str) -> Result<Url> {
        Ok(parse_url(&self.config.url)?.join(path)?)
    }
}

impl SyncState {
    pub fn load(directory: &Path) -> Self {
        let (session, error) = match Session::load(directory) {
            Ok(session) => (session, None),
            Err(error) => (None, Some(error.to_string())),
        };
        Self {
            session: Mutex::new(session),
            error: Mutex::new(error),
            configure: AsyncMutex::new(()),
            wake: Notify::new(),
        }
    }

    fn set_error(&self, app: &AppHandle, value: Option<String>) {
        let mut current = self.error.lock().unwrap();
        if *current != value {
            *current = value;
            let _ = app.emit("sync-changed", ());
        }
    }
}

#[tauri::command]
pub fn sync_status(state: State<'_, Desktop>) -> Status {
    let session = state.sync.session.lock().unwrap();
    Status {
        connected: session.is_some(),
        paused: session
            .as_ref()
            .is_some_and(|session| session.config.paused),
        error: state.sync.error.lock().unwrap().clone(),
    }
}

#[tauri::command]
pub async fn configure_sync(
    app: AppHandle,
    origin: String,
    sync_key: String,
    token: String,
) -> Command<()> {
    let sync_key = Zeroizing::new(sync_key);
    let token = Zeroizing::new(token);
    result(configure(&app, &origin, &sync_key, token).await)
}

async fn configure(
    app: &AppHandle,
    origin: &str,
    sync_key: &str,
    token: Zeroizing<String>,
) -> Result<()> {
    let state = app.state::<Desktop>();
    let _guard = state.sync.configure.lock().await;
    let origin = parse_url(origin.trim())?;
    let key = parse_key(sync_key.trim())?;
    ensure!(valid_token(&token), "Enter this device's ClipSync token");
    let response = client()?
        .get(origin.join("/v1/session")?)
        .bearer_auth(token.as_str())
        .send()
        .await
        .context("Could not contact the relay")?;
    ensure!(
        response.status().is_success(),
        "Relay refused this device token"
    );
    let body = bounded(response, 2048).await?;
    let identity: Identity = serde_json::from_slice(&body)?;
    ensure!(
        identity.account == account(&key) && valid_id(&identity.device),
        "This token and sync key belong to different accounts"
    );
    let config = Config {
        url: origin.to_string(),
        account: identity.account,
        device: identity.device,
        paused: false,
    };
    let id = config.binding();
    let app_copy = app.clone();
    let key_pair = Zeroizing::new(format!(
        "cskey_{}:{}",
        hex::encode(key.as_ref()),
        token.as_str()
    ));
    let config_copy = config.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<()> {
        let state = app_copy.state::<Desktop>();
        config_copy
            .keychain()?
            .set_password(&key_pair)
            .context("Could not save sync credentials in the OS keychain")?;
        with_store(&state, |store| store.bind_sync(&id))?;
        write_atomic(
            &config_file(&state.directory),
            &serde_json::to_vec_pretty(&config_copy)?,
        )
    })
    .await??;
    *state.sync.session.lock().unwrap() = Some(Session { config, key, token });
    state.sync.set_error(app, None);
    state.sync.wake.notify_one();
    let _ = app.emit("sync-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn pause_sync(app: AppHandle, paused: bool) -> Command<()> {
    let state = app.state::<Desktop>();
    let _guard = state.sync.configure.lock().await;
    result((|| {
        let mut session = state.sync.session.lock().unwrap();
        let current = session.as_mut().context("Configure sync first")?;
        let mut config = current.config.clone();
        config.paused = paused;
        write_atomic(
            &config_file(&state.directory),
            &serde_json::to_vec_pretty(&config)?,
        )?;
        current.config = config;
        state.sync.wake.notify_one();
        let _ = app.emit("sync-changed", ());
        Ok(())
    })())
}

async fn bounded(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        ensure!(
            chunk.len() <= limit.saturating_sub(bytes.len()),
            "Relay response exceeds its size limit"
        );
        bytes.extend(chunk);
    }
    Ok(bytes)
}

async fn cycle(app: &AppHandle, client: &Client, session: &Session) -> Result<()> {
    let state = app.state::<Desktop>();
    let Config {
        account, device, ..
    } = &session.config;
    let binding = session.config.binding();
    let cursor = with_store(&state, |store| {
        store.verify_sync_binding(&binding)?;
        store.sync_cursor()
    })?;

    for _ in 0..25 {
        let upload = with_store(&state, |store| {
            store.next_upload(&session.key, account, device)
        })?;
        let Some((op, body)) = upload else { break };
        if !active(&state, session) {
            return Ok(());
        }
        let response = client
            .put(session.url(&format!("/v1/events/{op}"))?)
            .bearer_auth(session.token.as_str())
            .header("Content-Type", "application/octet-stream")
            .body(body)
            .send()
            .await?
            .error_for_status()?;
        let receipt: Receipt = serde_json::from_slice(&bounded(response, 1024).await?)?;
        ensure!(receipt.seq > 0, "Invalid relay upload receipt");
        with_store(&state, |store| store.acknowledge_upload(&op))?;
    }

    if !active(&state, session) {
        return Ok(());
    }
    let mut url = session.url("/v1/events")?;
    url.query_pairs_mut()
        .append_pair("after", &cursor.to_string());
    let response = client
        .get(url)
        .bearer_auth(session.token.as_str())
        .send()
        .await?
        .error_for_status()?;
    let events: Vec<Event> = serde_json::from_slice(&bounded(response, 16_384).await?)?;
    ensure!(events.len() <= 50, "Invalid relay page");
    let mut previous = cursor;
    for event in events {
        ensure!(
            event.seq > previous
                && valid_id(&event.device)
                && valid_id(&event.op)
                && (41..=MAX_ENVELOPE).contains(&event.size),
            "Invalid relay event"
        );
        previous = event.seq;
        if !active(&state, session) {
            return Ok(());
        }
        let response = client
            .get(session.url(&format!("/v1/events/{}/{}", event.device, event.op))?)
            .bearer_auth(session.token.as_str())
            .send()
            .await?
            .error_for_status()?;
        let body = bounded(response, event.size).await?;
        if !active(&state, session) {
            return Ok(());
        }
        if with_store(&state, |store| {
            store.receive(&session.key, account, &event, &body)
        })? {
            let _ = app.emit("clips-changed", ());
        }
    }
    Ok(())
}

fn active(state: &Desktop, session: &Session) -> bool {
    state
        .sync
        .session
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|current| {
            !current.config.paused
                && current.config.binding() == session.config.binding()
                && current.token.as_str() == session.token.as_str()
        })
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<Desktop>();
        let Ok(client) = client() else {
            state
                .sync
                .set_error(&app, Some("Could not initialize relay networking".into()));
            return;
        };
        loop {
            let session = state.sync.session.lock().unwrap().clone();
            match session.filter(|session| !session.config.paused) {
                Some(session) => live(&app, &client, &session).await,
                None => state.sync.wake.notified().await,
            }
        }
    });
}

async fn live(app: &AppHandle, client: &Client, session: &Session) {
    let state = app.state::<Desktop>();
    let socket = async {
        let mut url = session.url("/v1/live")?;
        let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
        url.set_scheme(scheme)
            .map_err(|()| anyhow::anyhow!("Invalid live relay URL"))?;
        let mut request = url.as_str().into_client_request()?;
        let mut value = HeaderValue::from_str(&format!("Bearer {}", session.token.as_str()))?;
        value.set_sensitive(true);
        request.headers_mut().insert("Authorization", value);
        let (socket, _) = connect_async(request).await?;
        Ok::<_, anyhow::Error>(socket)
    };
    let mut socket = tokio::select! {
        biased;
        () = state.sync.wake.notified() => return,
        result = tokio::time::timeout(Duration::from_secs(2), socket) => result.ok().and_then(Result::ok),
    };
    let mut failures = 0u32;
    while active(&state, session) {
        let outcome = cycle(app, client, session).await;
        let delay = match outcome {
            Ok(()) => {
                failures = 0;
                state.sync.set_error(app, None);
                Duration::from_secs(3)
            }
            Err(error) => {
                failures = (failures + 1).min(4);
                state
                    .sync
                    .set_error(app, Some(format!("Sync will retry. {error}")));
                Duration::from_secs(2u64.pow(failures))
            }
        };
        tokio::select! {
            biased;
            () = state.sync.wake.notified() => return,
            () = tokio::time::sleep(delay) => {
                if socket.is_none() && failures == 0 {
                    return;
                }
            }
            message = async { socket.as_mut().unwrap().next().await }, if socket.is_some() && failures == 0 => {
                if let Some(Ok(message)) = message {
                    if message.is_close() { socket = None; }
                } else {
                    socket = None;
                }
            }
        }
    }
}
