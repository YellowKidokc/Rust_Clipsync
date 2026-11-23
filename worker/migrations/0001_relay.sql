CREATE TABLE devices (
  account TEXT NOT NULL,
  device TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  PRIMARY KEY (account, device)
) STRICT;

CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  device TEXT NOT NULL,
  op TEXT NOT NULL,
  size INTEGER NOT NULL,
  UNIQUE (account, device, op)
) STRICT;

CREATE INDEX events_by_account ON events (account, seq);
