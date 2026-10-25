# ClipSync architecture (plan)

Three apps, one flow of clips. Status: design notes, nothing below is built yet unless marked.

```
 devices (desktop, Android, other PCs)      Cloudflare (always up)            Synology (home)
 ┌──────────────────────────┐   push   ┌──────────────────────────┐  sync  ┌──────────────────────────┐
 │ local cache, own size    │ ───────▶ │ Worker API + MCP + PWA   │ ◀────▶ │ long-term vault + DB     │
 │ (phone 1000, PC 100 …)   │ ◀─────── │ hot window (~100 recent) │        │ full history, deep search│
 └──────────────────────────┘   pull   │ AI triage on ingest      │        │ web UI (later)           │
                                       └──────────────────────────┘        └──────────────────────────┘
```

## 1. Synology: the vault

- Keeps every clip forever. This is the source of truth.
- Database with full-text search, plus embeddings later for meaning-based ("deep") search.
- Web page to browse and search. Start by reusing this repo's front end, pointed at the Synology API.
- Pulls new clips from Cloudflare on a schedule (or the Worker pushes to it through a Cloudflare
  Tunnel). The NAS never needs an open port.

## 2. Cloudflare: the edge

- The Worker API (already exists, code lives outside this repo) plus this PWA on Pages, so it installs
  anywhere and is always on the latest version. Mobile-first layout.
- An MCP endpoint on the same Worker, so any AI client can read, search and add clips.
- Keeps only a hot window (about the last 100 clips) in D1/KV. Older clips live on the Synology.
- **AI triage on every paste:** classify (category, tags), flag secrets (passwords, keys: never
  stored in plain text, never sent to the AI), or mark as junk to throw away. Runs here because the
  edge is always up and sees every clip first. Workers AI keeps it cheap; forge's `clips sort` rules
  are the model to copy.

## 3. Devices: the clients

- Each device picks its own cache size (phone 1000, a laptop 100, and so on).
- A device asking for more than Cloudflare's hot window gets the rest from the Synology, routed
  through the Worker, so devices only ever talk to one address.
- Offline: the device queues pastes and pushes when it reconnects.

## Open questions

- Is triage done once at the edge, or redone on the Synology with a bigger model?
- How does the Worker reach the NAS: a Tunnel (recommended) or the NAS polling?
- Which DB on the Synology: Postgres (with pgvector for deep search) or SQLite?
- Conflict rule when two devices edit the same clip: last write wins?
