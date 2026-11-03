// NAS-side AI: embeddings for meaning-based search, and the organizer that turns raw clipboard
// history and notes into prompt-library suggestions. Talks to Ollama on the LAN; nothing leaves home.
import { pool, hasVector } from './db.js'
import { getItem, upsertItem, toItem } from './items.js'

const OLLAMA = (process.env.OLLAMA_URL || 'http://192.168.1.177:11434').replace(/\/$/, '')
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text'
const TRIAGE_MODEL = process.env.TRIAGE_MODEL || 'qwen2.5:14b'

export async function embed(text) {
  const r = await fetch(`${OLLAMA}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: String(text).slice(0, 8000) }),
  })
  if (!r.ok) throw new Error(`ollama embed HTTP ${r.status}`)
  const j = await r.json()
  return j.embeddings?.[0] || j.embedding
}

const vec = v => `[${v.join(',')}]`

/** Embed items that have none yet. Secret-flagged items are skipped (and never sent to a model). */
export async function embedPending(batch = 32) {
  if (!hasVector) return 0
  const r = await pool.query(
    `SELECT id, title, content FROM items
     WHERE embedding IS NULL AND deleted_at IS NULL AND NOT (metadata ? 'secrets')
     ORDER BY updated_at DESC LIMIT $1`, [batch])
  for (const row of r.rows) {
    const v = await embed(`${row.title}\n${row.content}`)
    await pool.query('UPDATE items SET embedding = $2 WHERE id = $1', [row.id, vec(v)])
  }
  return r.rows.length
}

/** Meaning-based search; full-text ranking when pgvector or Ollama is not available. */
export async function semanticSearch(q, { type, limit = 20 } = {}) {
  const lim = Math.min(Number(limit) || 20, 100)
  if (hasVector) {
    try {
      const v = await embed(q)
      const r = await pool.query(
        `SELECT *, 1 - (embedding <=> $1) AS score FROM items
         WHERE deleted_at IS NULL AND embedding IS NOT NULL ${type ? 'AND type = $3' : ''}
         ORDER BY embedding <=> $1 LIMIT $2`, type ? [vec(v), lim, type] : [vec(v), lim])
      return { items: r.rows.map(row => ({ ...toItem(row), score: Number(row.score) })), mode: 'vector' }
    } catch (e) {
      console.warn('[ai] vector search failed, using full-text:', e.message)
    }
  }
  const r = await pool.query(
    `SELECT *, ts_rank(fts, websearch_to_tsquery('english', $1)) AS score FROM items
     WHERE deleted_at IS NULL AND fts @@ websearch_to_tsquery('english', $1) ${type ? 'AND type = $3' : ''}
     ORDER BY score DESC LIMIT $2`, type ? [q, lim, type] : [q, lim])
  return { items: r.rows.map(row => ({ ...toItem(row), score: Number(row.score) })), mode: 'fulltext' }
}

const TRIAGE_PROMPT = `You organize a personal clipboard and notes vault into a reusable library.
For the ITEM below decide what it is:
- "prompt": an instruction meant to be given to an AI model again
- "template": reusable text with blanks (email, reply, boilerplate); mark blanks as {{name}}
- "snippet": short reusable text or code (a command, a query, a signature)
- "note": worth keeping but not something to paste again
- "junk": throwaway (a single word, a stray URL fragment, an OTP, duplicate noise)
Pick a folder path of 1-3 levels, lowercase, slash-separated (e.g. "writing/email", "code/sql",
"research/theophysics"). Reuse one of EXISTING FOLDERS when it fits. Give 1-5 lowercase tags and a
short title. Reply with JSON only:
{"kind": "...", "title": "...", "folder": "...", "tags": ["..."], "template": "only for template: the text with {{blanks}}", "reason": "one sentence"}`

async function chatJson(system, user) {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TRIAGE_MODEL, stream: false, format: 'json',
      options: { temperature: 0.1 },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  })
  if (!r.ok) throw new Error(`ollama chat HTTP ${r.status}`)
  const j = await r.json()
  return JSON.parse(j.message?.content || '{}')
}

/**
 * Walk untriaged clips and notes, ask the model where each belongs, and store a suggestion.
 * Nothing is moved until a suggestion is applied (POST /api/triage/suggestions/:id/apply),
 * except with TRIAGE_AUTO_APPLY=1, which applies prompt/template/snippet suggestions directly.
 */
export async function organize({ batch = 20 } = {}) {
  const folders = (await pool.query(
    `SELECT folder, count(*) n FROM items WHERE type = 'prompt' AND folder <> '' AND deleted_at IS NULL
     GROUP BY folder ORDER BY n DESC LIMIT 60`)).rows.map(r => r.folder)
  const r = await pool.query(
    `SELECT * FROM items
     WHERE triaged_at IS NULL AND deleted_at IS NULL AND type IN ('clip', 'note')
       AND NOT (metadata ? 'secrets') AND length(content) BETWEEN 12 AND 20000
     ORDER BY updated_at DESC LIMIT $1`, [batch])
  let made = 0
  for (const row of r.rows) {
    try {
      const s = await chatJson(TRIAGE_PROMPT,
        `EXISTING FOLDERS: ${folders.join(', ') || '(none yet)'}\n\nITEM (${row.type}, title "${row.title}"):\n${row.content.slice(0, 6000)}`)
      const related = hasVector ? await relatedIds(row.id) : []
      await pool.query(
        `INSERT INTO triage_suggestions (item_id, kind, title, folder, tags, related_ids, reason, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [row.id, s.kind || 'note', s.title || row.title, s.folder || '', (s.tags || []).slice(0, 5), related,
          JSON.stringify({ reason: s.reason || '', template: s.template || null }), Date.now()])
      await pool.query('UPDATE items SET triaged_at = $2 WHERE id = $1', [row.id, Date.now()])
      made++
      if (process.env.TRIAGE_AUTO_APPLY === '1' && ['prompt', 'template', 'snippet'].includes(s.kind)) {
        const id = (await pool.query('SELECT max(id) id FROM triage_suggestions WHERE item_id = $1', [row.id])).rows[0].id
        await applySuggestion(id)
      }
    } catch (e) {
      console.warn(`[triage] ${row.id}: ${e.message}`)
    }
  }
  return made
}

