# ClipSync

The front end for ClipSync: a React + Vite + Tailwind (shadcn/ui) PWA for clips, notes, prompts,
bookmarks and research, synced across devices through a ClipSync API running as a Cloudflare Worker.

It used to live in `YellowKidokc/Rust_AI_API` as `clipsync-cloudflare-app/`; its history came across
with it.

## What's here

- `src/` is the main app. Views: Dashboard, Clips, Notes, Prompts, Bookmarks, Research, Deep Research,
  Chat, Crawlers, Stewards, Settings. All network calls go through `src/lib/api.ts`.
- `public/clipboard/` is a standalone, single-file clipboard page (slots, pins, tags) with its own
  service worker. It's served at `/clipboard/`.
- `dist/` is a committed build. Rebuild it rather than editing it.

## Run it

Node 20+.

```bash
npm ci
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ locally
```

## Which API it talks to

**Not forge.** Every request goes to the ClipSync Worker API, whose code is not in this repo. The base
URL is resolved in this order:

1. Settings → API URL in the app (stored in `localStorage` under `clipsync-storage`)
2. `VITE_API_URL` at build time
3. `http://localhost:8787/api` (the default `wrangler dev` port)

`/api` is added if missing. `public/clipboard/` resolves its own base separately:
`window.CLIPSYNC_API`, then `localStorage.clipsync_api`, then `http://localhost:3456/api` on localhost,
then the production Worker URL hard-coded in `public/clipboard/index.html`.

Endpoints the app calls (all under the base above):

| Area | Endpoints |
|---|---|
| Health | `GET /health` |
| Items | `/items`, `/items/{id}`, `/items/{id}/star`, `/tags`, `/tags/{tag}/items` |
| Clips | `POST /clips/push`, `GET /clips/latest`, `GET /clips/history?limit=` |
| Notes / prompts | `/notes`, `/notes/{id}/content`, `/prompts`, `/prompts/{id}`, `POST /prompts/import` |
| Bookmarks / scraping | `/bookmarks`, `/bookmarks/scrape`, `/bookmarks/{id}/extracted`, `/scrape`, `/scrape/crawl` |
| Research | `POST /research/start`, `/research/{id}`, `/research/{id}/status` |
| AI | `POST /ai/summarize`, `POST /ai/expand-prompt` |
| Uploads | `POST /uploads/init`, `/uploads/{attachmentId}`, `/uploads/item/{itemId}` |

The Crawlers and Stewards views embed two other deployed sites in iframes (URLs in those view files).

### Relationship to forge

Forge (`YellowKidokc/Rust_AI_API`) keeps the clipboard librarian: `forge clips sort` (files clips by
category and holds back anything that looks like a password or key) and `forge clips review`. Those
stay in the engine so API keys, routing, and cost tracking live in one place. This app doesn't call
forge's gateway today. If it should, the forge side to target is `forge serve` on `127.0.0.1:8790`,
and that wiring hasn't been built.

## Deploy to Cloudflare Pages

Dashboard (Git integration):

1. Workers & Pages → Create → Pages → connect this repo.
2. Framework preset: **Vite**. Build command: `npm run build`. Output directory: `dist`.
3. Environment variables: `VITE_API_URL` = your Worker's URL (for example
   `https://<worker>.<subdomain>.workers.dev/api`), and `NODE_VERSION` = `20`.

Or from the command line:

```bash
npm run build
npx wrangler pages deploy dist --project-name clipsync
```

The API Worker has to allow this site's origin (CORS). No secrets belong in this repo: the Worker holds
its own keys as Worker secrets, and everything built into the front end is public by nature.
