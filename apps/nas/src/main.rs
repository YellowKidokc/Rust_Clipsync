use anyhow::{bail, ensure, Context, Result};
use clip_core::sync::{open_archive_event, valid_id, ArchiveEvent, Event, MAX_ENVELOPE};
use clip_crypto::Key;
use postgres::{config::SslMode, Client};
use postgres_native_tls::MakeTlsConnector;
use reqwest::{blocking::Client as Http, redirect::Policy, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::{self, Read, Write},
    thread,
    time::Duration,
};
use zeroize::Zeroizing;

const SCHEMA: &str = include_str!("schema.sql");

struct Archive {
    db: Client,
    origin: Url,
    account: String,
    key: Key,
}

struct Relay {
    http: Http,
    token: Zeroizing<String>,
    device: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Identity {
    account: String,
    device: String,
    #[serde(default)]
    archive_only: bool,
}

#[derive(Serialize)]
struct Entry {
    seq: i64,
    item: String,
    kind: String,
    device: String,
    op: String,
}

fn secret_file(variable: &str) -> Result<Zeroizing<String>> {
    let path = env::var_os(variable).with_context(|| format!("Set {variable} to a secret file"))?;
    let mut text = Zeroizing::new(String::new());
    fs::File::open(path)?.take(8193).read_to_string(&mut text)?;
    ensure!(text.len() <= 8192, "Secret file is too large");
    Ok(text)
}

fn origin(value: &str) -> Result<Url> {
    let url = Url::parse(value).context("Invalid relay origin")?;
    let local = url.domain() == Some("localhost")
        || url.host_str().is_some_and(|host| {
            host.trim_matches(['[', ']'])
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
        });
    ensure!(
        (url.scheme() == "https" || (url.scheme() == "http" && local))
            && url.host().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.path() == "/"
            && url.query().is_none()
            && url.fragment().is_none(),
        "Use an HTTPS relay origin or HTTP loopback for local testing"
    );
    Ok(url)
}

impl Archive {
    fn connect() -> Result<Self> {
        let origin =
            origin(&env::var("CLIPSYNC_RELAY_ORIGIN").context("Set CLIPSYNC_RELAY_ORIGIN")?)?;
        let shared = secret_file("CLIPSYNC_SYNC_KEY_FILE")?;
        let mut key = Zeroizing::new([0; 32]);
        let value = shared
            .trim()
            .strip_prefix("cskey_")
            .context("Invalid ClipSync shared key")?;
        hex::decode_to_slice(value, key.as_mut()).context("Invalid ClipSync shared key")?;
        let mut hash = Sha256::new();
        hash.update(b"clipsync-account-v1:");
        hash.update(key.as_ref());
        let account = hex::encode(hash.finalize());

        let dsn = secret_file("CLIPSYNC_DATABASE_URL_FILE")?;
        let mut config: postgres::Config = dsn
            .trim()
            .parse()
            .map_err(|_| anyhow::anyhow!("Invalid PostgreSQL connection string"))?;
        let allow_plaintext = env::var("CLIPSYNC_ALLOW_PLAINTEXT_DB").as_deref() == Ok("1");
        config.ssl_mode(if allow_plaintext {
            SslMode::Disable
        } else {
            SslMode::Require
        });
        config.connect_timeout(Duration::from_secs(10));
        let tls = MakeTlsConnector::new(native_tls::TlsConnector::new()?);
        let mut db = config
            .connect(tls)
            .map_err(|_| anyhow::anyhow!("Could not connect to PostgreSQL"))?;
        let mut tx = db.transaction()?;
        // Serialize first-time schema creation across multiple copies of the service.
        tx.query_one("SELECT pg_advisory_xact_lock(736819401)", &[])?;
        tx.batch_execute(SCHEMA)?;
        tx.execute(
            "INSERT INTO clipsync_archive.archive_identity (id, origin, account) VALUES (1, $1, $2) ON CONFLICT DO NOTHING",
            &[&origin.as_str(), &account],
        )?;
        let binding = tx.query_one(
            "SELECT origin, account FROM clipsync_archive.archive_identity WHERE id = 1",
            &[],
        )?;
        ensure!(
            binding.get::<_, &str>(0) == origin.as_str() && binding.get::<_, &str>(1) == account,
            "This PostgreSQL archive belongs to a different relay or sync account"
        );
        tx.commit()?;
        Ok(Self {
            db,
            origin,
            account,
            key,
        })
    }

    fn cursor(&mut self) -> Result<i64> {
        Ok(self
            .db
            .query_one(
                "SELECT coalesce(max(seq), 0) FROM clipsync_archive.events",
                &[],
            )?
            .get(0))
    }

    fn save(&mut self, event: &Event, body: &[u8]) -> Result<()> {
        let decoded = open_archive_event(&self.key, &self.account, event, body)?;
        let (item, kind) = match &decoded {
            ArchiveEvent::Snapshot(clip) => (clip.item.id.as_str(), "snapshot"),
            ArchiveEvent::Delete(id) => (id.as_str(), "delete"),
        };
        self.db.execute(
            "INSERT INTO clipsync_archive.events (seq, device, op, item, kind, body)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (seq) DO NOTHING",
            &[&event.seq, &event.device, &event.op, &item, &kind, &body],
        )?;
        Ok(())
    }

    fn history(&mut self, after: i64, item: Option<&str>) -> Result<()> {
        let rows = self.db.query(
            "SELECT seq, item, kind, device, op FROM clipsync_archive.events
             WHERE seq > $1 AND ($2::text IS NULL OR item = $2) ORDER BY seq LIMIT 100",
            &[&after, &item],
        )?;
        let mut stdout = io::BufWriter::new(io::stdout().lock());
        for row in rows {
            serde_json::to_writer(
                &mut stdout,
                &Entry {
                    seq: row.get(0),
                    item: row.get(1),
                    kind: row.get(2),
                    device: row.get(3),
                    op: row.get(4),
                },
            )?;
            writeln!(stdout)?;
        }
        stdout.flush()?;
        Ok(())
    }

