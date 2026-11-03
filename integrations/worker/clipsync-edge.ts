/**
 * Drop-in module for the Cloudflare Worker (Rust_AI_API / Forge repo). NOT deployed from here and
 * not tested against Forge's code: copy this file and secrets.ts into the Worker and wire the four
 * hooks below into its router. It assumes a D1 `items` table with the columns the PWA already reads
 * (id, type, title, content, folder, tags_json, metadata_json, starred, created_at, updated_at).
 *
 *  1. triageOnIngest(env, content)   call from POST /api/clips/push before the INSERT
 *  2. GET  /api/sync/changes?since=   the vault polls this (pull)
 *  3. POST /api/sync/ingest           the vault pushes its edits here (and the desktop never needs to know)
 *  4. trimHotWindow(env)              run from the Worker's scheduled() handler
 *  +  vaultFallback(env, req)         forward history requests older than the hot window to the NAS
 *
 * wrangler.toml additions:
 *   [ai]            binding = "AI"
 *   [vars]          HOT_WINDOW = "100"   VAULT_URL = "https://vault.<your domain>"  (Tunnel hostname, optional)
 *   secret          VAULT_SYNC_TOKEN     (same as SYNC_TOKEN in server/.env)
 *   [triggers]      crons = ["*\/5 * * * *"]
 */
import { maskSecrets } from './secrets'

export interface Env {
  DB: D1Database
  AI: Ai
  HOT_WINDOW?: string
  VAULT_URL?: string
  VAULT_SYNC_TOKEN?: string
  // Cloudflare Access service token for the Tunnel hostname, if Access protects it
  CF_ACCESS_CLIENT_ID?: string
  CF_ACCESS_CLIENT_SECRET?: string
}

export interface Triage {
  content: string
  category: 'code' | 'url' | 'prompt' | 'text' | 'command' | 'data' | 'junk'
  tags: string[]
  secrets: string[]
  junk: boolean
}

const TRIAGE_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast'

/**
 * 1. Edge triage on every paste: mask secrets first (the model never sees them), then a cheap
 * heuristic pass, then a small Workers AI call only for text the heuristics can't place.
 */
