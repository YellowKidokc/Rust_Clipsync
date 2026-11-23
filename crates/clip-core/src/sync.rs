use super::{Clip, Store};
use anyhow::{ensure, Context, Result};
use bincode::Options;
use clip_crypto::Key;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ulid::Ulid;
use zeroize::Zeroizing;

pub const MAX_ENVELOPE: usize = 66 * 1024 * 1024;

pub(super) const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS sync_state (
    id INTEGER PRIMARY KEY CHECK(id=1), binding TEXT NOT NULL,
    clock INTEGER NOT NULL DEFAULT 0, cursor INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sync_outbox (op TEXT PRIMARY KEY, body BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS sync_versions (
    item TEXT PRIMARY KEY, clocks TEXT NOT NULL, deleted INTEGER NOT NULL
);";

#[derive(Clone, Default, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
struct Stamp(i64, String);

#[derive(Clone, Default, Deserialize, Serialize)]
pub(super) struct Versions {
    kept: Stamp,
    tags: Stamp,
    note: Stamp,
}

#[derive(Default)]
pub(super) struct Fields {
    pub kept: bool,
    pub tags: bool,
    pub note: bool,
}

#[derive(Deserialize, Serialize)]
enum Change {
    Save(Box<Clip>, Versions),
    Delete(String),
}

#[derive(Deserialize, Serialize)]
struct Message {
    clock: i64,
    change: Change,
}

#[derive(Deserialize, Serialize)]
pub struct Event {
    pub seq: i64,
    pub device: String,
    pub op: String,
    pub size: usize,
}

pub fn valid_id(id: &str) -> bool {
    id.parse::<Ulid>()
        .is_ok_and(|value| value.to_string() == id)
}

fn aad(account: &str, device: &str, op: &str) -> String {
    format!("clipsync-relay-v1/{account}/{device}/{op}")
}

fn codecs() -> impl Options {
    bincode::DefaultOptions::new()
        .with_fixint_encoding()
        .with_limit(MAX_ENVELOPE as u64)
}

fn bound(db: &Connection) -> Result<Option<String>> {
    Ok(db
        .query_row("SELECT binding FROM sync_state", [], |row| row.get(0))
        .optional()?)
}

pub(super) fn tracked(db: &Connection, item: &str) -> Result<bool> {
    Ok(db
        .query_row(
            "SELECT 1 FROM sync_versions WHERE item=? AND deleted=0",
            [item],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn read_versions(db: &Connection, id: &str) -> Result<(Versions, bool)> {
    let value = db
        .query_row(
            "SELECT clocks, deleted FROM sync_versions WHERE item=?",
            [id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?)),
        )
        .optional()?;
    match value {
        Some((clocks, deleted)) => Ok((serde_json::from_str(&clocks)?, deleted)),
        None => Ok((Versions::default(), false)),
    }
}

fn write_versions(db: &Connection, id: &str, versions: &Versions, deleted: bool) -> Result<()> {
    db.execute(
        "INSERT OR REPLACE INTO sync_versions VALUES(?,?,?)",
        params![id, serde_json::to_string(versions)?, deleted],
    )?;
    Ok(())
}

fn next_stamp(db: &Connection) -> Result<Stamp> {
    let clock = db.query_row(
        "UPDATE sync_state SET clock=clock+1 WHERE id=1 AND clock<9223372036854775806 RETURNING clock",
        [], |row| row.get(0),
    ).context("Sync clock is exhausted")?;
    Ok(Stamp(clock, Ulid::new().to_string()))
}

fn queue(db: &Connection, key: &Key, stamp: Stamp, change: Change) -> Result<()> {
    let bytes = Zeroizing::new(codecs().serialize(&Message {
        clock: stamp.0,
        change,
    })?);
    ensure!(
        bytes.len() <= MAX_ENVELOPE - 41,
        "Clip exceeds the encrypted sync size limit"
    );
    let encrypted = clip_crypto::seal(key, stamp.1.as_bytes(), &bytes)?;
    db.execute(
        "INSERT INTO sync_outbox VALUES(?,?)",
        params![stamp.1, encrypted],
    )?;
    Ok(())
}

pub(super) fn record_save(db: &Connection, key: &Key, clip: &Clip, fields: Fields) -> Result<()> {
    if clip.item.is_secret || bound(db)?.is_none() {
        return Ok(());
    }
    let id = &clip.item.id;
    let (mut versions, deleted) = read_versions(db, id)?;
    ensure!(!deleted, "Cannot modify a deleted clip");
    let stamp = next_stamp(db)?;
    if fields.kept {
        versions.kept = stamp.clone();
    }
    if fields.tags {
        versions.tags = stamp.clone();
    }
    if fields.note {
        versions.note = stamp.clone();
    }
    write_versions(db, id, &versions, false)?;
    queue(
        db,
        key,
        stamp,
        Change::Save(Box::new(clip.clone()), versions),
    )
}

pub(super) fn record_delete(db: &Connection, key: &Key, id: &str) -> Result<()> {
    if tracked(db, id)? {
        let stamp = next_stamp(db)?;
        write_versions(db, id, &Versions::default(), true)?;
        queue(db, key, stamp, Change::Delete(id.into()))?;
    }
    Ok(())
}

impl Store {
    pub fn verify_sync_binding(&self, binding: &str) -> Result<()> {
        ensure!(
            bound(&self.db)?.as_deref() == Some(binding),
            "This sync session belongs to a different vault"
        );
        Ok(())
    }

    pub fn bind_sync(&mut self, binding: &str) -> Result<()> {
        if bound(&self.db)?.is_some() {
            return self.verify_sync_binding(binding);
        }
        let disk = self.db.transaction()?;
        disk.execute("INSERT INTO sync_state (id,binding) VALUES(1,?)", [binding])?;
        {
            let mut stmt = disk.prepare("SELECT id,body FROM clips")?;
            let mut rows = stmt.query([])?;
            while let Some(row) = rows.next()? {
                let id: String = row.get(0)?;
                let envelope: Vec<u8> = row.get(1)?;
                let bytes = Zeroizing::new(clip_crypto::open(&self.key, id.as_bytes(), &envelope)?);
                let clip: Clip = bincode::deserialize(&bytes)?;
                record_save(
                    &disk,
                    &self.key,
                    &clip,
                    Fields {
                        kept: true,
                        tags: true,
                        note: true,
                    },
                )?;
            }
        }
        disk.commit()?;
        Ok(())
    }

    pub fn sync_cursor(&self) -> Result<i64> {
        Ok(self
            .db
            .query_row("SELECT cursor FROM sync_state", [], |row| row.get(0))?)
    }

    pub fn next_upload(
        &self,
        key: &Key,
        account: &str,
        device: &str,
    ) -> Result<Option<(String, Vec<u8>)>> {
        let pending = self
            .db
            .query_row(
                "SELECT op,body FROM sync_outbox ORDER BY rowid LIMIT 1",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?)),
            )
            .optional()?;
        pending
            .map(|(op, body)| {
                let plaintext = Zeroizing::new(clip_crypto::open(&self.key, op.as_bytes(), &body)?);
                let envelope =
                    clip_crypto::seal(key, aad(account, device, &op).as_bytes(), &plaintext)?;
                Ok((op, envelope))
            })
            .transpose()
    }

    pub fn acknowledge_upload(&mut self, op: &str) -> Result<()> {
        self.db
            .execute("DELETE FROM sync_outbox WHERE op=?", [op])?;
        Ok(())
    }

    pub fn receive(
        &mut self,
        key: &Key,
        account: &str,
        event: &Event,
        body: &[u8],
    ) -> Result<bool> {
        ensure!(
            event.seq > 0 && valid_id(&event.device) && valid_id(&event.op),
            "Invalid relay event"
        );
        ensure!(
            (41..=MAX_ENVELOPE).contains(&body.len()) && body.len() == event.size,
            "Invalid relay payload size"
        );
        if event.seq <= self.sync_cursor()? {
            return Ok(false);
        }
        let bytes = Zeroizing::new(clip_crypto::open(
            key,
            aad(account, &event.device, &event.op).as_bytes(),
            body,
        )?);
        let message: Message = codecs().deserialize(&bytes)?;
        ensure!(
            (1..i64::MAX - 1).contains(&message.clock),
            "Invalid sync clock"
        );
        let disk = self.db.transaction()?;
        let memory = self.index.transaction()?;
        let changed = match message.change {
            Change::Delete(id) => {
                ensure!(valid_id(&id), "Invalid clip ID");
                let changed = tracked(&disk, &id)?;
                if changed {
                    disk.execute("DELETE FROM clips WHERE id=?", [&id])?;
                    Self::unindex(&memory, &id)?;
                }
                write_versions(&disk, &id, &Versions::default(), true)?;
                changed
            }
            Change::Save(mut incoming, versions) => {
                let id = incoming.item.id.clone();
                ensure!(
                    valid_id(&id) && incoming.item.kind == incoming.content.kind(),
                    "Invalid clip"
                );
                ensure!(
                    !incoming.item.is_secret && !incoming.content.is_secret(),
                    "Secret clip rejected"
                );
                ensure!(
                    [&versions.kept, &versions.tags, &versions.note]
                        .into_iter()
                        .all(|stamp| {
                            (stamp.0 == 0 && stamp.1.is_empty())
                                || ((1..=message.clock).contains(&stamp.0) && valid_id(&stamp.1))
                        }),
                    "Invalid clip version"
                );
                let (mut local, deleted) = read_versions(&disk, &id)?;
                if deleted {
                    false
                } else {
                    let current: Option<Vec<u8>> = disk
                        .query_row("SELECT body FROM clips WHERE id=?", [&id], |row| row.get(0))
                        .optional()?;
                    if let Some(current) = current {
                        let clear =
                            Zeroizing::new(clip_crypto::open(&self.key, id.as_bytes(), &current)?);
                        let mut clip: Clip = bincode::deserialize(&clear)?;
                        ensure!(!clip.item.is_secret, "Local secret clip is protected");
                        if versions.kept > local.kept {
                            clip.item.kept = incoming.item.kept;
                        }
                        if versions.tags > local.tags {
                            clip.item.tags = incoming.item.tags;
                        }
                        if versions.note > local.note {
                            clip.item.note = incoming.item.note;
                        }
                        *incoming = clip;
                    }
                    local.kept = local.kept.max(versions.kept);
                    local.tags = local.tags.max(versions.tags);
                    local.note = local.note.max(versions.note);
                    let clear = Zeroizing::new(bincode::serialize(&incoming)?);
                    let blob = clip_crypto::seal(&self.key, id.as_bytes(), &clear)?;
                    disk.execute(
                        "INSERT OR REPLACE INTO clips VALUES(?,?)",
                        params![id, blob],
                    )?;
                    Self::index(&memory, &incoming)?;
                    write_versions(&disk, &id, &local, false)?;
                    true
                }
            }
        };
        disk.execute(
            "UPDATE sync_state SET cursor=?,clock=max(clock,?) WHERE id=1",
            params![event.seq, message.clock],
        )?;
        disk.commit()?;
        memory.commit()?;
        Ok(changed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Content;
    use std::path::Path;

    fn relay(
        sender: &mut Store,
        receiver: &mut Store,
        key: &Key,
        device: &str,
        seq: i64,
    ) -> Result<()> {
        let (op, ciphertext) = sender
            .next_upload(key, "test", device)?
            .context("No queued event")?;
        let event = Event {
            seq,
            device: device.into(),
            op,
            size: ciphertext.len(),
        };
        assert!(receiver.receive(key, "test", &event, &ciphertext)?);
        assert!(!receiver.receive(key, "test", &event, &ciphertext)?);
        sender.acknowledge_upload(&event.op)
    }

    #[test]
    fn concurrent_fields_and_deletion_converge() -> Result<()> {
        let device_a = Ulid::new().to_string();
        let device_b = Ulid::new().to_string();
        let mut a = Store::open(Path::new(":memory:"), Zeroizing::new([1; 32]))?;
        let mut b = Store::open(Path::new(":memory:"), Zeroizing::new([2; 32]))?;
        let key = Zeroizing::new([3; 32]);
        let clip = a.add(Content::Text("Meeting minutes".into()), None, false)?;
        let secret = a.add(Content::Text("password=example".into()), None, false)?;
        a.bind_sync("one")?;
        b.bind_sync("two")?;
        assert!(a.bind_sync("different").is_err());
        relay(&mut a, &mut b, &key, &device_a, 1)?;
        assert!(a.next_upload(&key, "test", &device_a)?.is_none());
        assert!(b.get(&secret.id).is_err());

        a.set_kept(&clip.id, true)?;
        b.apply_ai(
            &clip.id,
            Some(vec!["meeting".into()]),
            Some("A summary".into()),
        )?;
        relay(&mut a, &mut b, &key, &device_a, 2)?;
        relay(&mut b, &mut a, &key, &device_b, 3)?;
        for store in [&a, &b] {
            let item = store.get(&clip.id)?.item;
            assert!(item.kept);
            assert_eq!(item.tags, ["meeting"]);
            assert_eq!(item.note, "A summary");
        }
        b.set_kept(&clip.id, false)?;
        a.delete(&clip.id)?;
        let (op, bytes) = b.next_upload(&key, "test", &device_b)?.unwrap();
        let late = Event {
            seq: 4,
            device: device_b,
            op,
            size: bytes.len(),
        };
        assert!(!a.receive(&key, "test", &late, &bytes)?);
        b.acknowledge_upload(&late.op)?;
        assert_eq!(a.sync_cursor()?, 4);
        relay(&mut a, &mut b, &key, &device_a, 5)?;
        assert!(a.get(&clip.id).is_err() && b.get(&clip.id).is_err());
        Ok(())
    }

    #[test]
    fn queue_survives_restart_and_tampering_does_not_advance_cursor() -> Result<()> {
        let path = std::env::temp_dir().join(format!("clipsync-sync-{}.sqlite", Ulid::new()));
        let local_key = Zeroizing::new([4; 32]);
        let key = Zeroizing::new([5; 32]);
        let device = Ulid::new().to_string();
        let outcome = (|| {
            let mut a = Store::open(&path, local_key.clone())?;
            a.bind_sync("one")?;
            let clip = a.add(Content::Text("Roadmap agenda marker".into()), None, false)?;
            let (op, _) = a.next_upload(&key, "test", &device)?.unwrap();
            drop(a);

            let bytes = std::fs::read(&path)?;
            assert!(!bytes
                .windows(b"Roadmap agenda marker".len())
                .any(|part| part == b"Roadmap agenda marker"));
            let a = Store::open(&path, local_key)?;
            let (retry_op, ciphertext) = a.next_upload(&key, "test", &device)?.unwrap();
            assert_eq!(op, retry_op);
            let mut b = Store::open(Path::new(":memory:"), Zeroizing::new([6; 32]))?;
            b.bind_sync("two")?;
            let event = Event {
                seq: 1,
                device,
                op,
                size: ciphertext.len(),
            };
            let mut corrupt = ciphertext.clone();
            *corrupt.last_mut().unwrap() ^= 1;
            assert!(b.receive(&key, "test", &event, &corrupt).is_err());
            assert!(b
                .receive(&key, "wrong-account", &event, &ciphertext)
                .is_err());
            assert_eq!(b.sync_cursor()?, 0);
            assert!(b.receive(&key, "test", &event, &ciphertext)?);
            assert_eq!(b.get(&clip.id)?.content, a.get(&clip.id)?.content);
            Ok(())
        })();
        let _ = std::fs::remove_file(path);
        outcome
    }
}
