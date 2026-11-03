// The desktop app's own data: clips and prompts in a SQLite file on this PC (src-tauri/src/store.rs).
import { invoke } from '@tauri-apps/api/core'

export interface LocalItem {
  id: number
  kind: 'clip' | 'prompt'
  title: string
  content: string
  folder: string
  tags: string[]
  pinned: boolean
  masked: boolean
  created_at: number
  updated_at: number
  uses: number
}

export const local = {
  list: (query: { kind?: 'clip' | 'prompt'; q?: string; folder?: string; limit?: number } = {}) =>
    invoke<LocalItem[]>('list_items', { query }),
  save: (item: Partial<LocalItem>) =>
    invoke<LocalItem>('save_item', { item: { id: 0, kind: 'prompt', title: '', content: '', folder: '', tags: [], pinned: false, ...item } }),
  remove: (id: number) => invoke<void>('delete_item', { id }),
  setPinned: (id: number, pinned: boolean) => invoke<void>('set_pinned', { id, pinned }),
  markUsed: (id: number) => invoke<void>('mark_used', { id }),
  clearClips: () => invoke<number>('clear_clips'),
  copy: (text: string) => invoke<void>('copy_text', { text }),
}

/** Fuzzy score for type-to-find. Title and folder hits beat body hits. 0 = no match. */
export function score(it: LocalItem, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const title = it.title.toLowerCase()
  const meta = `${it.folder} ${it.tags.join(' ')}`.toLowerCase()
  const body = it.content.toLowerCase()
  let s = 0
  for (const term of q.split(/\s+/)) {
    let t = 0
    if (title.startsWith(term)) t = 60
    else if (title.split(/[\s/_-]+/).some(w => w.startsWith(term))) t = 45
    else if (title.includes(term)) t = 30
    else if (meta.includes(term)) t = 20
    else if (body.includes(term)) t = 8
    if (!t) return 0
    s += t
  }
  return s + (it.pinned ? 10 : 0) + Math.min(it.uses, 20)
}

export const templateVars = (t: string) => [...new Set((t.match(/\{\{(\w+)\}\}/g) || []).map(v => v.slice(2, -2)))]
export const fill = (t: string, v: Record<string, string>) => t.replace(/\{\{(\w+)\}\}/g, (a, k) => (k in v ? v[k] : a))