export async function triageOnIngest(env: Env, raw: string): Promise<Triage> {
  const m = maskSecrets(raw)
  const content = m.text
  const t = content.trim()
  const base: Triage = { content, category: 'text', tags: [], secrets: m.found, junk: false }
  if (m.masked) base.tags.push('secret-masked')

  // Junk: empty, one short token, OTP-looking codes.
  if (t.length < 3 || /^\d{4,8}$/.test(t)) return { ...base, category: 'junk', junk: true }
  if (/^https?:\/\/\S+$/.test(t)) return { ...base, category: 'url', tags: [...base.tags, 'link'] }
  if (/^(\$ |sudo |git |npm |npx |docker |cargo |curl |cd |ls |pnpm |pip )/.test(t)) return { ...base, category: 'command', tags: [...base.tags, 'shell'] }
  if (/^[{[][\s\S]*[}\]]$/.test(t)) { try { JSON.parse(t); return { ...base, category: 'data', tags: [...base.tags, 'json'] } } catch { /* not json */ } }
  if (/(^|\n)\s*(function|const|let|def|class|import|fn|pub|SELECT|CREATE)\b/.test(t)) return { ...base, category: 'code', tags: [...base.tags, 'code'] }

  // Ask the model only for longer prose; short clips aren't worth the latency.
  if (m.masked || t.length < 80) return base
  try {
    const r: any = await env.AI.run(TRIAGE_MODEL, {
      messages: [
        { role: 'system', content: 'Classify clipboard text. Reply JSON only: {"category":"prompt|text|junk","tags":["1-4 lowercase tags"]}. "prompt" = an instruction meant for an AI model.' },
        { role: 'user', content: t.slice(0, 3000) },
      ],
      max_tokens: 60,
    })
    const j = JSON.parse(String(r.response).match(/\{[\s\S]*\}/)?.[0] || '{}')
    const category = ['prompt', 'text', 'junk'].includes(j.category) ? j.category : 'text'
    return { ...base, category, junk: category === 'junk', tags: [...base.tags, ...((j.tags || []) as string[]).slice(0, 4)] }
  } catch {
    return base
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

function authorized(env: Env, req: Request) {
  return !!env.VAULT_SYNC_TOKEN && req.headers.get('Authorization') === `Bearer ${env.VAULT_SYNC_TOKEN}`
}

/** Route handler for /api/sync/*. Returns null if the path isn't a sync route. */
export async function handleSync(env: Env, req: Request): Promise<Response | null> {
  const url = new URL(req.url)
  if (!url.pathname.startsWith('/api/sync/')) return null
  if (!authorized(env, req)) return json({ error: 'unauthorized' }, 401)

  // 2. Changes since a timestamp, oldest first, so the vault can page forward.
  if (url.pathname === '/api/sync/changes' && req.method === 'GET') {
    const since = Number(url.searchParams.get('since') || 0)
    const limit = Math.min(Number(url.searchParams.get('limit') || 500), 1000)
    const r = await env.DB.prepare('SELECT * FROM items WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ?').bind(since, limit).all()
    return json({ items: r.results })
  }

  // 3. Vault → edge. Last write wins on updated_at. Prompts are always kept at the edge (the picker
  // needs the whole library); other types only if they fall inside the hot window.
  if (url.pathname === '/api/sync/ingest' && req.method === 'POST') {
    const { items = [] } = await req.json<{ items: any[] }>()
    const stmts = items.map(it => env.DB.prepare(
      `INSERT INTO items (id, type, title, content, folder, tags_json, metadata_json, starred, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(id) DO UPDATE SET type=?2, title=?3, content=?4, folder=?5, tags_json=?6, metadata_json=?7,
         starred=?8, updated_at=?10 WHERE items.updated_at <= ?10`)
      .bind(it.id, it.type, it.title || '', maskSecrets(it.content || '').text, it.folder || '',
        JSON.stringify(it.tags || []), JSON.stringify(it.metadata || {}), it.starred ? 1 : 0, it.created_at, it.updated_at))
    const deletes = items.filter(it => it.deleted_at).map(it => env.DB.prepare('DELETE FROM items WHERE id = ?').bind(it.id))
    if (stmts.length) await env.DB.batch([...stmts, ...deletes])
    return json({ ingested: items.length })
  }
  return json({ error: 'not found' }, 404)
}

/** 4. Keep only the newest HOT_WINDOW non-prompt items at the edge. Safe: the vault already has them. */
export async function trimHotWindow(env: Env) {
  const keep = Number(env.HOT_WINDOW || 100)
  // Only trim what the vault has confirmed pulling; the vault's pull cursor is not visible here, so
  // keep a safety margin of one day on top of the window.
  await env.DB.prepare(
    `DELETE FROM items WHERE type <> 'prompt' AND starred = 0
       AND updated_at < (strftime('%s','now') * 1000 - 86400000)
       AND id NOT IN (SELECT id FROM items WHERE type <> 'prompt' ORDER BY updated_at DESC LIMIT ?)`)
    .bind(keep).run()
}

/**
 * Devices asking for more history than the hot window: forward to the vault through the Tunnel, so
 * devices still only know one address. Use for GET /api/items with a cursor older than the window,
 * GET /api/clips/history?limit>HOT_WINDOW, and POST /api/search/semantic.
 */
export async function vaultFallback(env: Env, req: Request): Promise<Response | null> {
  if (!env.VAULT_URL) return null
  const url = new URL(req.url)
  const headers = new Headers(req.headers)
  if (env.VAULT_SYNC_TOKEN) headers.set('Authorization', `Bearer ${env.VAULT_SYNC_TOKEN}`)
  if (env.CF_ACCESS_CLIENT_ID) {
    headers.set('CF-Access-Client-Id', env.CF_ACCESS_CLIENT_ID)
    headers.set('CF-Access-Client-Secret', env.CF_ACCESS_CLIENT_SECRET || '')
  }
  try {
    const r = await fetch(`${env.VAULT_URL.replace(/\/$/, '')}${url.pathname}${url.search}`, {
      method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.text(),
    })
    return r.ok ? r : null
  } catch {
    return null // NAS asleep/offline: caller serves what the edge has
  }
}