    fn export(&mut self, seq: i64) -> Result<()> {
        let row = self
            .db
            .query_opt(
                "SELECT device, op, body FROM clipsync_archive.events WHERE seq = $1",
                &[&seq],
            )?
            .context("Archive sequence not found")?;
        let body: Vec<u8> = row.get(2);
        let event = Event {
            seq,
            device: row.get(0),
            op: row.get(1),
            size: body.len(),
        };
        let payload = open_archive_event(&self.key, &self.account, &event, &body)?;
        let mut stdout = io::BufWriter::new(io::stdout().lock());
        serde_json::to_writer(&mut stdout, &payload)?;
        writeln!(stdout)?;
        stdout.flush()?;
        Ok(())
    }
}

impl Relay {
    fn new(archive: &Archive) -> Result<Self> {
        let file = secret_file("CLIPSYNC_DEVICE_TOKEN_FILE")?;
        let token = Zeroizing::new(file.trim().to_owned());
        ensure!(
            token.strip_prefix("csdev_").is_some_and(|s| {
                s.len() == 64
                    && s.bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            }),
            "Invalid ClipSync NAS device token"
        );
        let http = Http::builder()
            .redirect(Policy::none())
            .no_proxy()
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(90))
            .build()?;
        let response = http
            .get(archive.origin.join("/v1/session")?)
            .bearer_auth(token.as_str())
            .send()?;
        let identity: Identity = parse(response, 2048)?;
        ensure!(
            identity.archive_only
                && identity.account == archive.account
                && valid_id(&identity.device),
            "The relay must return a read-only device for this sync account"
        );
        Ok(Self {
            http,
            token,
            device: identity.device,
        })
    }

    fn pull(&self, archive: &mut Archive) -> Result<()> {
        let mut cursor = archive.cursor()?;
        loop {
            let mut page = archive.origin.join("/v1/events")?;
            page.query_pairs_mut()
                .append_pair("after", &cursor.to_string());
            let response = self
                .http
                .get(page)
                .bearer_auth(self.token.as_str())
                .send()?;
            let events: Vec<Event> = parse(response, 16_384)?;
            ensure!(events.len() <= 50, "Invalid relay page");
            if events.is_empty() {
                return Ok(());
            }
            for event in events {
                ensure!(
                    event.seq > cursor
                        && valid_id(&event.device)
                        && valid_id(&event.op)
                        && (41..=MAX_ENVELOPE).contains(&event.size),
                    "Invalid relay event"
                );
                let path = archive
                    .origin
                    .join(&format!("/v1/events/{}/{}", event.device, event.op))?;
                let response = self
                    .http
                    .get(path)
                    .bearer_auth(self.token.as_str())
                    .send()?;
                let body = bounded(response, event.size)?;
                archive
                    .save(&event, &body)
                    .with_context(|| format!("Could not archive relay sequence {}", event.seq))?;
                cursor = event.seq;
            }
        }
    }
}

fn bounded(response: reqwest::blocking::Response, limit: usize) -> Result<Vec<u8>> {
    let mut data = Vec::new();
    response
        .error_for_status()?
        .take((limit + 1) as u64)
        .read_to_end(&mut data)?;
    ensure!(data.len() <= limit, "Relay sent an oversized response");
    Ok(data)
}

fn parse<T: DeserializeOwned>(response: reqwest::blocking::Response, limit: usize) -> Result<T> {
    Ok(serde_json::from_slice(&bounded(response, limit)?)?)
}

fn sync_loop() -> Result<()> {
    let mut delay = 5;
    let mut connection = None;
    loop {
        let result = (|| {
            if connection.is_none() {
                let archive = Archive::connect()?;
                let relay = Relay::new(&archive)?;
                eprintln!("Archive device {} connected", relay.device);
                connection = Some((archive, relay));
            }
            let (archive, relay) = connection
                .as_mut()
                .context("Archive connection unavailable")?;
            relay.pull(archive)
        })();
        match result {
            Ok(()) => delay = 5,
            Err(error) => {
                eprintln!("Archive sync will retry: {error}");
                connection = None;
                delay = (delay * 2).min(60);
            }
        }
        thread::sleep(Duration::from_secs(delay));
    }
}

fn run() -> Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.as_slice() {
        [] => sync_loop(),
        [command] if command == "run" => sync_loop(),
        [command] if command == "once" => {
            let mut archive = Archive::connect()?;
            Relay::new(&archive)?.pull(&mut archive)
        }
        [command] if command == "status" => {
            let mut archive = Archive::connect()?;
            let row = archive.db.query_one(
                "SELECT count(*), coalesce(max(seq),0) FROM clipsync_archive.events", &[],
            )?;
            println!("Archived events: {}. Last relay sequence: {}.", row.get::<_, i64>(0), row.get::<_, i64>(1));
            Ok(())
        }
        [command] if command == "history" => Archive::connect()?.history(0, None),
        [command, after] if command == "history" => Archive::connect()?.history(after.parse()?, None),
        [command, after, item] if command == "history" && valid_id(item) => {
            Archive::connect()?.history(after.parse()?, Some(item))
        }
        [command, seq] if command == "export" => Archive::connect()?.export(seq.parse()?),
        _ => bail!("Usage: clipsync-nas [run | once | status | history [after [item]] | export <sequence>]"),
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}
