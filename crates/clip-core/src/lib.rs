pub mod secret;
pub mod sync;

use anyhow::{Context, Result};
use clip_crypto::Key;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use ulid::Ulid;
use zeroize::Zeroizing;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Text,
    Image,
    File,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub enum Content {
    Text(String),
    Image {
        width: usize,
        height: usize,
        rgba: Vec<u8>,
    },
    Files(Vec<(String, Vec<u8>)>),
}

impl Content {
    pub fn kind(&self) -> Kind {
        match self {
            Self::Text(_) => Kind::Text,
            Self::Image { .. } => Kind::Image,
            Self::Files(_) => Kind::File,
        }
    }

    pub fn is_secret(&self) -> bool {
        match self {
            Self::Text(text) => secret::is_secret(text),
            Self::Files(files) => files.iter().any(|(name, bytes)| {
                secret::is_secret(name) || std::str::from_utf8(bytes).is_ok_and(secret::is_secret)
            }),
            Self::Image { .. } => false,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Item {
    pub id: String,
    pub kind: Kind,
    pub source_app: Option<String>,
    pub created_at: u64,
    pub kept: bool,
    pub title: String,
    pub tags: Vec<String>,
    pub note: String,
    pub is_secret: bool,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Clip {
    pub item: Item,
    pub content: Content,
}

pub struct Store {
    db: Connection,
    index: Connection,
    key: Key,
}

impl Store {
    pub fn open(path: &Path, key: Key) -> Result<Self> {
        let db = Connection::open(path)?;
        db.execute_batch(
            "PRAGMA secure_delete=ON;
            CREATE TABLE IF NOT EXISTS clips (id TEXT PRIMARY KEY, body BLOB NOT NULL);",
        )?;
        db.execute_batch(sync::SCHEMA)?;
        let index = Connection::open_in_memory()?;
        index.execute_batch("PRAGMA temp_store=MEMORY;
            CREATE VIRTUAL TABLE search USING fts5(id UNINDEXED, body);
            CREATE TABLE items (id TEXT PRIMARY KEY, created INTEGER, kept INTEGER, metadata TEXT);")?;
        let mut store = Self { db, index, key };
        let mut query = store.db.prepare("SELECT id, body FROM clips")?;
        let mut rows = query.query([])?;
        while let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            let bytes: Vec<u8> = row.get(1)?;
            let clip = store.decode(&id, &bytes)?;
            Self::index(&store.index, &clip)?;
        }
        drop(rows);
        drop(query);
        store.prune()?;
        Ok(store)
    }

    fn decode(&self, id: &str, bytes: &[u8]) -> Result<Clip> {
        let plaintext = Zeroizing::new(clip_crypto::open(&self.key, id.as_bytes(), bytes)?);
        Ok(bincode::deserialize(&plaintext)?)
    }

    fn index(index: &Connection, clip: &Clip) -> Result<()> {
        let item = &clip.item;
        index.execute("DELETE FROM search WHERE id=?1", [&item.id])?;
        if !item.is_secret {
            let body = match &clip.content {
                Content::Text(text) => text.clone(),
                Content::Files(files) => files
                    .iter()
                    .map(|(name, _)| name.as_str())
                    .collect::<Vec<_>>()
                    .join(" "),
                Content::Image { .. } => "image".into(),
            };
            let searchable = format!(
                "{} {} {} {} {}",
                item.title,
                item.tags.join(" "),
                item.note,
                item.source_app.as_deref().unwrap_or_default(),
                body
            );
            index.execute(
                "INSERT INTO search VALUES (?1,?2)",
                params![item.id, searchable],
            )?;
        }
        index.execute(
            "INSERT OR REPLACE INTO items VALUES (?1,?2,?3,?4)",
            params![
                item.id,
                item.created_at,
                item.kept,
                serde_json::to_string(item)?
            ],
        )?;
        Ok(())
    }

    fn save(&mut self, clip: &Clip, fields: sync::Fields) -> Result<()> {
        let id = &clip.item.id;
        let plaintext = Zeroizing::new(bincode::serialize(clip)?);
        let blob = clip_crypto::seal(&self.key, id.as_bytes(), &plaintext)?;
        let disk = self.db.transaction()?;
        let memory = self.index.transaction()?;
        disk.execute(
            "INSERT OR REPLACE INTO clips VALUES (?1,?2)",
            params![id, blob],
        )?;
        sync::record_save(&disk, &self.key, clip, fields)?;
        Self::index(&memory, clip)?;
        disk.commit()?;
        memory.commit()?;
        Ok(())
    }

    pub fn add(
        &mut self,
        content: Content,
        source_app: Option<String>,
        concealed: bool,
    ) -> Result<Item> {
        let is_secret = concealed || content.is_secret();
        let title = if is_secret {
            "Hidden secret".into()
        } else {
            match &content {
                Content::Text(text) => text
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .chars()
                    .take(80)
                    .collect(),
                Content::Files(files) => files
                    .iter()
                    .map(|(name, _)| name.as_str())
                    .collect::<Vec<_>>()
                    .join(", "),
                Content::Image { width, height, .. } => format!("Image {width} × {height}"),
            }
        };
        let item = Item {
            id: Ulid::new().to_string(),
            kind: content.kind(),
            source_app,
            created_at: SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64,
            kept: false,
            title,
            tags: vec![],
            note: String::new(),
            is_secret,
        };
        self.save(
            &Clip {
                item: item.clone(),
                content,
            },
            sync::Fields::default(),
        )?;
        self.prune()?;
        Ok(item)
    }

    pub fn list(&self, query: &str, limit: u32) -> Result<Vec<Item>> {
        let terms = query
            .split(|c: char| !c.is_alphanumeric())
            .filter(|s| !s.is_empty())
            .map(|s| format!("\"{s}\"*"))
            .collect::<Vec<_>>()
            .join(" AND ");
        let mut stmt = self.index.prepare(
            "SELECT metadata FROM items WHERE ?1='' OR id IN (SELECT id FROM search WHERE search MATCH NULLIF(?1,''))
            ORDER BY kept DESC, created DESC, id DESC LIMIT ?2")?;
        let mut rows = stmt.query(params![terms, limit])?;
        let mut items = Vec::new();
        while let Some(row) = rows.next()? {
            items.push(serde_json::from_str(&row.get::<_, String>(0)?)?);
        }
        Ok(items)
    }

    pub fn get(&self, id: &str) -> Result<Clip> {
        let blob: Vec<u8> = self
            .db
            .query_row("SELECT body FROM clips WHERE id=?1", [id], |row| row.get(0))
            .context("Clip unavailable")?;
        self.decode(id, &blob)
    }

    pub fn set_kept(&mut self, id: &str, kept: bool) -> Result<()> {
        let mut clip = self.get(id)?;
        clip.item.kept = kept;
        self.save(
            &clip,
            sync::Fields {
                kept: true,
                ..Default::default()
            },
        )?;
        self.prune()
    }

    pub fn apply_ai(
        &mut self,
        id: &str,
        tags: Option<Vec<String>>,
        note: Option<String>,
    ) -> Result<()> {
        let mut clip = self.get(id)?;
        anyhow::ensure!(!clip.item.is_secret, "Secret clips are excluded from AI");
        let fields = sync::Fields {
            tags: tags.is_some(),
            note: note.is_some(),
            ..Default::default()
        };
        if let Some(tags) = tags {
            for tag in tags {
                if !clip.item.tags.contains(&tag) {
                    clip.item.tags.push(tag);
                }
            }
        }
        if let Some(note) = note {
            clip.item.note = note;
        }
        self.save(&clip, fields)
    }

    fn prune(&mut self) -> Result<()> {
        let mut stmt = self.index.prepare(
            "SELECT id FROM items WHERE kept=0 ORDER BY created DESC,id DESC LIMIT -1 OFFSET 2000",
        )?;
        let ids = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        for id in ids {
            if !sync::tracked(&self.db, &id)? {
                self.delete(&id)?;
            }
        }
        Ok(())
    }

    fn unindex(index: &Connection, id: &str) -> Result<()> {
        index.execute("DELETE FROM search WHERE id=?1", [id])?;
        index.execute("DELETE FROM items WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn delete(&mut self, id: &str) -> Result<()> {
        let disk = self.db.transaction()?;
        let memory = self.index.transaction()?;
        disk.execute("DELETE FROM clips WHERE id=?1", [id])?;
        sync::record_delete(&disk, &self.key, id)?;
        Self::unindex(&memory, id)?;
        disk.commit()?;
        memory.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_rebuilds_without_writing_plaintext_or_indexing_secrets() -> Result<()> {
        let path = std::env::temp_dir().join(format!("clipsync-{}.sqlite", Ulid::new()));
        let outcome = (|| {
            let key = clip_crypto::derive(b"regression test", &[0; 16])?;
            let mut store = Store::open(&path, key.clone())?;
            let public = store.add(
                Content::Text("Blueberry meeting minutes".into()),
                None,
                false,
            )?;
            let secret = store.add(Content::Text("password=watermelon".into()), None, false)?;
            assert!(secret.is_secret);
            assert_eq!(store.list("", 100)?.len(), 2);
            assert!(store.list("watermelon", 100)?.is_empty());
            store.set_kept(&public.id, true)?;
            drop(store);
            let file = std::fs::read(&path)?;
            for text in [b"Blueberry".as_slice(), b"watermelon".as_slice()] {
                assert!(!file.windows(text.len()).any(|bytes| bytes == text));
            }
            let mut store = Store::open(&path, key)?;
            let matches = store.list("blueb min", 100)?;
            assert_eq!(matches.len(), 1);
            assert!(matches[0].kept);
            store.delete(&public.id)?;
            assert!(store.list("blueb", 100)?.is_empty());
            Ok(())
        })();
        let _ = std::fs::remove_file(path);
        outcome
    }
}
