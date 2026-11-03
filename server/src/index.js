// ClipSync vault API. Mirrors the Cloudflare Worker routes the React app uses, so the same front
// end works against either: point Settings → API at http://<nas>:8790/api.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { pool, migrate } from './db.js'
import { listItems, getItem, upsertItem, patchItem, deleteItem } from './items.js'
import { semanticSearch, embedPending, organize, listSuggestions, applySuggestion, dismissSuggestion } from './ai.js'
import { pullFromEdge, pushToEdge, requireSyncToken } from './sync.js'

const PORT = Number(process.env.PORT || 8790)
const WEB_ROOT = process.env.WEB_ROOT || path.resolve('web')
const SYNC_EVERY = Number(process.env.SYNC_INTERVAL_SEC || 30) * 1000
const AI_EVERY = Number(process.env.AI_INTERVAL_SEC || 300) * 1000

const routes = []
const route = (method, pattern, fn) => {
  const keys = []
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$')
  routes.push({ method, re, keys, fn })
}

// ---- items ----
route('GET', '/api/health', async () => ({ status: 'ok', service: 'clipsync-vault', db: (await pool.query('SELECT 1')).rowCount === 1 }))
route('GET', '/api/items', ({ query: q }) => listItems({
  type: q.type, folder: q.folder, q: q.q, limit: q.limit, cursor: q.cursor, since: q.since,
  starred: q.starred === undefined ? undefined : q.starred === 'true',
  tags: q.tags ? q.tags.split(',').filter(Boolean) : undefined,
}))
route('GET', '/api/items/:id', ({ params }) => getItem(params.id).then(orNotFound))
route('POST', '/api/items', ({ body }) => upsertItem({ ...body, id: undefined }))
route('PATCH', '/api/items/:id', ({ params, body }) => patchItem(params.id, body).then(orNotFound))
route('PUT', '/api/items/:id', ({ params, body }) => patchItem(params.id, body).then(orNotFound))
route('DELETE', '/api/items/:id', async ({ params }) => (await deleteItem(params.id), { ok: true }))
route('POST', '/api/items/:id/star', async ({ params, body }) => {
  const cur = await getItem(params.id)
  if (!cur) return orNotFound(null)
  return patchItem(params.id, { starred: body?.starred ?? !cur.starred })
})

// ---- clips ----
route('POST', '/api/clips/push', ({ body }) => upsertItem({
  type: 'clip', title: '', content: body.content, folder: 'clipboard',
  metadata: { ...(body.metadata || {}), device_id: body.device_id, device_type: body.device_type },
  created_at: body.captured_at,
}, body.device_id || 'device'))
route('GET', '/api/clips/latest', async () => ({ item: (await listItems({ type: 'clip', limit: 1 })).items[0] || null }))
route('GET', '/api/clips/history', ({ query }) => listItems({ type: 'clip', limit: query.limit || 50 }))

// ---- prompts ----
route('GET', '/api/prompts', ({ query }) => listItems({ type: 'prompt', limit: query.limit || 1000, folder: query.folder }))
route('POST', '/api/prompts', ({ body }) => upsertItem({ ...body, id: undefined, type: 'prompt' }))
route('PATCH', '/api/prompts/:id', ({ params, body }) => patchItem(params.id, body).then(orNotFound))
route('POST', '/api/prompts/import', async ({ body }) => {
  const out = []
  for (const p of body.prompts || body.items || []) out.push(await upsertItem({ ...p, id: undefined, type: 'prompt' }))
  return { items: out, imported: out.length }
})

// ---- notes / bookmarks (list views) ----
route('GET', '/api/notes', () => listItems({ type: 'note', limit: 500 }))
route('POST', '/api/notes', ({ body }) => upsertItem({ ...body, id: undefined, type: 'note' }))
route('GET', '/api/notes/:id/content', async ({ params }) => {
  const it = await getItem(params.id)
  return it ? { content: it.content } : orNotFound(null)
})
route('PUT', '/api/notes/:id/content', ({ params, body }) => patchItem(params.id, { content: body.content, title: body.title }).then(orNotFound))
route('GET', '/api/bookmarks', () => listItems({ type: 'bookmark', limit: 500 }))
route('POST', '/api/bookmarks', ({ body }) => upsertItem({ ...body, id: undefined, type: 'bookmark', content: body.content || body.url, metadata: { url: body.url, ...(body.metadata || {}) } }))

