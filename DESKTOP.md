# ClipSync: desktop, library, vault, triage

What was built for the four phases, how to run each, and what is still open. The desktop app (1) stands
on its own; 2–4 are for the web app and the optional server side, and the desktop app does not depend on them.

## 1. Desktop app (Tauri 2), `src-tauri/` + `desktop.html`

**A standalone clipboard manager.** It does not need the Cloudflare API, the Worker or the NAS: clips and
prompts live in a SQLite file on the PC (`%APPDATA%\pro.theophysics.clipsync\clipsync.db`). The web app
(`index.html`, the PWA) is a separate app and is not part of the desktop build's main window.

- **Window** (`src/desktop/DesktopApp.tsx`): Clipboard (history, search, copy, pin, save to library, clear),
  Library (folders, tags, create/edit, import .md or a whole folder), Settings.
- **Tray icon**: left click opens it; menu has Open, Quick picker, Capture clipboard (toggle), Quit.
  Closing the window keeps the app in the tray. A second launch just focuses the running one.
- **Global hotkey `Ctrl+Shift+Space`** opens the picker at the mouse cursor (kept on that monitor). Type a
  few characters, Enter pastes into the app you were in. Tab cycles All/Prompts/Clips, Ctrl+1…9 pastes row N,
  prompts with `{{blanks}}` ask for the values first. Hotkey is changeable in Settings.
- **Capture**: polls the clipboard every 500 ms, masks passwords/keys/tokens (`src-tauri/src/secrets.rs`)
  before saving, de-duplicates (copying the same text again moves it to the top), keeps the newest 1000
  clips (configurable; pinned clips are never trimmed). The picker's own pastes are not re-captured.
- **Starts with Windows** (launches hidden). NSIS installer, per-user. about **3.4 MB** (measured in CI, with SQLite bundled).
- **Sync is optional and off.** Settings → "Also send clips to a server" pushes new clips to an API URL
  (with an offline queue). Nothing else uses the network.

Run / build (Windows, needs Rust + Node + WebView2, which Windows 11 has):

```bash
npm install
```

```bash
npm run desktop:dev
```

```bash
npm run desktop:build
```

The installer lands in `src-tauri/target/release/bundle/nsis/`. `.github/workflows/desktop.yml` builds it
on every push to Main and uploads it as an artifact.

## 2. Prompt library in the web app (Prompts view → "Prompt Library")

- Folder tree (folders are `a/b/c` paths on the item), tag chips to filter, folder + tags on create/edit.
- Search ranks title/shortcut hits above body hits (`src/lib/library.ts`); the ✨ button switches to
  meaning-based search via `POST /api/search/semantic` and falls back to text match if the server lacks it.
- **Import .md / Import folder**: frontmatter (`title`, `folder`, `tags`, `shortcut`) applies to the file; each
  `## heading` becomes its own prompt; otherwise one prompt per file. Subfolders of an imported folder become
  library folders. You get a preview before anything is created.

## 3. Synology vault, `server/`

Node 22 + `pg`, one dependency. Mirrors the Worker routes the app uses (`/items`, `/clips/*`, `/prompts`,
`/notes`, `/bookmarks`, `/tags`) plus `/search/semantic`, `/triage/*`, `/sync/*`. Serves the same React UI
built against its own `/api`, so `http://192.168.2.50:8790` is the full-history web UI.

```bash
cd server && cp .env.example .env
```

```bash
docker compose up -d --build
```

- Source of truth: soft deletes, last-write-wins on `updated_at`, masks secrets again on ingest.
- **No open port**: by default the vault polls the Worker (`GET /api/sync/changes`, falling back to
  `/api/items` until that route exists) and pushes its own edits to `POST /api/sync/ingest`.
  `docker compose --profile tunnel up -d` adds cloudflared so the Worker can also reach the vault for
  older-than-hot history. Put a Cloudflare Access service token in front of the tunnel hostname: only
  `/api/sync/*` checks `SYNC_TOKEN` itself.
- Postgres: uses the existing NAS instance (`DATABASE_URL`). With `CREATE EXTENSION vector` it adds
  embeddings + HNSW index; without it, semantic search uses Postgres full-text ranking.

## 4. AI triage

- **Edge** (`integrations/worker/clipsync-edge.ts`, copy into the Forge Worker): mask secrets first so the
  model never sees them, heuristics for url/command/json/code/junk, a small Workers AI call only for longer
  prose. Also holds the `/api/sync/*` routes, hot-window trim, and the vault fallback. Not deployed or tested
  against Forge's code — wiring is described at the top of the file.
- **NAS** (`server/src/ai.js`, Ollama on the LAN): embeds new items, and the organizer walks untriaged clips
  and notes, classifies each as prompt / template / snippet / note / junk, picks a folder (reusing existing
  ones), tags, and related items by embedding distance. Results are *suggestions*
  (`GET /api/triage/suggestions`, `POST …/:id/apply|dismiss`); `TRIAGE_AUTO_APPLY=1` files library kinds
  directly. Secret-flagged items are never sent to a model.

## Open

- The Forge Worker still needs the edge module wired in (`/api/sync/*`, triage on push, `/search/semantic`).
- A UI page for reviewing triage suggestions (the API is there).
- Paste-into-previous-app behaviour needs checking on a real Windows box.
- The Worker API has no auth visible from this repo; the desktop app sends none.
