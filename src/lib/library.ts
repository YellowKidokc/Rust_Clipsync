import type { Item } from '@/types'

/** Text a prompt-library entry pastes. */
export function bodyOf(item: Item & { prompt?: { template?: string } }): string {
  return item.prompt?.template || item.content || ''
}

/** Fuzzy score for the picker: prefix/word hits on title & shortcut beat body substrings. 0 = no match. */
export function fuzzyScore(item: Item & { prompt?: { shortcut?: string; template?: string } }, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const title = (item.title || '').toLowerCase()
  const shortcut = (item.prompt?.shortcut || '').toLowerCase()
  const folder = (item.folder || '').toLowerCase()
  const tags = (item.tags || []).join(' ').toLowerCase()
  const body = bodyOf(item).toLowerCase()
  let score = 0
  for (const term of q.split(/\s+/)) {
    let s = 0
    if (shortcut === term) s = 100
    else if (title.startsWith(term)) s = 60
    else if (title.split(/[\s/_-]+/).some(w => w.startsWith(term))) s = 45
    else if (title.includes(term)) s = 30
    else if (tags.includes(term) || folder.includes(term)) s = 20
    else if (body.includes(term)) s = 8
    else if (isSubsequence(term, title)) s = 5
    if (!s) return 0 // every term must hit something
    score += s
  }
  if (item.metadata?.pinned) score += 10
  if (item.starred) score += 5
  return score
}

function isSubsequence(needle: string, hay: string) {
  let i = 0
  for (const ch of hay) if (ch === needle[i] && ++i === needle.length) return true
  return false
}

/** Folder tree from "a/b/c" style folder paths, with counts per node (including descendants). */
export function folderCounts(items: Item[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const it of items) {
    const parts = (it.folder || '').split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) {
      const key = parts.slice(0, i).join('/')
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }
  return counts
}

export interface ImportedPrompt { title: string; template: string; folder: string; tags: string[]; shortcut?: string }

/**
 * Markdown import. One file can hold one prompt or many:
 *  - YAML-ish frontmatter (title, folder, tags, shortcut) applies to the whole file.
 *  - If the body has `## ` headings, each heading becomes its own prompt (heading = title).
 *  - Otherwise the file is one prompt titled by its first `# ` heading or the file name.
 *  - Folder defaults to the file's relative directory (from a folder upload) or "imported".
 */
export function parseMarkdownPrompts(fileName: string, text: string, relPath = ''): ImportedPrompt[] {
  let body = text.replace(/\r\n/g, '\n')
  const meta: Record<string, string> = {}
  const fm = body.match(/^---\n([\s\S]*?)\n---\n?/)
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^(\w+)\s*:\s*(.*)$/)
      if (m) meta[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '')
    }
    body = body.slice(fm[0].length)
  }
  const dir = relPath.split('/').slice(1, -1).join('/') // drop the picked root dir and the file name
  const folder = meta.folder || dir || 'imported'
  const tags = (meta.tags || '').replace(/[[\]]/g, '').split(',').map(t => t.trim()).filter(Boolean)
  const base = fileName.replace(/\.(md|markdown|txt)$/i, '')

  const sections = body.split(/^## +/m)
  if (sections.length > 1) {
    const out: ImportedPrompt[] = []
    for (const sec of sections.slice(1)) {
      const nl = sec.indexOf('\n')
      const title = (nl < 0 ? sec : sec.slice(0, nl)).trim()
      const template = stripFence(nl < 0 ? '' : sec.slice(nl + 1)).trim()
      if (template) out.push({ title, template, folder, tags: [...new Set([...tags, slug(base)])] })
    }
    if (out.length) return out
  }
  const h1 = body.match(/^# +(.+)$/m)
  const template = stripFence(h1 ? body.replace(h1[0], '') : body).trim()
  if (!template) return []
  return [{ title: meta.title || h1?.[1].trim() || base, template, folder, tags, shortcut: meta.shortcut }]
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** If a section is just one fenced block, paste the inside of it. */
function stripFence(s: string) {
  const m = s.trim().match(/^```[\w-]*\n([\s\S]*?)\n```$/)
  return m ? m[1] : s
}

/** Fill {{variables}}; unknown ones are left in place. */
export function fillTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (all, k) => (k in vars ? vars[k] : all))
}
