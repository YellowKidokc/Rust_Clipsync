ALTER TABLE devices ADD COLUMN archive_only INTEGER NOT NULL DEFAULT 0 CHECK (archive_only IN (0, 1));
