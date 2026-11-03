//! Local store: every clip and prompt lives in a SQLite file on this PC
//! (%APPDATA%\pro.theophysics.clipsync\clipsync.db). The app needs no server.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Mutex};

pub struct Store(Mutex<Connection>);

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Item {
    pub id: i64,
    /// "clip" or "prompt"
    pub kind: String,
    pub title: String,
    pub content: String,
    pub folder: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub masked: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub uses: i64,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Query {
    pub kind: Option<String>,
    pub q: Option<String>,
    pub folder: Option<String>,
    pub limit: Option<i64>,
}

pub fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

const COLS: &str = "id, kind, title, content, folder, tags, pinned, masked, created_at, updated_at, uses";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Item> {
    let tags: String = r.get(5)?;
    Ok(Item {
        id: r.get(0)?,
        kind: r.get(1)?,
        title: r.get(2)?,
        content: r.get(3)?,
        folder: r.get(4)?,
        tags: serde_json::from_str(&tags).unwrap_or_default(),
        pinned: r.get(6)?,
        masked: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
        uses: r.get(10)?,
    })
}

impl Store {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let c = Connection::open(path)?;
        c.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS items (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               kind TEXT NOT NULL,
               title TEXT NOT NULL DEFAULT '',
               content TEXT NOT NULL,
               folder TEXT NOT NULL DEFAULT '',
               tags TEXT NOT NULL DEFAULT '[]',
               pinned INTEGER NOT NULL DEFAULT 0,
               masked INTEGER NOT NULL DEFAULT 0,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL,
               uses INTEGER NOT NULL DEFAULT 0
             );
             CREATE INDEX IF NOT EXISTS items_kind_updated ON items(kind, updated_at DESC);",
        )?;
        Ok(Self(Mutex::new(c)))
    }

    /// New clip. Copying the same text again just moves it to the top instead of duplicating it.
    pub fn add_clip(&self, content: &str, masked: bool, max_clips: i64) -> rusqlite::Result<Item> {
        let c = self.0.lock().unwrap();
        // Strictly increasing, so two copies in the same millisecond still order correctly.
        let last: i64 = c.query_row("SELECT coalesce(max(updated_at), 0) FROM items", [], |r| r.get(0))?;
        let t = now().max(last + 1);
        let existing: Option<i64> = c
            .query_row("SELECT id FROM items WHERE kind='clip' AND content=?1", [content], |r| r.get(0))
            .optional()?;
        let id = match existing {
            Some(id) => {
                c.execute("UPDATE items SET updated_at=?2 WHERE id=?1", params![id, t])?;
                id
            }
            None => {
                c.execute(
                    "INSERT INTO items (kind, content, masked, created_at, updated_at) VALUES ('clip', ?1, ?2, ?3, ?3)",
                    params![content, masked, t],
                )?;
                c.last_insert_rowid()
            }
        };
        // History limit: oldest unpinned clips go first.
        c.execute(
            "DELETE FROM items WHERE kind='clip' AND pinned=0 AND id NOT IN
               (SELECT id FROM items WHERE kind='clip' ORDER BY pinned DESC, updated_at DESC, id DESC LIMIT ?1)",
            [max_clips],
        )?;
        c.query_row(&format!("SELECT {COLS} FROM items WHERE id=?1"), [id], row)
    }

    pub fn list(&self, q: Query) -> rusqlite::Result<Vec<Item>> {
        let c = self.0.lock().unwrap();
        let mut sql = format!("SELECT {COLS} FROM items WHERE 1=1");
        let mut args: Vec<String> = vec![];
        if let Some(k) = q.kind.filter(|k| !k.is_empty()) {
            args.push(k);
            sql += &format!(" AND kind=?{}", args.len());
        }
        if let Some(f) = q.folder.filter(|f| !f.is_empty()) {
            args.push(f.clone());
            args.push(format!("{f}/%"));
            sql += &format!(" AND (folder=?{} OR folder LIKE ?{})", args.len() - 1, args.len());
        }
        if let Some(text) = q.q.filter(|s| !s.trim().is_empty()) {
            for term in text.split_whitespace() {
                args.push(format!("%{term}%"));
                let n = args.len();
                sql += &format!(" AND (title LIKE ?{n} OR content LIKE ?{n} OR folder LIKE ?{n} OR tags LIKE ?{n})");
            }
        }
        sql += &format!(" ORDER BY pinned DESC, updated_at DESC, id DESC LIMIT {}", q.limit.unwrap_or(500).clamp(1, 5000));
        let mut st = c.prepare(&sql)?;
        let rows = st.query_map(rusqlite::params_from_iter(args.iter()), row)?;
        rows.collect()
    }

    /// Create (id 0) or update a prompt / snippet.
    pub fn save(&self, it: Item) -> rusqlite::Result<Item> {
        let c = self.0.lock().unwrap();
        let t = now();
        let tags = serde_json::to_string(&it.tags).unwrap_or_else(|_| "[]".into());
        let kind = if it.kind.is_empty() { "prompt".to_string() } else { it.kind.clone() };
        let id = if it.id == 0 {
            c.execute(
                "INSERT INTO items (kind, title, content, folder, tags, pinned, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
                params![kind, it.title, it.content, it.folder, tags, it.pinned, t],
            )?;
            c.last_insert_rowid()
        } else {
            c.execute(
                "UPDATE items SET kind=?2, title=?3, content=?4, folder=?5, tags=?6, pinned=?7, updated_at=?8 WHERE id=?1",
                params![it.id, kind, it.title, it.content, it.folder, tags, it.pinned, t],
            )?;
            it.id
        };
        c.query_row(&format!("SELECT {COLS} FROM items WHERE id=?1"), [id], row)
    }

    pub fn delete(&self, id: i64) -> rusqlite::Result<()> {
        self.0.lock().unwrap().execute("DELETE FROM items WHERE id=?1", [id]).map(|_| ())
    }

    pub fn set_pinned(&self, id: i64, pinned: bool) -> rusqlite::Result<()> {
        self.0.lock().unwrap().execute("UPDATE items SET pinned=?2 WHERE id=?1", params![id, pinned]).map(|_| ())
    }

    pub fn mark_used(&self, id: i64) -> rusqlite::Result<()> {
        self.0.lock().unwrap().execute("UPDATE items SET uses=uses+1 WHERE id=?1", [id]).map(|_| ())
    }

    pub fn clear_clips(&self) -> rusqlite::Result<usize> {
        self.0.lock().unwrap().execute("DELETE FROM items WHERE kind='clip' AND pinned=0", [])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clips_dedupe_and_trim() {
        let dir = std::env::temp_dir().join(format!("clipsync-test-{}", now()));
        let s = Store::open(&dir.join("t.db")).unwrap();
        s.add_clip("a", false, 2).unwrap();
        s.add_clip("b", false, 2).unwrap();
        s.add_clip("a", false, 2).unwrap(); // moves to top, no duplicate
        s.add_clip("c", false, 2).unwrap(); // trims "b"
        let all = s.list(Query { kind: Some("clip".into()), ..Default::default() }).unwrap();
        assert_eq!(all.iter().map(|i| i.content.as_str()).collect::<Vec<_>>(), vec!["c", "a"]);
        let p = s.save(Item { title: "Email".into(), content: "Hi {{name}}".into(), folder: "writing/email".into(), ..Default::default() }).unwrap();
        let found = s.list(Query { q: Some("email".into()), folder: Some("writing".into()), ..Default::default() }).unwrap();
        assert_eq!(found[0].id, p.id);
        let _ = std::fs::remove_dir_all(dir);
    }
}
