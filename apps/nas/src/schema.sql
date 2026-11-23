CREATE SCHEMA IF NOT EXISTS clipsync_archive;

CREATE TABLE IF NOT EXISTS clipsync_archive.archive_identity (
    id smallint PRIMARY KEY CHECK (id = 1),
    origin text NOT NULL,
    account text NOT NULL
);

CREATE TABLE IF NOT EXISTS clipsync_archive.events (
    seq bigint PRIMARY KEY CHECK (seq > 0),
    device text NOT NULL,
    op text NOT NULL,
    item text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('snapshot', 'delete')),
    body bytea NOT NULL,
    UNIQUE (device, op)
);

CREATE INDEX IF NOT EXISTS clipsync_archive_item_seq ON clipsync_archive.events (item, seq);
