import type { Item, ItemType, ChatMessage, ResearchResult } from '@/types'

const DEFAULT_API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787/api'

function normalizeApiBase(input: string) {
  const raw = (input || '').trim()
  if (!raw) return DEFAULT_API_BASE
  // remove trailing slashes
  const noTrailing = raw.replace(/\/+$/, '')
  // ensure /api suffix
  if (noTrailing.endsWith('/api')) return noTrailing
  return `${noTrailing}/api`
}

function getApiBase() {
  try {
    // Zustand persist stores JSON under key 'clipsync-storage'
    const stored = localStorage.getItem('clipsync-storage')
    if (stored) {
      const parsed = JSON.parse(stored)
      const url = parsed?.state?.apiUrl
      if (typeof url === 'string' && url.trim()) return normalizeApiBase(url)
    }
  } catch {
    // ignore
  }
  return normalizeApiBase(DEFAULT_API_BASE)
}

// Transform raw API item (tags_json, metadata_json strings) to frontend Item (tags[], metadata{})
function transformItem(raw: any): any {
  if (!raw || typeof raw !== 'object') return raw
  const item = { ...raw }
  // Parse tags_json -> tags
  if ('tags_json' in item) {
    try { item.tags = JSON.parse(item.tags_json || '[]') } catch { item.tags = [] }
    delete item.tags_json
  }
  if (!item.tags) item.tags = []
  // Parse metadata_json -> metadata
  if ('metadata_json' in item) {
    try { item.metadata = JSON.parse(item.metadata_json || '{}') } catch { item.metadata = {} }
    delete item.metadata_json
  }
  if (!item.metadata) item.metadata = {}
  // Parse variables_json in prompt extension
  if (item.prompt && 'variables_json' in item.prompt) {
    try { item.prompt.variables = JSON.parse(item.prompt.variables_json || '[]') } catch { item.prompt.variables = [] }
    delete item.prompt.variables_json
  }
  // Ensure starred is boolean
  if (typeof item.starred === 'number') item.starred = !!item.starred
  return item
}

function transformResponse(data: any): any {
  if (!data) return data
  if (data.items && Array.isArray(data.items)) {
    data.items = data.items.map(transformItem)
  }
  if (data.id && data.type) {
    return transformItem(data)
  }
  return data
}

