// Vault ↔ edge sync without an open port on the NAS.
//
// Default "poll" mode: the vault calls OUT to the Worker on a timer.
//   pull: GET  {WORKER}/api/sync/changes?since=<ms>   (falls back to GET /api/items if the Worker lacks it)
//   push: POST {WORKER}/api/sync/ingest  {items:[…]}   (edits made on the vault UI, e.g. applied triage)
// "tunnel" mode adds a cloudflared container; the Worker then also calls the vault directly
// (POST /api/sync/ingest here, and reads older-than-hot history). Both modes can run together.
import { getState, setState, pool } from './db.js'
import { upsertItem, toItem } from './items.js'

const WORKER = (process.env.WORKER_URL || '').replace(/\/+$/, '').replace(/\/api$/, '')
const TOKEN = process.env.SYNC_TOKEN || ''
const headers = { 'Content-Type': 'application/json', ...(TOKEN && { Authorization: `Bearer ${TOKEN}` }) }

let warnedNoChanges = false
let warnedNoIngest = false

export async function pullFromEdge() {
  if (!WORKER) return 0
  const since = Number(await getState('edge_pull_since', '0'))
  let items
  const r = await fetch(`${WORKER}/api/sync/changes?since=${since}&limit=500`, { headers })
  if (r.ok) {
    items = (await r.json()).items || []
  } else if (r.status === 404) {
    if (!warnedNoChanges) console.warn('[sync] Worker has no /api/sync/changes yet; pulling /api/items (see integrations/worker)')
    warnedNoChanges = true
    const f = await fetch(`${WORKER}/api/items?limit=200`, { headers })
    if (!f.ok) throw new Error(`pull HTTP ${f.status}`)
    items = ((await f.json()).items || []).filter(i => Number(i.updated_at) > since)
  } else {
    throw new Error(`pull HTTP ${r.status}`)
  }
  let max = since
  for (const it of items) {
    await upsertItem(normalizeEdge(it), 'edge')
    max = Math.max(max, Number(it.updated_at) || 0)
  }
  if (max > since) await setState('edge_pull_since', max)
  return items.length
}

export async function pushToEdge() {
  if (!WORKER) return 0
  const since = Number(await getState('edge_push_since', '0'))
  const r = await pool.query(
    `SELECT * FROM items WHERE origin <> 'edge' AND updated_at > $1 ORDER BY updated_at ASC LIMIT 200`, [since])
  if (!r.rows.length) return 0
  const items = r.rows.map(toItem)
  const res = await fetch(`${WORKER}/api/sync/ingest`, { method: 'POST', headers, body: JSON.stringify({ items, source: 'vault' }) })
  if (res.status === 404) {
    if (!warnedNoIngest) console.warn('[sync] Worker has no /api/sync/ingest yet; vault edits stay local (see integrations/worker)')
    warnedNoIngest = true
    return 0
  }
  if (!res.ok) throw new Error(`push HTTP ${res.status}`)
  await setState('edge_push_since', Number(r.rows[r.rows.length - 1].updated_at))
  return items.length
}

/** Worker rows carry tags_json / metadata_json strings; the prompt extension may be nested. */
function normalizeEdge(it) {
  const out = { ...it }
  if (typeof out.tags_json === 'string') out.tags = safe(out.tags_json, [])
  if (typeof out.metadata_json === 'string') out.metadata = safe(out.metadata_json, {})
  if (out.prompt && typeof out.prompt.variables_json === 'string') out.prompt.variables = safe(out.prompt.variables_json, [])
  if (out.extension && !out.prompt && out.type === 'prompt') out.prompt = out.extension
  out.starred = !!out.starred
  return out
}

function safe(s, d) { try { return JSON.parse(s) } catch { return d } }

export function requireSyncToken(req) {
  if (!TOKEN) return true // LAN-only deployments may skip it; set it whenever the tunnel is on
  return req.headers.authorization === `Bearer ${TOKEN}`
}
