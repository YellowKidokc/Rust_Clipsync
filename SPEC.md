# ClipSync build spec (Codex hand-off)

Target: match Relic (relic.space/features, read 2026-11-21) feature-for-feature, then beat it on
one axis: **AI wired into the core of the clipboard**, not bolted on. Three tiers: desktop app
(Rust/Tauri), Cloudflare relay (transfer to phone / other laptops), Synology NAS vault.

This supersedes the "AI triage at the edge" line in `ARCHITECTURE.md` — see Decision 1.

---

## Audit: where the repo stands today

| Piece | State |
|---|---|
| Desktop app | **Does not exist.** Repo is named Rust_Clipsync but contains zero Rust. |
| Cloudflare Worker API | Exists, but its code is **not in this repo**. Must be brought in or rewritten. |
| Web/PWA front end (`src/`) | Exists. React+Vite+shadcn. Scope drift: Crawlers, Stewards, Deep Research, Chat views are not clipboard features. |
| `public/clipboard/` | Standalone single-file page. Duplicate of the PWA's job. |
| NAS service | Does not exist. |
| Encryption | None. Clips go to the Worker in plaintext. |
| Tests | None. |

Verdict: the front end is a reusable shell for the web vault and phone PWA. Everything else is
greenfield.

---

## Decision 1 (the one that matters): where the AI runs

Relic's whole trust story is end-to-end encryption — the server only ever holds ciphertext. The
current plan runs AI triage on the Cloudflare Worker, which means **Cloudflare sees every clip in
plaintext**, including the secrets triage is supposed to protect. Those two goals contradict.

**Resolution:**
- Cloudflare = dumb encrypted relay. Stores ciphertext + minimal metadata (id, device, timestamp,
  size, kind). Never decrypts. No AI there.
- AI runs on **trusted hardware you own**: the desktop app (local model / Ollama) and the NAS
  (bigger model, embeddings, OCR backfill). Phone gets AI results because tags/embeddings/captions
  are computed on desktop or NAS, encrypted, and synced as item metadata.
- Optional cloud LLM (Claude API) for heavy actions only on explicit user request per item, never
  on ingest, never for items flagged secret.

## Decision 2: stack

- **Desktop:** Tauri 2 (Rust core + the existing React UI as the webview). One codebase for
  Windows/macOS/Linux. Rust core owns clipboard watching, storage, crypto, AI, hotkeys.
- **Local store:** SQLite + FTS5 + `sqlite-vec` for embeddings (one file, offline).
- **Relay:** Cloudflare Worker + D1 (index) + R2 (encrypted blobs: images/files) + Durable Object
  per account for live push (WebSocket).
- **NAS:** Rust service (same core crate as desktop, headless) in Docker on Synology, Postgres +
  pgvector (you already run PG at the NAS). Reaches Cloudflare **outbound** via Cloudflare Tunnel
  or polling — no open ports.
- **Phone:** the PWA from `src/` first (installable, share-target). Native Android later only if
  the PWA can't read the clipboard in the background (it can't on iOS/Android — see Gaps).

## Decision 3: crypto

- XChaCha20-Poly1305 per item, account key derived from a passphrase via Argon2id, stored in the
  OS keychain on each device. Device linking by QR code carrying the wrapped key.
- Crate: `chacha20poly1305`, `argon2`. The web/PWA side uses libsodium.js with the same format.
- Format spec lives in `crates/clip-crypto/FORMAT.md` and has test vectors shared by Rust and JS.

---

## Repo layout to create

```
crates/
  clip-core/      # item model, SQLite store, FTS, sync engine, secret detection
  clip-crypto/    # encryption + test vectors
  clip-ai/        # classifier, embeddings, OCR, caption, ranking (pluggable backends)
apps/
  desktop/        # Tauri 2 app; UI = src/ (moved to apps/web)
  web/            # current src/ → web vault + phone PWA
  nas/            # headless clip-core + Postgres backend, Dockerfile, compose for Synology
  cli/            # `clip` CLI
worker/           # Cloudflare Worker (relay), wrangler.jsonc, D1 migrations
```

---

## Feature matrix (Relic parity + AI core)

P0 = needed for first usable build. P1 = parity. P2 = beyond Relic.

### Capture (desktop)
- P0 Auto-capture text/images/files on every copy (`arboard` + platform clipboard listeners).
- P0 Keep the file bytes, not just the path.
- P0 Never modify what's on the clipboard.
- P1 Per-type toggles + max size; pause capture; app blocklist (password managers) — needs
  foreground-app detection per OS.
