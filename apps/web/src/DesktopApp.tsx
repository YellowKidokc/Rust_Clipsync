import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Clipboard, File, Image, LockKeyhole, Pin, Search, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ThemeProvider } from '@/components/ThemeProvider'
import { cn } from '@/lib/utils'
import { desktop } from './desktop'
import type { Clip, Preview, Settings, Status, SyncStatus } from './desktop'

const popup = new URLSearchParams(location.search).has('popup')
const clipIcons = { text: Clipboard, image: Image, file: File }

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function SettingsForm({ initial, save }: { initial: Settings; save: (settings: Settings) => Promise<void> }) {
  const [settings, setSettings] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function edit<K extends keyof Settings>(name: K, value: Settings[K]) {
    setSaved(false)
    setSettings((current) => ({ ...current, [name]: value }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await save(settings)
      setSaved(true)
    } catch {
      // The shared status message displays the backend error.
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-xl space-y-5">
      <section className="space-y-3 rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">Capture</h2>
        {([
          ['paused', 'Pause capture'],
          ['text', 'Text'],
          ['images', 'Images'],
          ['files', 'Files'],
        ] as const).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings[key]} onChange={(event) => edit(key, event.target.checked)} />
            {label}
          </label>
        ))}
        <label className="block space-y-1 text-sm">
          <span>Maximum clip size (MiB)</span>
          <Input type="number" required min="1" max="64" value={settings.maxBytes / 1048576}
            onChange={(event) => edit('maxBytes', Number(event.target.value) * 1048576)} />
        </label>
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">AI</h2>
        <label className="block space-y-1 text-sm">
          <span>Local Ollama URL</span>
          <Input type="url" required value={settings.ollamaUrl} onChange={(event) => edit('ollamaUrl', event.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Installed model</span>
          <Input value={settings.model} placeholder="e.g. llama3.2" maxLength={256}
            onChange={(event) => edit('model', event.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Run</span>
          <select className="h-9 w-full rounded-md border bg-background px-3" defaultValue="manual">
            <option value="manual">Manual</option>
            <option disabled>Every N minutes</option>
            <option disabled>On every copy</option>
          </select>
        </label>
      </section>
      <div className="flex items-center gap-3">
        <Button disabled={saving}>Save settings</Button>
        {saved && <span role="status" className="text-sm text-muted-foreground">Settings saved</span>}
      </div>
    </form>
  )
}

function SyncSettings() {
  const [status, setStatus] = useState<SyncStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let mounted = true
    const refresh = () => desktop.syncStatus()
      .then((value) => { if (mounted) setStatus(value) })
      .catch((reason) => { if (mounted) setError(errorMessage(reason)) })
    void refresh()
    const listener = listen('sync-changed', refresh)
    return () => { mounted = false; void listener.then((unlisten) => unlisten()) }
  }, [])

  async function act(run: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await run()
      setStatus(await desktop.syncStatus())
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const origin = String(values.get('origin') ?? '')
    const key = String(values.get('key') ?? '')
    const token = String(values.get('token') ?? '')
    form.reset()
    void act(async () => {
      await desktop.configureSync(origin, key, token)
      setEditing(false)
    })
  }

  return (
    <section className="mx-auto mt-5 w-full max-w-xl space-y-3 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Encrypted sync</h2>
      {status?.connected && !editing ? (
        <>
          <p role="status" className="text-sm text-muted-foreground">
            {status.paused ? 'Sync is paused. Changes will queue on this device.' : 'Sync is enabled.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => desktop.pauseSync(!status.paused))}>
              {status.paused ? 'Resume sync' : 'Pause sync'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(true)}>Update credentials</Button>
          </div>
        </>
      ) : status && (
        <form className="space-y-3" onSubmit={submit}>
          <p className="text-sm text-muted-foreground">Connecting sync uploads your current non-secret history to the relay as ciphertext.</p>
          <label className="block space-y-1 text-sm">
            <span>Relay origin</span>
            <Input name="origin" type="url" required placeholder="https://your-relay.workers.dev" />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Shared sync key</span>
            <Input name="key" type="password" required minLength={70} maxLength={70} autoComplete="off" />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Device token</span>
            <Input name="token" type="password" required minLength={70} maxLength={70} autoComplete="off" />
          </label>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy}>{busy ? 'Connecting…' : 'Connect and sync'}</Button>
            {editing && <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>}
          </div>
        </form>
      )}
      {(error || status?.error) && <p role="alert" className="text-sm text-red-400">{error || status?.error}</p>}
    </section>
  )
}

function ClipPreview({ preview }: { preview: Preview | null }) {
  if (!preview) return <p className="text-sm text-muted-foreground">Select a clip to preview it.</p>
  switch (preview.kind) {
    case 'text':
      return <pre className="whitespace-pre-wrap break-words text-sm">{preview.value}</pre>
    case 'image':
      return <img src={preview.value} alt="Clipboard image" className="max-w-full rounded-md object-contain" />
    case 'file':
      return <ul className="space-y-2 break-words text-sm">{preview.value.map((name, index) => <li key={index}>{name}</li>)}</ul>
    case 'secret':
      return <p className="flex items-center gap-2 text-sm text-muted-foreground"><LockKeyhole size={16} /> Secret content is masked.</p>
  }
}

function DesktopContent() {
  const [status, setStatus] = useState<Status>()
  const [view, setView] = useState<'history' | 'settings'>('history')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ query: string; clips: Clip[] }>()
  const clips = results?.query === query ? results.clips : []
  const [selected, setSelected] = useState('')
  const [display, setDisplay] = useState<{ id: string; preview: Preview }>()
  const [version, setVersion] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [deleting, setDeleting] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const active = clips.find((clip) => clip.id === selected) ?? clips[0]

  useEffect(() => {
    let mounted = true
    const refresh = () => desktop.status().then((next) => { if (mounted) setStatus(next) })
      .catch((reason) => { if (mounted) setError(errorMessage(reason)) })
    void refresh()
    const listeners = [
      listen('clips-changed', () => setVersion((current) => current + 1)),
      listen('vault-ready', refresh),
      listen('settings-changed', refresh),
      listen('capture-error', refresh),
    ]
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        void desktop.dismiss().catch((reason) => setError(errorMessage(reason)))
      }
    }
    if (popup) {
      window.addEventListener('keydown', dismissOnEscape)
      listeners.push(getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (focused) {
          input.current?.focus()
          input.current?.select()
        }
      }))
    }
    return () => {
      mounted = false
      if (popup) window.removeEventListener('keydown', dismissOnEscape)
      for (const listener of listeners) void listener.then((unlisten) => unlisten())
    }
  }, [])

  useEffect(() => {
    if (!status?.ready) return
    let stale = false
    void desktop.search(query).then((items) => { if (!stale) setResults({ query, clips: items }) })
      .catch((reason) => { if (!stale) setError(errorMessage(reason)) })
    return () => { stale = true }
  }, [query, status?.ready, version])

  const activeId = active?.id
  useEffect(() => {
    if (!activeId) return
    let stale = false
    void desktop.preview(activeId).then((preview) => { if (!stale) setDisplay({ id: activeId, preview }) })
      .catch((reason) => { if (!stale) setError(errorMessage(reason)) })
    return () => { stale = true }
  }, [activeId])

  async function act(action: string, run: () => Promise<void>) {
    setError('')
    setBusy(action)
    try {
      await run()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy('')
    }
  }

  function copy(clip: Clip) {
    void act('copy', () => desktop.copy(clip.id, popup))
  }

  function keys(event: KeyboardEvent<HTMLElement>) {
    if (!popup || event.defaultPrevented) return
    if (event.key === 'Escape') {
      event.preventDefault()
      if (deleting) setDeleting('')
      else void desktop.dismiss().catch((reason) => setError(errorMessage(reason)))
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!clips.length) return
      event.preventDefault()
      const index = clips.findIndex((clip) => clip.id === active?.id)
      const next = Math.max(0, Math.min(clips.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
      setSelected(clips[next].id)
      document.getElementById(clips[next].id)?.scrollIntoView({ block: 'nearest' })
      return
    }
    if (busy) return
    if (event.key === 'Enter' && active && (event.target === input.current || event.target === event.currentTarget)) {
      event.preventDefault()
      copy(active)
    }
    const digit = /^(?:Digit|Numpad)([1-5])$/.exec(event.code)?.[1]
    if ((event.altKey || event.target !== input.current) && digit) {
      const clip = clips[Number(digit) - 1]
      if (clip) {
        event.preventDefault()
        copy(clip)
      }
    }
  }

  if (!status?.ready) {
    return (
      <main className="flex h-screen items-center justify-center p-6" onKeyDown={keys}>
        <section className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6">
          <LockKeyhole className="text-muted-foreground" />
          <h1 className="text-xl font-semibold">ClipSync vault</h1>
          {status ? (
            popup ? <p className="text-sm text-muted-foreground">Open the main ClipSync window to set up or unlock your vault.</p> : (
              <form className="space-y-3" onSubmit={(event) => {
                event.preventDefault()
                const form = event.currentTarget
                const passphrase = String(new FormData(form).get('passphrase') ?? '')
                form.reset()
                void act('initialize', () => desktop.initialize(passphrase))
              }}>
                {status.error ? (
                  <Button disabled={!!busy}>Retry opening vault</Button>
                ) : (
                  <>
                    <label className="block space-y-2 text-sm">
                      <span>Choose a passphrase (12 characters or more)</span>
                      <Input name="passphrase" autoComplete="new-password" type="password" minLength={12} required />
                    </label>
                    <Button disabled={!!busy}>{busy ? 'Creating vault…' : 'Create vault'}</Button>
                  </>
                )}
              </form>
            )
          ) : <p className="text-sm text-muted-foreground">Opening vault…</p>}
          {(error || status?.error) && <p role="alert" className="text-sm text-red-400">{error || status?.error}</p>}
        </section>
      </main>
    )
  }

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-background" onKeyDown={keys}>
      {!popup && (
        <aside className="flex w-44 shrink-0 flex-col border-r bg-card sm:w-56">
          <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
            <Clipboard size={30} className="rounded-lg bg-primary p-2 text-primary-foreground" />
            ClipSync
          </div>
          <nav aria-label="ClipSync" className="flex flex-1 flex-col gap-1 p-2">
            <Button className="justify-start" variant={view === 'history' ? 'default' : 'ghost'}
              onClick={() => { setError(''); setView('history') }}><Clipboard /> Clipboard</Button>
            <Button className="mt-auto justify-start" variant={view === 'settings' ? 'default' : 'ghost'}
              onClick={() => { setError(''); setView('settings') }}><Settings2 /> Settings</Button>
          </nav>
        </aside>
      )}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {(!popup || status.captureError || error) && (
          <header className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
            {!popup && <h1 className="font-semibold">{view === 'history' ? 'Clipboard history' : 'Settings'}</h1>}
            {error || status.captureError ? <p role="alert" className="text-sm text-red-400">{error || status.captureError}</p> : (
              <span className="text-xs text-muted-foreground">{status.settings.paused ? 'Capture paused' : 'Capturing locally'}</span>
            )}
          </header>
        )}
        {view === 'settings' ? (
          <div className="overflow-auto p-4">
            <SettingsForm initial={status.settings} save={async (settings) => {
              setError('')
              try { await desktop.save(settings) } catch (reason) { setError(errorMessage(reason)); throw reason }
            }} />
            <SyncSettings />
          </div>
        ) : (
          <div className={cn('flex min-h-0 flex-1 flex-col gap-3', popup ? 'p-3' : 'p-4')}>
            <div className="relative">
              <Search aria-hidden="true" size={16} className="absolute left-3 top-3 text-muted-foreground" />
              <Input ref={input} autoFocus aria-label="Search clips" placeholder="Search clips…" value={query}
                className="h-10 pl-9" onChange={(event) => { setQuery(event.target.value); setSelected('') }} />
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] overflow-hidden rounded-lg border">
              <ul aria-label="Clipboard history" className="min-w-0 overflow-auto border-r bg-card p-2">
                {clips.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">{results?.query !== query ? 'Searching…' : query ? 'No matching clips' : 'Copy something to start your history.'}</li>}
                {clips.map((clip, index) => {
                  const Icon = clip.is_secret ? LockKeyhole : clipIcons[clip.kind]
                  return (
                    <li key={clip.id} id={clip.id}>
                      <button type="button" aria-pressed={clip.id === activeId} onClick={() => setSelected(clip.id)}
                        onKeyDown={(event) => {
                          if (popup && event.key === 'Enter') {
                            event.preventDefault()
                            if (!busy) copy(clip)
                          }
                        }}
                        onDoubleClick={() => { if (popup && !busy) copy(clip) }}
                        className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent', clip.id === activeId && 'bg-accent')}>
                        <Icon aria-hidden="true" className="shrink-0 text-muted-foreground" size={16} />
                        <span className="flex-1 truncate">{clip.title}</span>
                        {clip.kept && <Pin aria-label="Kept" className="shrink-0" size={13} />}
                        {popup && index < 5 && <kbd className="text-xs text-muted-foreground">{index + 1}</kbd>}
                      </button>
                    </li>
                  )
                })}
              </ul>
              <section aria-label="Clip preview" className="flex min-h-0 min-w-0 flex-col bg-card">
                <div className="min-h-0 flex-1 overflow-auto p-3">
                  {active && !popup && <p className="mb-2 text-xs text-muted-foreground">
                    {new Date(active.created_at).toLocaleString()}{active.source_app ? ` · ${active.source_app}` : ''}
                  </p>}
                  <ClipPreview preview={display && display.id === activeId ? display.preview : null} />
                  {active && active.tags.length > 0 && <div aria-label="Tags" className="mt-3 flex flex-wrap gap-2">
                    {active.tags.map((tag) => <span key={tag} className="rounded-full bg-secondary px-2 py-1 text-xs">{tag}</span>)}
                  </div>}
                  {active?.note && <div className="mt-3 rounded-md bg-secondary p-3 text-sm">
                    <p className="mb-1 font-medium">Summary</p>
                    <p className="whitespace-pre-wrap break-words">{active.note}</p>
                  </div>}
                </div>
                {active && (
                  <div className="flex flex-wrap gap-1 border-t p-2">
                    <Button size="sm" disabled={!!busy || (active.is_secret && active.kind === 'file')}
                      onClick={() => copy(active)}>{popup ? 'Paste' : 'Copy'}</Button>
                    <Button size="sm" variant="ghost" disabled={!!busy}
                      onClick={() => void act('keep', () => desktop.keep(active.id, !active.kept))}>{active.kept ? 'Unkeep' : 'Keep'}</Button>
                    {deleting === active.id ? (
                      <>
                        <Button size="sm" variant="destructive" disabled={!!busy}
                          onClick={() => void act('remove', async () => { await desktop.remove(active.id); setDeleting('') })}>Delete clip</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleting('')}>Cancel</Button>
                      </>
                    ) : <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setDeleting(active.id)}>Delete</Button>}
                    {!active.is_secret && active.kind === 'text' && !popup && (
                      <>
                        <Button size="sm" variant="ghost" disabled={!!busy}
                          onClick={() => void act('tag', () => desktop.ai(active.id, 'tag'))}>{busy === 'tag' ? 'Tagging…' : 'Tag this'}</Button>
                        <Button size="sm" variant="ghost" disabled={!!busy}
                          onClick={() => void act('summarize', () => desktop.ai(active.id, 'summarize'))}>{busy === 'summarize' ? 'Summarizing…' : 'Summarize'}</Button>
                      </>
                    )}
                  </div>
                )}
              </section>
            </div>
            <p className="text-xs text-muted-foreground">{popup ? '↑ ↓ Navigate · Enter Paste · Alt+1–5 Quick paste · Esc Close' : 'Ctrl+Shift+V opens quick search'}</p>
          </div>
        )}
      </main>
    </div>
  )
}

export default function DesktopApp() {
  return <ThemeProvider defaultTheme="dark" storageKey="clipsync-theme"><DesktopContent /></ThemeProvider>
}