// ---- tags ----
route('GET', '/api/tags', async () => {
  const r = await pool.query(
    `SELECT t.name, coalesce(c.color, '#6366f1') color, t.n usage_count FROM
       (SELECT unnest(tags) name, count(*) n FROM items WHERE deleted_at IS NULL GROUP BY 1) t
     LEFT JOIN tags c ON c.name = t.name ORDER BY t.n DESC`)
  return { tags: r.rows.map(x => ({ id: x.name, ...x, usage_count: Number(x.usage_count) })) }
})
route('POST', '/api/tags', async ({ body }) => {
  await pool.query('INSERT INTO tags (name, color) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET color = EXCLUDED.color', [body.name, body.color || '#6366f1'])
  return { id: body.name, name: body.name, color: body.color || '#6366f1', usage_count: 0 }
})
route('GET', '/api/tags/:name/items', ({ params }) => listItems({ tags: [decodeURIComponent(params.name)], limit: 500 }))

// ---- search + AI triage ----
route('POST', '/api/search/semantic', ({ body }) => semanticSearch(body.q || '', { type: body.type, limit: body.limit }))
route('POST', '/api/triage/organize', async ({ body }) => ({ suggestions: await organize({ batch: body?.batch || 20 }) }))
route('GET', '/api/triage/suggestions', async ({ query }) => ({ suggestions: await listSuggestions(query.status || 'pending', Number(query.limit) || 100) }))
route('POST', '/api/triage/suggestions/:id/apply', ({ params }) => applySuggestion(params.id).then(orNotFound))
route('POST', '/api/triage/suggestions/:id/dismiss', async ({ params }) => (await dismissSuggestion(params.id), { ok: true }))

// ---- sync (called by the Worker through the Tunnel; token-protected) ----
route('POST', '/api/sync/ingest', async ({ req, body }) => {
  if (!requireSyncToken(req)) throw Object.assign(new Error('unauthorized'), { status: 401 })
  let n = 0
  for (const it of body.items || []) { await upsertItem(it, 'edge'); n++ }
  return { ingested: n }
})
route('GET', '/api/sync/changes', ({ req, query }) => {
  if (!requireSyncToken(req)) throw Object.assign(new Error('unauthorized'), { status: 401 })
  return listItems({ since: query.since || 0, limit: query.limit || 500, includeDeleted: true })
})

function orNotFound(v) {
  if (v == null) throw Object.assign(new Error('not found'), { status: 404 })
  return v
}

// ---- server ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' }

function serveStatic(req, res, pathname) {
  let file = path.join(WEB_ROOT, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''))
  if (!file.startsWith(WEB_ROOT)) file = path.join(WEB_ROOT, 'index.html')
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB_ROOT, 'index.html')
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('web UI not built') }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname)

  const r = routes.find(r => r.method === req.method && r.re.test(url.pathname))
  if (!r) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'not found' })) }
  try {
    const m = url.pathname.match(r.re)
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : undefined
    const out = await r.fn({ req, params, query: Object.fromEntries(url.searchParams), body })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(out ?? {}))
  } catch (e) {
    const status = e.status || 500
    if (status === 500) console.error(`[api] ${req.method} ${url.pathname}:`, e)
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: e.message }))
  }
})

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', c => {
      size += c.length
      if (size > 10 * 1024 * 1024) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy() }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(Object.assign(new Error('bad json'), { status: 400 })) }
    })
    req.on('error', reject)
  })
}

function every(ms, name, fn) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try { await fn() } catch (e) { console.warn(`[${name}]`, e.message) } finally { running = false }
  }
  setTimeout(tick, 2000)
  return setInterval(tick, ms)
}

await migrate()
server.listen(PORT, () => console.log(`[vault] listening on :${PORT}`))
every(SYNC_EVERY, 'sync', async () => {
  const pulled = await pullFromEdge()
  const pushed = await pushToEdge()
  if (pulled || pushed) console.log(`[sync] pulled ${pulled}, pushed ${pushed}`)
})
if (process.env.AI_ENABLED !== '0') {
  every(AI_EVERY, 'ai', async () => {
    const e = await embedPending()
    const t = process.env.TRIAGE_ENABLED === '0' ? 0 : await organize()
    if (e || t) console.log(`[ai] embedded ${e}, triaged ${t}`)
  })
}
