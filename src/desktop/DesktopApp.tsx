// ClipSync desktop: a standalone clipboard manager + prompt library. Everything is stored on this
// PC; nothing here needs the Cloudflare API. (The PWA in src/App.tsx is a separate app.)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clipboard, Terminal, Settings, Pin, Trash2, Copy, Plus, Upload, FolderOpen, Folder, ShieldAlert, BookmarkPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { local, score, type LocalItem } from '@/lib/local'
import { getDesktopConfig, onDesktopEvent, setDesktopConfig, type DesktopConfig } from '@/lib/desktop'
import { parseMarkdownPrompts, type ImportedPrompt } from '@/lib/library'

type Tab = 'clips' | 'library' | 'settings'

export function DesktopApp() {
  const [tab, setTab] = useState<Tab>('clips')
  const [items, setItems] = useState<LocalItem[]>([])

  const load = useCallback(async () => {
    try {
      setItems(await local.list({ limit: 5000 }))
    } catch (e) {
      toast.error(String(e))
    }
  }, [])

  useEffect(() => {
    load()
    let un = () => {}
    onDesktopEvent('clip-captured', () => load()).then(u => (un = u))
    return () => un()
  }, [load])

  const tabs: { id: Tab; label: string; icon: typeof Clipboard }[] = [
    { id: 'clips', label: 'Clipboard', icon: Clipboard },
    { id: 'library', label: 'Library', icon: Terminal },
    { id: 'settings', label: 'Settings', icon: Settings },
  ]

  return (
    <div className="dark flex h-screen flex-col bg-background text-foreground">
      <nav className="flex items-center gap-1 border-b px-3 py-2">
        <span className="mr-3 font-semibold">ClipSync</span>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm', tab === t.id ? 'bg-accent' : 'text-muted-foreground hover:bg-accent/50')}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">Ctrl+Shift+Space opens the picker</span>
      </nav>
      <main className="flex-1 overflow-auto p-4">
        {tab === 'clips' && <ClipsTab items={items.filter(i => i.kind === 'clip')} reload={load} />}
        {tab === 'library' && <LibraryTab items={items.filter(i => i.kind === 'prompt')} reload={load} />}
        {tab === 'settings' && <SettingsTab reload={load} />}
      </main>
      <Toaster position="bottom-right" />
    </div>
  )
}

function ClipsTab({ items, reload }: { items: LocalItem[]; reload: () => void }) {
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState<LocalItem | null>(null)
  const shown = useMemo(() => (q ? items.filter(i => score(i, q) > 0) : items), [items, q])

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex gap-2">
        <Input autoFocus placeholder={`Search ${items.length} clips…`} value={q} onChange={e => setQ(e.target.value)} />
        <Button variant="outline" onClick={async () => {
          if (!confirm('Delete all unpinned clips?')) return
          const n = await local.clearClips(); toast.success(`Cleared ${n} clips`); reload()
        }}>Clear</Button>
      </div>
      {shown.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">Copy something and it shows up here.</p>}
      {shown.map(it => (
        <div key={it.id} className="group flex items-start gap-2 rounded-lg border p-2.5 hover:bg-accent/40">
          <pre className="max-h-24 flex-1 overflow-hidden whitespace-pre-wrap break-words font-sans text-sm">{it.content}</pre>
          <div className="flex shrink-0 items-center gap-0.5">
            {it.masked && <span title="Secrets were masked before saving"><ShieldAlert className="mr-1 h-4 w-4 text-amber-500" /></span>}
            <span className="mr-1 text-[10px] text-muted-foreground">{new Date(it.updated_at).toLocaleString()}</span>
            <IconBtn title="Copy" onClick={async () => { await local.copy(it.content); toast.success('Copied') }}><Copy /></IconBtn>
            <IconBtn title="Save to library" onClick={() => setSaving(it)}><BookmarkPlus /></IconBtn>
            <IconBtn title={it.pinned ? 'Unpin' : 'Pin (never auto-deleted)'} active={it.pinned} onClick={async () => { await local.setPinned(it.id, !it.pinned); reload() }}><Pin /></IconBtn>
            <IconBtn title="Delete" onClick={async () => { await local.remove(it.id); reload() }}><Trash2 /></IconBtn>
          </div>
        </div>
      ))}
      {saving && (
        <PromptDialog
          initial={{ id: 0, kind: 'prompt', title: saving.content.split('\n')[0].slice(0, 60), content: saving.content, folder: '', tags: [] }}
          onClose={() => setSaving(null)} onSaved={reload} />
      )}
    </div>
  )
}

