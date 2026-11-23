export type ItemType = 'clip' | 'note' | 'prompt' | 'bookmark' | 'research'

export interface Item {
  id: string
  type: ItemType
  title: string
  content: string
  content_storage: 'inline' | 'r2'
  r2_key?: string
  starred: boolean
  folder: string
  tags: string[]
  metadata: Record<string, any>
  created_at: number
  updated_at: number
  user_id: string
  extension?: any
}

export interface Prompt {
  item_id: string
  template: string
  variables: string[]
  shortcut?: string
  ahk_script?: string
}

export interface Bookmark {
  item_id: string
  url: string
  favicon_url?: string
  extracted_text?: string
  summary?: string
  scrape_status: 'pending' | 'success' | 'failed'
}

export interface Note {
  item_id: string
  format: 'markdown' | 'text'
  word_count: number
}

export interface ResearchResult {
  item_id: string
  query: string
  sources: ResearchSource[]
  synthesis?: string
  search_api_used?: string
  status: 'running' | 'completed' | 'failed'
}

export interface ResearchSource {
  url: string
  title: string
  description?: string
  content?: string
  relevance_score?: number
  ranking_reason?: string
}

export interface Attachment {
  id: string
  item_id: string
  r2_key: string
  filename: string
  mime_type?: string
  size_bytes?: number
  created_at: number
  url?: string
}

export interface Tag {
  id: string
  name: string
  color: string
  usage_count: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ClipboardState {
  device_id: string
  last_item_id?: string
  last_sync_at?: number
  device_type?: 'windows' | 'android' | 'pwa' | 'macos' | 'ios'
}

export interface ScrapedPage {
  url: string
  title: string
  description?: string
  text?: string
  links?: { url: string; text: string; is_external: boolean }[]
  images?: { url: string; alt: string }[]
  word_count?: number
  favicon_url?: string
  open_graph?: {
    title?: string
    image?: string
    type?: string
  }
}