- P1 Capture hotkey → straight to vault (pinned/kept).

### Search
- P0 Instant local FTS over everything, offline.
- P1 Query syntax: `tag:` `kind:` `is:kept` `app:` + natural dates ("last week", "June 20").
- P1 Semantic search (embeddings).
- P1 OCR on images (desktop: Windows.Media.Ocr / Apple Vision / tesseract fallback).
- P1 Learned ranking: frequency per query and per source app, local only.

### AI core (the differentiator)
- P0 Secret detection on ingest (regex + entropy; API keys, cards, JWTs, private keys). Secrets:
  masked in UI, excluded from any AI call, auto-cleared from clipboard after 30s.
- P1 Smart tags / kind classification (link, code+language, address, email, phone, color, number,
  prose, command...).
- P1 Image captions (local small VLM via Ollama, e.g. moondream/llava class).
- P2 **Transform-on-paste palette**: select a clip → summarize, rewrite, translate, extract
  JSON/table, fix code, explain, convert format. Result becomes a new linked item. Local model by
  default, Claude on request.
- P2 **Ask your clipboard**: chat over history with retrieval ("the address I copied from that
  email last Tuesday").
- P2 Auto-collections: AI groups related clips into sessions/projects.
- P2 MCP server (on desktop and NAS, not the relay) so Claude/other AIs can read, search, add
  clips. Read-only by default; secrets never exposed.
- P2 Prompt library (existing Prompts view) as first-class clip kind, invokable from the palette.

### Organize
- P0 Keep/pin to vault (never ages out); everything else ages by per-device cache limit.
- P1 Edit title, tags, note; multi-select bulk tag/delete; save images/files back to disk.

### Sync
- P0 Desktop ↔ relay ↔ desktop/phone within seconds, E2E encrypted, offline queue.
- P0 NAS pulls everything, keeps forever (source of truth for history).
- P1 Add device by QR; device list with rename/revoke.
- P1 Account-switch guard (items from another key never merged).
- Conflict rule: item content is immutable; metadata edits are last-write-wins per field with
  Lamport clock.

### Privacy
- P0 E2E encryption (Decision 3). Relay holds ciphertext only.
- P1 Weekly sealed backup (NAS does it natively); export with secrets redacted.

### Share
- P1 Share link: encrypt item with a one-off key, upload to R2, key goes in the URL fragment
  (never reaches the server), expiry + view limit.

### Power-user (desktop)
- P0 Global hotkey popup with search (pristine: opens <100ms, fully keyboard-driven).
- P1 Quick-paste 1–5 (including items from other devices); paste as plain text.
- P1 Mini picker at cursor; drag out / drop in; combine-and-paste with separator; reminders.

### Developers
- P1 `clip` CLI: list/search/add/get, JSON output, pipe-friendly.
- P1 Self-host = the NAS app.

### Platforms
- P0 Windows desktop (your main machine), PWA on phone, web vault.
- P1 macOS/Linux builds from the same Tauri app.

---

## Gaps you need to know before coding

1. **Phones can't read the clipboard in the background.** Neither iOS nor Android allows it for a
   PWA (Android 10+ blocks it for native apps too, unless the app is focused or is the IME).
   Relic gets around it with share-sheet, Quick Settings tile, and iPhone Action Button. Phone
   *receiving* (paste on phone what you copied on laptop) is easy; phone *sending* needs those
   explicit gestures. A native Android app is required for the Quick Settings tile.
2. **Worker code isn't in this repo.** Either import it from wherever it lives or write `worker/`
   fresh. Recommend fresh — its API is plaintext and would need to change for E2E anyway.
3. **"Pristine" desktop UI** — the current React app is a dashboard with 11 views. The desktop
   popup should be a separate, minimal surface (search box + list + preview), not the dashboard.
4. Scope drift: Crawlers/Stewards/Deep Research/Chat belong in another app (or behind a flag).

---

## Build order for Codex

1. `clip-crypto` + test vectors. 2. `clip-core` (SQLite store, FTS, secret detection) with unit
tests. 3. Tauri desktop: capture + popup + hotkey + local search (usable offline, no sync).
4. `worker/` relay (D1, R2, Durable Object push, device auth). 5. Sync engine in `clip-core`;
PWA receives. 6. NAS app + Docker compose for Synology + Tunnel. 7. `clip-ai`: tags, embeddings,
OCR, captions. 8. Transform palette + Ask + MCP. 9. Share links, QR linking, CLI, backups.

Each step: tests pass, `cargo clippy -D warnings`, `npm run build` clean.