function LibraryTab({ items, reload }: { items: LocalItem[]; reload: () => void }) {
  const [q, setQ] = useState('')
  const [folder, setFolder] = useState('')
  const [tag, setTag] = useState('')
  const [editing, setEditing] = useState<Partial<LocalItem> | null>(null)
  const [importing, setImporting] = useState<ImportedPrompt[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)

  const folders = useMemo(() => {
    const c = new Map<string, number>()
    for (const it of items) {
      const parts = it.folder.split('/').filter(Boolean)
      for (let i = 1; i <= parts.length; i++) {
        const k = parts.slice(0, i).join('/')
        c.set(k, (c.get(k) || 0) + 1)
      }
    }
    return [...c.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [items])
  const tags = useMemo(() => {
    const c = new Map<string, number>()
    items.forEach(i => i.tags.forEach(t => c.set(t, (c.get(t) || 0) + 1)))
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
  }, [items])

  const shown = useMemo(() => items
    .filter(i => (!folder || i.folder === folder || i.folder.startsWith(folder + '/')) && (!tag || i.tags.includes(tag)))
    .map(i => ({ i, s: score(i, q) })).filter(r => r.s > 0)
    .sort((a, b) => (q ? b.s - a.s : 0) || Number(b.i.pinned) - Number(a.i.pinned) || a.i.title.localeCompare(b.i.title))
    .map(r => r.i), [items, folder, tag, q])

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const out: ImportedPrompt[] = []
    for (const f of Array.from(files)) {
      if (/\.(md|markdown|txt)$/i.test(f.name)) out.push(...parseMarkdownPrompts(f.name, await f.text(), (f as File & { webkitRelativePath?: string }).webkitRelativePath || ''))
    }
    if (out.length) setImporting(out)
    else toast.error('No prompts found in those files')
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row">
      <aside className="shrink-0 space-y-0.5 text-sm md:w-52">
        <button onClick={() => setFolder('')} className={cn('flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-accent', !folder && 'bg-accent font-medium')}>
          <Folder className="h-4 w-4" /> All <span className="ml-auto text-xs text-muted-foreground">{items.length}</span>
        </button>
        {folders.map(([f, n]) => (
          <button key={f} onClick={() => setFolder(f)} style={{ paddingLeft: 8 + (f.split('/').length - 1) * 12 }}
            className={cn('flex w-full items-center gap-2 rounded py-1 pr-2 hover:bg-accent', folder === f && 'bg-accent font-medium')}>
            <Folder className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{f.split('/').pop()}</span>
            <span className="ml-auto text-xs text-muted-foreground">{n}</span>
          </button>
        ))}
      </aside>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input className="min-w-48 flex-1" placeholder="Search prompts, snippets, templates…" value={q} onChange={e => setQ(e.target.value)} />
          <input ref={fileRef} type="file" accept=".md,.markdown,.txt" multiple hidden onChange={e => { onFiles(e.target.files); e.target.value = '' }} />
          <input ref={dirRef} type="file" hidden onChange={e => { onFiles(e.target.files); e.target.value = '' }} {...({ webkitdirectory: '' } as object)} />
          <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="mr-2 h-4 w-4" />Import .md</Button>
          <Button variant="outline" onClick={() => dirRef.current?.click()}><FolderOpen className="mr-2 h-4 w-4" />Import folder</Button>
          <Button onClick={() => setEditing({ id: 0, kind: 'prompt', title: '', content: '', folder, tags: [] })}><Plus className="mr-2 h-4 w-4" />New</Button>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map(([t, n]) => (
              <Badge key={t} variant={tag === t ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setTag(tag === t ? '' : t)}>
                {t} <span className="ml-1 opacity-60">{n}</span>
              </Badge>
            ))}
          </div>
        )}
        {shown.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">No prompts here yet. Create one, import markdown, or save a clip.</p>}
        {shown.map(it => (
          <div key={it.id} className="rounded-lg border p-2.5 hover:bg-accent/40">
            <div className="flex items-center gap-2">
              <button className="flex-1 truncate text-left text-sm font-medium" onClick={() => setEditing(it)}>{it.title || 'Untitled'}</button>
              {it.folder && <span className="text-xs text-muted-foreground">{it.folder}</span>}
              <IconBtn title="Copy" onClick={async () => { await local.copy(it.content); local.markUsed(it.id); toast.success('Copied') }}><Copy /></IconBtn>
              <IconBtn title="Pin" active={it.pinned} onClick={async () => { await local.setPinned(it.id, !it.pinned); reload() }}><Pin /></IconBtn>
              <IconBtn title="Delete" onClick={async () => { if (confirm(`Delete "${it.title}"?`)) { await local.remove(it.id); reload() } }}><Trash2 /></IconBtn>
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{it.content}</p>
          </div>
        ))}
      </div>

      {editing && <PromptDialog initial={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      <Dialog open={!!importing} onOpenChange={() => setImporting(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Import {importing?.length} prompt(s)</DialogTitle></DialogHeader>
          <div className="max-h-[50vh] space-y-1 overflow-auto text-sm">
            {importing?.map((p, i) => (
              <div key={i} className="rounded border px-2 py-1">
                <div className="font-medium">{p.title}</div>
                <div className="text-xs text-muted-foreground">{p.folder}{p.tags.length ? ` · ${p.tags.join(', ')}` : ''}</div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImporting(null)}>Cancel</Button>
            <Button onClick={async () => {
              for (const p of importing || []) await local.save({ title: p.title, content: p.template, folder: p.folder, tags: p.tags })
              toast.success(`Imported ${importing?.length}`); setImporting(null); reload()
            }}>Import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PromptDialog({ initial, onClose, onSaved }: { initial: Partial<LocalItem>; onClose: () => void; onSaved: () => void }) {
  const [it, setIt] = useState(initial)
  const [tags, setTags] = useState((initial.tags || []).join(', '))
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{it.id ? 'Edit' : 'New'} prompt</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Title" value={it.title || ''} onChange={e => setIt({ ...it, title: e.target.value })} />
          <Textarea className="min-h-[180px] font-mono" placeholder="Text to paste. Use {{name}} for blanks you fill in when pasting."
            value={it.content || ''} onChange={e => setIt({ ...it, content: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Folder, e.g. writing/email" value={it.folder || ''} onChange={e => setIt({ ...it, folder: e.target.value })} />
            <Input placeholder="Tags, comma separated" value={tags} onChange={e => setTags(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            if (!it.content?.trim()) return toast.error('Text is required')
            await local.save({ ...it, kind: 'prompt', folder: (it.folder || '').trim().replace(/^\/+|\/+$/g, ''), tags: tags.split(',').map(t => t.trim()).filter(Boolean) })
            toast.success('Saved'); onSaved(); onClose()
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SettingsTab({ reload }: { reload: () => void }) {
  const [cfg, setCfg] = useState<DesktopConfig | null>(null)
  const [draft, setDraft] = useState({ hotkey: '', api_url: '', max_clips: '' })
  useEffect(() => {
    getDesktopConfig().then(c => {
      setCfg(c)
      if (c) setDraft({ hotkey: c.hotkey, api_url: c.api_url, max_clips: String(c.max_clips) })
    })
  }, [])
  if (!cfg) return null
  const save = async (patch: Partial<DesktopConfig>) => {
    try { const n = await setDesktopConfig(patch); if (n) setCfg(n); toast.success('Saved'); reload() } catch (e) { toast.error(String(e)) }
  }
  const row = 'flex items-center justify-between gap-4 py-2'
  return (
    <div className="mx-auto max-w-xl divide-y">
      <div className={row}><Label>Capture clipboard</Label><Switch checked={cfg.capture_enabled} onCheckedChange={v => save({ capture_enabled: v })} /></div>
      <div className={row}><Label>Start with Windows</Label><Switch checked={cfg.autostart} onCheckedChange={v => save({ autostart: v })} /></div>
      <div className={row}>
        <Label>Picker hotkey</Label>
        <div className="flex gap-2"><Input className="w-48" value={draft.hotkey} onChange={e => setDraft({ ...draft, hotkey: e.target.value })} /><Button variant="outline" onClick={() => save({ hotkey: draft.hotkey })}>Set</Button></div>
      </div>
      <div className={row}>
        <Label>Clips to keep</Label>
        <div className="flex gap-2"><Input className="w-28" type="number" value={draft.max_clips} onChange={e => setDraft({ ...draft, max_clips: e.target.value })} /><Button variant="outline" onClick={() => save({ max_clips: Number(draft.max_clips) })}>Set</Button></div>
      </div>
      <div className="space-y-2 py-3">
        <div className="flex items-center justify-between"><Label>Also send clips to a server (optional)</Label><Switch checked={cfg.sync_enabled} onCheckedChange={v => save({ sync_enabled: v })} /></div>
        <p className="text-xs text-muted-foreground">Off by default. Everything already works without it. Secrets are masked either way.</p>
        {cfg.sync_enabled && (
          <div className="flex gap-2"><Input placeholder="https://…/api" value={draft.api_url} onChange={e => setDraft({ ...draft, api_url: e.target.value })} /><Button variant="outline" onClick={() => save({ api_url: draft.api_url })}>Set</Button></div>
        )}
      </div>
      <p className="pt-3 text-xs text-muted-foreground">Data is stored on this PC only. Device: {cfg.device_id}</p>
    </div>
  )
}

function IconBtn({ children, title, onClick, active }: { children: React.ReactElement; title: string; onClick: () => void; active?: boolean }) {
  return (
    <Button variant="ghost" size="icon" title={title} onClick={onClick} className={cn('h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5', active && 'text-primary')}>
      {children}
    </Button>
  )
}
