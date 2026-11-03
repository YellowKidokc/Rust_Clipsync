import pg from 'pg'

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL, // e.g. postgres://clipsync:…@192.168.1.177:2665/clipsync
  max: 10,
})

export let hasVector = false
export const EMBED_DIM = Number(process.env.EMBED_DIM || 768) // nomic-embed-text

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      title       TEXT NOT NULL DEFAULT '',
      content     TEXT NOT NULL DEFAULT '',
      folder      TEXT NOT NULL DEFAULT '',
      tags        TEXT[] NOT NULL DEFAULT '{}',
      starred     BOOLEAN NOT NULL DEFAULT false,
      metadata    JSONB NOT NULL DEFAULT '{}',
      prompt      JSONB,              -- {template, variables, shortcut} for type=prompt
      user_id     TEXT NOT NULL DEFAULT 'default',
      origin      TEXT NOT NULL DEFAULT 'vault', -- vault | edge | <device id>
      created_at  BIGINT NOT NULL,
      updated_at  BIGINT NOT NULL,
      deleted_at  BIGINT,             -- soft delete so the delete syncs
      triaged_at  BIGINT,
      fts         TSVECTOR GENERATED ALWAYS AS (
                    setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
                    setweight(to_tsvector('english', coalesce(content,'')), 'B')) STORED
    );
    CREATE INDEX IF NOT EXISTS items_type_updated ON items (type, updated_at DESC);
    CREATE INDEX IF NOT EXISTS items_updated ON items (updated_at);
    CREATE INDEX IF NOT EXISTS items_fts ON items USING GIN (fts);
    CREATE INDEX IF NOT EXISTS items_tags ON items USING GIN (tags);

    CREATE TABLE IF NOT EXISTS tags (
      name TEXT PRIMARY KEY,
      color TEXT NOT NULL DEFAULT '#6366f1'
    );

    CREATE TABLE IF NOT EXISTS triage_suggestions (
      id          BIGSERIAL PRIMARY KEY,
      item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,      -- prompt | snippet | template | note | junk
      title       TEXT,
      folder      TEXT,
      tags        TEXT[] NOT NULL DEFAULT '{}',
      related_ids TEXT[] NOT NULL DEFAULT '{}',
      reason      TEXT,
      status      TEXT NOT NULL DEFAULT 'pending', -- pending | applied | dismissed
      created_at  BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS triage_status ON triage_suggestions (status, created_at DESC);

    CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector')
    await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS embedding vector(${EMBED_DIM})`)
    await pool.query('CREATE INDEX IF NOT EXISTS items_embedding ON items USING hnsw (embedding vector_cosine_ops)')
    hasVector = true
  } catch (e) {
    console.warn('[db] pgvector not available, semantic search falls back to full-text:', e.message)
  }
}

export async function getState(key, fallback = null) {
  const r = await pool.query('SELECT value FROM sync_state WHERE key = $1', [key])
  return r.rows[0]?.value ?? fallback
}
export async function setState(key, value) {
  await pool.query(
    'INSERT INTO sync_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, String(value)])
}
