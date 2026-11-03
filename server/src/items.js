import { randomUUID } from 'node:crypto'
import { pool, hasVector } from './db.js'
import { maskSecrets } from './secrets.js'

const COLS = 'id, type, title, content, folder, tags, starred, metadata, prompt, user_id, origin, created_at, updated_at, deleted_at'

/** Row → the item shape the React app expects (same as the Worker returns after transform). */
export function toItem(r) {
  if (!r) return null
  const item = {
    id: r.id, type: r.type, title: r.title, content: r.content, content_storage: 'inline',
    folder: r.folder, tags: r.tags || [], starred: r.starred, metadata: r.metadata || {},
    user_id: r.user_id, created_at: Number(r.created_at), updated_at: Number(r.updated_at),
  }
  if (r.prompt) item.prompt = { item_id: r.id, ...r.prompt }
  if (r.deleted_at) item.deleted_at = Number(r.deleted_at)
  return item
}

export const templateVars = t => [...new Set((String(t || '').match(/\{\{(\w+)\}\}/g) || []).map(v => v.slice(2, -2)))]

export async function listItems({ type, folder, starred, q, limit = 100, cursor, tags, since, includeDeleted } = {}) {
  const where = []
  const args = []
  const p = v => { args.push(v); return `$${args.length}` }
  if (!includeDeleted) where.push('deleted_at IS NULL')
  if (type) where.push(`type = ${p(type)}`)
  if (folder) where.push(`(folder = ${p(folder)} OR folder LIKE ${p(folder + '/%')})`)
  if (starred !== undefined) where.push(`starred = ${p(starred)}`)
  if (tags?.length) where.push(`tags @> ${p(tags)}`)
  if (since) where.push(`updated_at > ${p(Number(since))}`)
  if (cursor) where.push(`updated_at < ${p(Number(cursor))}`)
  let order = since ? 'updated_at ASC' : 'updated_at DESC'
  if (q) {
    const qp = p(q)
    where.push(`(fts @@ websearch_to_tsquery('english', ${qp}) OR title ILIKE ${p('%' + q + '%')})`)
    order = `ts_rank(fts, websearch_to_tsquery('english', ${qp})) DESC, ${order}`
  }
  const lim = Math.min(Number(limit) || 100, 1000)
  const r = await pool.query(
    `SELECT ${COLS} FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ${lim + 1}`, args)
  const rows = r.rows.slice(0, lim)
  return {
    items: rows.map(toItem),
    next_cursor: r.rows.length > lim && !since ? String(rows[rows.length - 1].updated_at) : null,
  }
}

export async function getItem(id) {
  const r = await pool.query(`SELECT ${COLS} FROM items WHERE id = $1`, [id])
  return toItem(r.rows[0])
}

/**
 * Insert or update. Last write wins on updated_at, so replaying a sync batch is harmless.
 * Content is masked here too: the vault never stores a secret in plain text.
 */
export async function upsertItem(input, origin = 'vault') {
  const now = Date.now()
  const type = input.type || 'clip'
  const raw = type === 'prompt' ? (input.prompt?.template ?? input.template ?? input.content ?? '') : (input.content ?? '')
  const m = maskSecrets(raw)
  const metadata = { ...(input.metadata || {}) }
  if (m.masked) {
    metadata.masked = true
    metadata.secrets = [...new Set([...(metadata.secrets || []), ...m.found])]
  }
  const prompt = type === 'prompt'
    ? { template: m.text, variables: input.prompt?.variables ?? templateVars(m.text), shortcut: input.prompt?.shortcut ?? input.shortcut ?? null }
    : null
  const tags = Array.isArray(input.tags) ? input.tags : safeJson(input.tags_json, [])
  const row = [
    input.id || randomUUID(), type, input.title || '', m.text,
    input.folder || '', tags, !!input.starred, metadata, prompt, input.user_id || 'default', origin,
    Number(input.created_at) || now, Number(input.updated_at) || now, input.deleted_at ? Number(input.deleted_at) : null,
  ]
  // A changed body invalidates its embedding; the background job re-embeds it.
  const resetEmbedding = hasVector ? ', embedding = CASE WHEN items.content = EXCLUDED.content THEN items.embedding ELSE NULL END' : ''
  const r = await pool.query(
    `INSERT INTO items (${COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO UPDATE SET
       type = EXCLUDED.type, title = EXCLUDED.title, content = EXCLUDED.content, folder = EXCLUDED.folder,
       tags = EXCLUDED.tags, starred = EXCLUDED.starred, metadata = EXCLUDED.metadata, prompt = EXCLUDED.prompt,
       updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at${resetEmbedding}
     WHERE items.updated_at <= EXCLUDED.updated_at
     RETURNING ${COLS}`, row)
  // No row back = the stored copy is newer; return that one.
  return r.rows[0] ? toItem(r.rows[0]) : getItem(row[0])
}

/** PATCH semantics: merge onto the stored item, bump updated_at. */
export async function patchItem(id, patch) {
  const cur = await getItem(id)
  if (!cur) return null
  const next = { ...cur, ...patch, metadata: { ...cur.metadata, ...(patch.metadata || {}) }, updated_at: Date.now() }
  if (cur.type === 'prompt') {
    const template = patch.template ?? patch.content ?? cur.prompt?.template ?? cur.content
    next.prompt = {
      ...cur.prompt,
      template,
      variables: patch.variables ?? templateVars(template),
      shortcut: patch.shortcut !== undefined ? patch.shortcut : cur.prompt?.shortcut,
    }
    next.content = template
  }
  return upsertItem(next, cur.origin)
}

export async function deleteItem(id) {
  const now = Date.now()
  await pool.query('UPDATE items SET deleted_at = $2, updated_at = $2 WHERE id = $1', [id, now])
}

function safeJson(s, d) { try { return JSON.parse(s) } catch { return d } }
