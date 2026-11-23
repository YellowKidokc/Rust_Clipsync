import { invoke } from '@tauri-apps/api/core'

export type Kind = 'text' | 'image' | 'file'

export interface Clip {
  id: string
  kind: Kind
  source_app: string | null
  created_at: number
  kept: boolean
  title: string
  tags: string[]
  note: string
  is_secret: boolean
}

export type Preview =
  | { kind: 'text' | 'image'; value: string }
  | { kind: 'file'; value: string[] }
  | { kind: 'secret' }

export interface Settings {
  text: boolean
  images: boolean
  files: boolean
  paused: boolean
  maxBytes: number
  ollamaUrl: string
  model: string
}

export interface Status {
  ready: boolean
  error: string | null
  captureError: string | null
  settings: Settings
}

export interface SyncStatus {
  connected: boolean
  paused: boolean
  error: string | null
}

export const desktop = {
  syncStatus: () => invoke<SyncStatus>('sync_status'),
  configureSync: (origin: string, syncKey: string, token: string) => invoke<void>('configure_sync', { origin, syncKey, token }),
  pauseSync: (paused: boolean) => invoke<void>('pause_sync', { paused }),
  status: () => invoke<Status>('status'),
  initialize: (passphrase: string) => invoke<void>('initialize', { passphrase }),
  search: (query: string) => invoke<Clip[]>('search', { query }),
  preview: (id: string) => invoke<Preview>('preview', { id }),
  copy: (id: string, paste: boolean) => invoke<void>('copy', { id, paste }),
  keep: (id: string, kept: boolean) => invoke<void>('keep', { id, kept }),
  remove: (id: string) => invoke<void>('remove', { id }),
  save: (settings: Settings) => invoke<void>('save_settings', { settings }),
  ai: (id: string, action: 'tag' | 'summarize') => invoke<void>('run_ai', { id, action }),
  dismiss: () => invoke<void>('dismiss'),
}