async function relatedIds(id) {
  const r = await pool.query(
    `SELECT b.id FROM items a, items b
     WHERE a.id = $1 AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL AND b.id <> a.id AND b.deleted_at IS NULL
     ORDER BY a.embedding <=> b.embedding LIMIT 5`, [id])
  return r.rows.map(x => x.id)
}

export async function listSuggestions(status = 'pending', limit = 100) {
  const r = await pool.query(
    `SELECT s.*, i.content, i.type AS item_type FROM triage_suggestions s JOIN items i ON i.id = s.item_id
     WHERE s.status = $1 ORDER BY s.created_at DESC LIMIT $2`, [status, Math.min(limit, 500)])
  return r.rows.map(s => {
    let extra = {}
    try { extra = JSON.parse(s.reason || '{}') } catch { /* plain text */ }
    return { ...s, reason: extra.reason ?? s.reason, template: extra.template ?? null, created_at: Number(s.created_at) }
  })
}

/** Apply: library kinds become a prompt item (the source clip/note stays, linked); notes just get filed. */
export async function applySuggestion(id) {
  const [s] = await listSuggestionsById(id)
  if (!s) return null
  const src = await getItem(s.item_id)
  let result
  if (['prompt', 'template', 'snippet'].includes(s.kind)) {
    result = await upsertItem({
      type: 'prompt', title: s.title, folder: s.folder, tags: [...new Set([...s.tags, s.kind])],
      template: s.template || src.content, metadata: { source_item: src.id, triage: s.kind },
    })
  } else if (s.kind === 'junk') {
    result = await upsertItem({ ...src, tags: [...new Set([...src.tags, 'junk'])], updated_at: Date.now() })
  } else {
    result = await upsertItem({ ...src, folder: s.folder, title: src.title || s.title, tags: [...new Set([...src.tags, ...s.tags])], updated_at: Date.now() })
  }
  await pool.query(`UPDATE triage_suggestions SET status = 'applied' WHERE id = $1`, [id])
  return result
}

async function listSuggestionsById(id) {
  const r = await pool.query('SELECT * FROM triage_suggestions WHERE id = $1', [id])
  return r.rows.map(s => {
    let extra = {}
    try { extra = JSON.parse(s.reason || '{}') } catch { /* plain text */ }
    return { ...s, template: extra.template ?? null }
  })
}

export async function dismissSuggestion(id) {
  await pool.query(`UPDATE triage_suggestions SET status = 'dismissed' WHERE id = $1`, [id])
}
