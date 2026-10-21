import { useMemo, useState } from 'react'
import { Bookmark, Plus, Star, Trash2, ExternalLink, RefreshCw, Globe, Copy, Pin } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { useAppStore } from '@/stores/appStore'
import { api } from '@/lib/api'
import type { Item, Bookmark as BookmarkType } from '@/types'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function BookmarksView() {
  const { items, setItems } = useAppStore()
  const [isCreating, setIsCreating] = useState(false)
  const [newBookmark, setNewBookmark] = useState({ url: '', title: '' })
  const [filter, setFilter] = useState('')

  const bookmarkItems = items.filter(i => i.type === 'bookmark') as (Item & { bookmark?: BookmarkType })[]

  const filteredBookmarks = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const base = !q ? bookmarkItems : bookmarkItems.filter((b) => {
      const title = (b.title || '').toLowerCase()
      const url = (b.bookmark?.url || '').toLowerCase()
      const summary = (b.bookmark?.summary || '').toLowerCase()
      const tags = (b.tags || []).join(' ').toLowerCase()
      return title.includes(q) || url.includes(q) || summary.includes(q) || tags.includes(q)
    })
    return [...base].sort((a, b) => {
      const ap = a.metadata?.pinned ? 1 : 0
      const bp = b.metadata?.pinned ? 1 : 0
      if (ap !== bp) return bp - ap
      const at = (a.updated_at || a.created_at || 0)
      const bt = (b.updated_at || b.created_at || 0)
      return bt - at
    })
  }, [bookmarkItems, filter])

  const handleTogglePin = async (item: Item) => {
    const pinned = !item.metadata?.pinned
    try {
      await api.updateItem(item.id, {
        metadata: { ...(item.metadata || {}), pinned }
      })
      setItems(items.map(i => i.id === item.id ? { ...i, metadata: { ...(i.metadata || {}), pinned } } : i))
      toast.success(pinned ? 'Pinned' : 'Unpinned')
    } catch {
      toast.error('Failed to update')
    }
  }

  const handleCreateBookmark = async () => {
    if (!newBookmark.url.trim()) {
      toast.error('URL is required')
      return
    }
    
    try {
      const bookmark = await api.createBookmark({
        url: newBookmark.url,
        title: newBookmark.title || undefined,
        auto_scrape: true
      })
      setItems([bookmark, ...items])
      setNewBookmark({ url: '', title: '' })
      setIsCreating(false)
      toast.success('Bookmark added')
    } catch (error) {
      toast.error('Failed to add bookmark')
    }
  }

  const handleToggleStar = async (item: Item) => {
    try {
      await api.toggleStar(item.id, !item.starred)
      const updatedItems = items.map(i => 
        i.id === item.id ? { ...i, starred: !i.starred } : i
      )
      setItems(updatedItems)
    } catch (error) {
      toast.error('Failed to update')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteItem(id)
      setItems(items.filter(i => i.id !== id))
      toast.success('Bookmark deleted')
    } catch (error) {
      toast.error('Failed to delete')
    }
  }

  const handleScrape = async (item: Item & { bookmark?: BookmarkType }) => {
    if (!item.bookmark?.url) return
    
    toast.info('Scraping...')
    try {
      await api.scrapeBookmark(item.id, item.bookmark.url)
      toast.success('Content scraped')
      // Reload bookmark
      const extracted = await api.getBookmarkExtracted(item.id)
      const updatedItems = items.map(i => 
        i.id === item.id 
          ? { ...i, bookmark: { ...i.extension, ...extracted } }
          : i
      )
      setItems(updatedItems)
    } catch (error) {
      toast.error('Failed to scrape')
    }
  }

  const getFaviconUrl = (url: string) => {
    try {
      const domain = new URL(url).hostname
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
    } catch {
      return null
    }
  }

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('URL copied')
    } catch {
      toast.error('Failed to copy')
    }
  }

  const makeSummary = (item: Item & { bookmark?: BookmarkType }, domain: string) => {
    const s = (item.bookmark?.summary || '').trim()
    if (s) return s.length > 110 ? `${s.slice(0, 110)}…` : s
    const u = (item.bookmark?.url || '').trim()
    if (u) return u.length > 110 ? `${u.slice(0, 110)}…` : u
    return domain
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold">Bookmarks</h2>
        <Button onClick={() => setIsCreating(true)} className="justify-center">
          <Plus className="w-4 h-4 mr-2" />
          Add Bookmark
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Search bookmarks..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {filteredBookmarks.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Bookmark className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>{bookmarkItems.length === 0 ? 'No bookmarks yet. Add your first bookmark!' : 'No bookmarks match your search.'}</p>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Library</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="w-full">
              {filteredBookmarks.map((item) => {
                const url = item.bookmark?.url || ''
                const domain = url ? (() => {
                  try { return new URL(url).hostname } catch { return '' }
                })() : ''
                const faviconUrl = getFaviconUrl(url)
                const summary = makeSummary(item, domain)
                const topTags = (item.tags || []).filter(Boolean).slice(0, 2)
                const scrapeStatus = item.bookmark?.scrape_status
                const isPinned = !!item.metadata?.pinned

                return (
                  <AccordionItem key={item.id} value={item.id}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-start gap-3 text-left w-full min-w-0">
                        <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0 overflow-hidden mt-0.5">
                          {faviconUrl ? (
                            <img src={faviconUrl} alt="" className="w-5 h-5" />
                          ) : (
                            <Globe className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium truncate">
                              {item.title || domain || 'Untitled'}
                            </span>
                            {isPinned && (
                              <Pin className="w-4 h-4 text-muted-foreground shrink-0" />
                            )}
                            {item.starred && (
                              <Star className="w-4 h-4 fill-yellow-500 text-yellow-500 shrink-0" />
                            )}
                            {scrapeStatus && (
                              <Badge variant="secondary" className="shrink-0">
                                {scrapeStatus}
                              </Badge>
                            )}
                          </div>

                          {summary && (
                            <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {summary}
                            </div>
                          )}

                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-2">
                            <span>{formatDistanceToNow(item.created_at, { addSuffix: true })}</span>
                            {domain && <span className="truncate">• {domain}</span>}
                          </div>

                          {topTags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {topTags.map(t => (
                                <Badge key={t} variant="outline" className="text-[11px]">
                                  {t}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>

                        <div
                          className="flex items-center gap-1 shrink-0"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                        >
                          <Button
                            size="icon"
                            variant="ghost"
                            className={cn("h-8 w-8", isPinned && "text-primary")}
                            onClick={() => handleTogglePin(item)}
                            title={isPinned ? 'Unpin' : 'Pin'}
                          >
                            <Pin className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            className="h-8 px-3"
                            onClick={() => handleCopyUrl(url)}
                            title="Copy URL"
                          >
                            <Copy className="w-4 h-4 mr-2" />
                            Copy
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            asChild
                            title="Open"
                          >
                            <a href={url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className={cn("h-8 w-8", item.starred && "text-yellow-500")}
                            onClick={() => handleToggleStar(item)}
                            title={item.starred ? 'Unstar' : 'Star'}
                          >
                            <Star className={cn('w-4 h-4', item.starred && 'fill-current')} />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(item.id)}
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </AccordionTrigger>

                    <AccordionContent>
                      <div className="space-y-3 pt-2">
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleCopyUrl(url)} className="gap-2">
                            <Copy className="w-4 h-4" />
                            Copy URL
                          </Button>
                          <Button size="sm" variant="outline" asChild className="gap-2">
                            <a href={url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="w-4 h-4" />
                              Open
                            </a>
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleScrape(item)} className="gap-2">
                            <RefreshCw className="w-4 h-4" />
                            Scrape
                          </Button>
                        </div>

                        {item.bookmark?.summary && (
                          <div>
                            <div className="text-sm font-medium mb-1">Summary</div>
                            <div className="text-sm text-muted-foreground whitespace-pre-wrap">{item.bookmark.summary}</div>
                          </div>
                        )}

                        {item.bookmark?.extracted_text && (
                          <div>
                            <div className="text-sm font-medium mb-1">Extracted</div>
                            <div className="rounded-md border bg-muted/30 p-3 max-h-[260px] overflow-auto">
                              <pre className="whitespace-pre-wrap text-sm">{item.bookmark.extracted_text.slice(0, 4000)}{item.bookmark.extracted_text.length > 4000 && '...'} </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {/* Create Bookmark Dialog */}
      <Dialog open={isCreating} onOpenChange={setIsCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Bookmark</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">URL</label>
              <Input
                placeholder="https://example.com"
                value={newBookmark.url}
                onChange={(e) => setNewBookmark({ ...newBookmark, url: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Title (optional)</label>
              <Input
                placeholder="Page title..."
                value={newBookmark.title}
                onChange={(e) => setNewBookmark({ ...newBookmark, title: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreating(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateBookmark}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