class ApiClient {
  private async fetch(path: string, options?: RequestInit): Promise<any> {
    const API_BASE = getApiBase()
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      }
    })
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    
    const data = await response.json()
    return transformResponse(data)
  }

  // Items
  async getItems(options: {
    type?: ItemType
    folder?: string
    starred?: boolean
    search?: string
    limit?: number
    cursor?: string
    tags?: string[]
  } = {}) {
    const params = new URLSearchParams()
    if (options.type) params.set('type', options.type)
    if (options.folder) params.set('folder', options.folder)
    if (options.starred !== undefined) params.set('starred', String(options.starred))
    if (options.search) params.set('q', options.search)
    if (options.limit) params.set('limit', String(options.limit))
    if (options.cursor) params.set('cursor', options.cursor)
    if (options.tags) params.set('tags', options.tags.join(','))
    
    return this.fetch(`/items?${params}`)
  }

  async getItem(id: string): Promise<Item> {
    return this.fetch(`/items/${id}`)
  }

  async createItem(data: Partial<Item> & { type: ItemType }): Promise<Item> {
    return this.fetch('/items', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async updateItem(id: string, data: Partial<Item>): Promise<Item> {
    return this.fetch(`/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    })
  }

  async deleteItem(id: string): Promise<void> {
    return this.fetch(`/items/${id}`, { method: 'DELETE' })
  }

  async toggleStar(id: string, starred?: boolean): Promise<Item> {
    return this.fetch(`/items/${id}/star`, {
      method: 'POST',
      body: JSON.stringify({ starred })
    })
  }

  // Clips
  async pushClip(content: string, deviceId?: string, deviceType?: string) {
    return this.fetch('/clips/push', {
      method: 'POST',
      body: JSON.stringify({ content, device_id: deviceId, device_type: deviceType })
    })
  }

  async getLatestClip(deviceId?: string) {
    const params = deviceId ? `?device_id=${deviceId}` : ''
    return this.fetch(`/clips/latest${params}`)
  }

  async getClipHistory(limit = 50) {
    return this.fetch(`/clips/history?limit=${limit}`)
  }

  // Prompts
  async getPrompts() {
    return this.fetch('/prompts')
  }

  async createPrompt(data: {
    title?: string
    template: string
    variables?: string[]
    shortcut?: string
    tags?: string[]
    folder?: string
  }) {
    return this.fetch('/prompts', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async updatePrompt(id: string, data: Partial<{
    title: string
    template: string
    variables: string[]
    shortcut: string
    tags: string[]
    folder: string
  }>) {
    return this.fetch(`/prompts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    })
  }

  async exportAhk(id: string): Promise<string> {
    const response = await fetch(`${getApiBase()}/prompts/${id}/ahk`)
    return response.text()
  }

  async exportAllAhk(): Promise<string> {
    const response = await fetch(`${getApiBase()}/prompts/export/all`)
    return response.text()
  }

  async importPrompts(prompts: any[]) {
    return this.fetch('/prompts/import', {
      method: 'POST',
      body: JSON.stringify({ prompts })
    })
  }

  // Notes
  async getNotes() {
    return this.fetch('/notes')
  }

  async createNote(data: {
    title?: string
    content?: string
    format?: 'markdown' | 'text'
    folder?: string
    tags?: string[]
  }) {
    return this.fetch('/notes', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async getNoteContent(id: string) {
    return this.fetch(`/notes/${id}/content`)
  }

  async updateNoteContent(id: string, data: {
    content?: string
    title?: string
    folder?: string
    tags?: string[]
  }) {
    return this.fetch(`/notes/${id}/content`, {
      method: 'PUT',
      body: JSON.stringify(data)
    })
  }

  // Bookmarks
  async getBookmarks() {
    return this.fetch('/bookmarks')
  }

  async createBookmark(data: {
    url: string
    title?: string
    favicon_url?: string
    folder?: string
    tags?: string[]
    auto_scrape?: boolean
  }) {
    return this.fetch('/bookmarks', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async scrapeBookmark(itemId: string, url: string) {
    return this.fetch('/bookmarks/scrape', {
      method: 'POST',
      body: JSON.stringify({ item_id: itemId, url })
    })
  }

  async getBookmarkExtracted(id: string) {
    return this.fetch(`/bookmarks/${id}/extracted`)
  }

  // Research
  async startResearch(data: {
    query: string
    depth?: 'quick' | 'medium' | 'deep'
    sources?: number
    folder?: string
  }) {
    return this.fetch('/research/start', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async getResearchStatus(id: string) {
    return this.fetch(`/research/${id}/status`)
  }

  async getResearch(id: string): Promise<Item & { research: ResearchResult }> {
    return this.fetch(`/research/${id}`)
  }

  // AI
  async chat(messages: ChatMessage[], options: {
    model?: string
    temperature?: number
    stream?: boolean
  } = {}) {
    const response = await fetch(`${getApiBase()}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, ...options, stream: true })
    })
    
    return response
  }

  async summarize(text: string, maxLength = 200) {
    return this.fetch('/ai/summarize', {
      method: 'POST',
      body: JSON.stringify({ text, max_length: maxLength })
    })
  }

  async expandPrompt(prompt: string, context?: string) {
    return this.fetch('/ai/expand-prompt', {
      method: 'POST',
      body: JSON.stringify({ prompt, context })
    })
  }

  // Scrape
  async scrapeUrl(url: string, options: {
    extract_text?: boolean
    extract_links?: boolean
    extract_images?: boolean
  } = {}) {
    return this.fetch('/scrape', {
      method: 'POST',
      body: JSON.stringify({ url, ...options })
    })
  }

  async crawl(data: {
    query?: string
    start_urls?: string[]
    max_pages?: number
    max_depth?: number
    same_domain?: boolean
  }) {
    return this.fetch('/scrape/crawl', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  // Uploads
  async initUpload(data: {
    filename: string
    mime_type?: string
    size_bytes?: number
    item_id?: string
  }) {
    return this.fetch('/uploads/init', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async uploadFile(uploadId: string, file: File, itemId?: string) {
    const response = await fetch(`${getApiBase()}/uploads/do/${uploadId}`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': file.name,
        'X-Item-Id': itemId || 'unattached'
      },
      body: file
    })
    
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`)
    }
    
    return response.json()
  }

  async getAttachments(itemId: string) {
    return this.fetch(`/uploads/item/${itemId}`)
  }

  async deleteAttachment(attachmentId: string) {
    return this.fetch(`/uploads/${attachmentId}`, { method: 'DELETE' })
  }

  // Tags
  async getTags() {
    return this.fetch('/tags')
  }

  async createTag(name: string, color?: string) {
    return this.fetch('/tags', {
      method: 'POST',
      body: JSON.stringify({ name, color })
    })
  }

  async getItemsByTag(tagName: string) {
    return this.fetch(`/tags/${tagName}/items`)
  }

  // Health
  async health() {
    return this.fetch('/health')
  }
}

export const api = new ApiClient()
