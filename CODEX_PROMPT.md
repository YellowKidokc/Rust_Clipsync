# Prompt for Codex — paste everything below the line

---

You are building ClipSync in the repo `YellowKidokc/Rust_Clipsync`. Read `SPEC.md` first; it is the
source of truth. `ARCHITECTURE.md` is older and is overridden by SPEC.md where they differ.

## What it is
A clipboard manager: a desktop app captures every copy to local disk, syncs it end-to-end encrypted
through a Cloudflare relay to my phone (PWA) and other laptops, and a Synology NAS keeps full
history. AI runs locally (Ollama), on a schedule I choose or manually — never in the cloud by default.

## UI source
The React UI to use is in `apps/web/` (copied from my existing app). Keep its look. Strip views that
aren't clipboard features (Crawlers, Stewards, Deep Research, Chat) behind a feature flag. The
desktop popup is a SEPARATE minimal screen: search box, list, preview, fully keyboard-driven,
opens in under 100ms.

## Do this phase only: Phase 1 — offline desktop app (no sync yet)
1. Cargo workspace: `crates/clip-crypto`, `crates/clip-core`, `apps/desktop` (Tauri 2).
2. `clip-crypto`: XChaCha20-Poly1305 per item, Argon2id key from passphrase, key stored in OS
   keychain (`keyring` crate). Write `FORMAT.md` and test vectors (JSON) the JS side will reuse.
3. `clip-core`: SQLite (rusqlite, bundled) + FTS5. Item = id (ULID), kind (text/image/file),
   content (encrypted at rest), source_app, created_at, kept, title, tags, note, is_secret.
   Secret detector (regex + entropy: API keys, JWT, card numbers w/ Luhn, private keys, AWS keys).
   Unit tests for store, search, and secret detection.
4. `apps/desktop`: clipboard watcher (text, images, files — store file bytes), never modify the
   clipboard, global hotkey (Ctrl+Shift+V) opens popup, Enter pastes, 1–5 quick-paste, keep/pin,
   delete, pause capture, per-type toggles + max size, secret items masked and auto-cleared from
   clipboard after 30s. Tray icon.
5. Settings → AI: backend = Ollama URL (default http://localhost:11434), model name, Run =
   Manual | Every N minutes | On every copy (default Manual). In Phase 1 just implement Manual:
   "Tag this" and "Summarize" on a selected item. Never send `is_secret` items to the model.

## Rules
- Windows is the primary target; must also build on macOS/Linux.
- `cargo test`, `cargo clippy -- -D warnings`, and `npm run build` all pass before you finish.
- No secrets in the repo. No cloud calls in Phase 1.
- If something in SPEC.md is ambiguous, pick the simplest option and write the choice in
  `DECISIONS.md`.
- Finish with a short report: what works, what's stubbed, how to run it (`npm run tauri dev`).

Later phases (do NOT start): Cloudflare relay in `worker/`, sync engine, PWA phone install + QR
linking, NAS Docker app, embeddings/OCR/captions, transform palette, MCP, share links, CLI.
