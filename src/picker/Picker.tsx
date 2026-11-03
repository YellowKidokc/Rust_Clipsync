import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clipboard, Terminal, Pin, Settings2, ShieldAlert } from 'lucide-react'
import { local, score, templateVars, fill as fillTemplate, type LocalItem } from '@/lib/local'
import { hidePicker, onDesktopEvent, openMainWindow, pasteText } from '@/lib/desktop'
import { cn } from '@/lib/utils'

type Tab = 'all' | 'prompts' | 'clips'
type Entry = LocalItem
const bodyOf = (it: Entry) => it.content

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'clips', label: 'Clips' },
]

/**
 * The hotkey picker (Ctrl+Shift+Space). Type a few characters, Enter pastes into the app that
 * had focus. Tab cycles All/Prompts/Clips, Ctrl+1..9 pastes the Nth row, Esc closes.
 * Everything comes from the local store; no network.
 */
export function Picker() {
  const [prompts, setPrompts] = useState<Entry[]>([])
  const [clips, setClips] = useState<Entry[]>([])
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [sel, setSel] = useState(0)
  const [error, setError] = useState('')
  const [fill, setFill] = useState<{ item: Entry; vars: string[]; values: Record<string, string> } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([local.list({ kind: 'prompt', limit: 2000 }), local.list({ kind: 'clip', limit: 300 })])
      setPrompts(p)
      setClips(c)
      setError('')
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }, [])

  const reset = useCallback(() => {
    setQuery(''); setSel(0); setFill(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  useEffect(() => {
    load()
    let un1 = () => {}, un2 = () => {}
    onDesktopEvent('picker-shown', () => { reset(); load() }).then(u => (un1 = u))
    onDesktopEvent('clip-captured', () => load()).then(u => (un2 = u))
    window.addEventListener('focus', () => inputRef.current?.focus())
    return () => { un1(); un2() }
  }, [load, reset])

  const results = useMemo(() => {
    const q = query
    const pool = tab === 'prompts' ? prompts : tab === 'clips' ? clips : [...prompts, ...clips]
    return pool
      .map((it, i) => ({ it, s: score(it, q), i }))
      .filter(r => r.s > 0)
      .sort((a, b) => b.s - a.s || (b.it.updated_at || b.it.created_at || 0) - (a.it.updated_at || a.it.created_at || 0) || a.i - b.i)
      .slice(0, 50)
      .map(r => r.it)
  }, [query, tab, prompts, clips])

  useEffect(() => { setSel(0) }, [query, tab])
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const choose = useCallback(async (item: Entry | undefined) => {
    if (!item) return
    const body = bodyOf(item)
    const vars = item.kind === 'prompt' ? templateVars(body) : []
    local.markUsed(item.id).catch(() => {})
    if (vars.length) {
      setFill({ item, vars, values: Object.fromEntries(vars.map(v => [v, ''])) })
      return
    }
    await pasteText(body)
  }, [])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); if (fill) setFill(null); else hidePicker(); return }
    if (fill) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(results[sel]) }
    else if (e.key === 'Tab') {
      e.preventDefault()
      const i = TABS.findIndex(t => t.id === tab)
      setTab(TABS[(i + (e.shiftKey ? TABS.length - 1 : 1)) % TABS.length].id)
    } else if (e.ctrlKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); choose(results[Number(e.key) - 1]) }
  }

  return (
    <div className="dark h-screen w-screen p-1.5 select-none" onKeyDown={onKey}>
      <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-zinc-900/95 text-zinc-100 shadow-2xl backdrop-blur">
        <div data-tauri-drag-region className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <Terminal className="h-4 w-4 text-zinc-400" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Type to find a clip or prompt…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-500"
          />
          <button title="Open ClipSync" onClick={() => openMainWindow()} className="text-zinc-500 hover:text-zinc-200">
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
        <div className="flex gap-1 px-2 pt-1.5 text-xs">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn('rounded px-2 py-0.5', tab === t.id ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300')}>
              {t.label}
            </button>
          ))}
          <span className="ml-auto self-center text-[10px] text-zinc-500">{results.length}</span>
        </div>

        {fill ? (
          <form className="flex-1 space-y-2 overflow-auto p-3" onSubmit={async e => {
            e.preventDefault()
            await pasteText(fillTemplate(bodyOf(fill.item), fill.values))
          }}>
            <div className="text-xs text-zinc-400">Fill in <span className="text-zinc-200">{fill.item.title}</span></div>
            {fill.vars.map((v, i) => (
              <label key={v} className="block text-xs">
                <span className="text-zinc-400">{v}</span>
                <input autoFocus={i === 0} value={fill.values[v]}
                  onChange={e => setFill({ ...fill, values: { ...fill.values, [v]: e.target.value } })}
                  className="mt-0.5 w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-sm outline-none focus:border-violet-500" />
              </label>
            ))}
            <button className="w-full rounded bg-violet-600 py-1.5 text-sm hover:bg-violet-500">Paste ↵</button>
          </form>
        ) : (
          <div ref={listRef} className="flex-1 overflow-auto p-1.5">
            {error && <div className="p-3 text-xs text-red-400">{error}</div>}
            {!error && results.length === 0 && <div className="p-3 text-xs text-zinc-500">Nothing matches.</div>}
            {results.map((it, i) => (
              <button key={it.id} data-idx={i} onMouseEnter={() => setSel(i)} onClick={() => choose(it)}
                className={cn('flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left', i === sel ? 'bg-violet-600/30' : 'hover:bg-white/5')}>
                {it.kind === 'prompt' ? <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" /> : <Clipboard className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm">{it.title || bodyOf(it).slice(0, 60) || 'Untitled'}</span>
                    {it.pinned && <Pin className="h-3 w-3 shrink-0 text-violet-400" />}
                    {it.masked && <span title="Secrets were masked"><ShieldAlert className="h-3 w-3 shrink-0 text-amber-400" /></span>}
                  </div>
                  <div className="truncate text-xs text-zinc-500">
                    {it.folder ? `${it.folder} · ` : ''}{bodyOf(it).replace(/\s+/g, ' ').slice(0, 120)}
                  </div>
                </div>
                {i < 9 && <span className="mt-0.5 shrink-0 text-[10px] text-zinc-600">^{i + 1}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="border-t border-white/10 px-3 py-1 text-[10px] text-zinc-500">
          ↵ paste · ↑↓ move · Tab section · Ctrl+1-9 quick paste · Esc close
        </div>
      </div>
    </div>
  )
}
