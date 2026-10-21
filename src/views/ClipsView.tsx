import { useEffect, useState } from 'react'
import { Clipboard, Copy, Trash2, Star, RefreshCw, Pin } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { useAppStore } from '@/stores/appStore'
import { api } from '@/lib/api'
import type { Item } from '@/types'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function ClipsView() {
  const { items, setItems } = useAppStore()
  const [newClip, setNewClip] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const clipItems = [...items.filter(i => i.type === 'clip')].sort((a, b) => {
    const ap = a.metadata?.pinned ? 1 : 0
    const bp = b.metadata?.pinned ? 1 : 0
    if (ap !== bp) return bp - ap
    const at = (a.updated_at || a.created_at || 0)
    const bt = (b.updated_at || b.created_at || 0)
    return bt - at
  })

  const loadClips = async () => {
    setIsLoading(true)
    try {
      const data = await api.getClipHistory(100)
      // Merge clips with existing items
      const nonClips = items.filter(i => i.type !== 'clip')
      setItems([...nonClips, ...(data.items || [])])
    } catch (error) {
      toast.error('Failed to load clipboard history')
    } finally {
      setIsLoading(false)
    }

  }

  const handleTogglePin = async (item: Item) => {
    const pinned = !item.metadata?.pinned
    try {
      await api.updateItem(item.id, { metadata: { ...(item.metadata || {}), pinned } })
      setItems(items.map(i => i.id === item.id ? { ...i, metadata: { ...(i.metadata || {}), pinned } } : i))
      toast.success(pinned ? 'Pinned' : 'Unpinned')
    } catch {
      toast.error('Failed to update')
    }
  }

  useEffect(() => {
    loadClips()
  }, [])

  const handlePushClip = async () => {
    if (!newClip.trim()) return
    
    try {
      await api.pushClip(newClip)
      toast.success('Clip saved')
      setNewClip('')
      loadClips()
    } catch (error) {
      toast.error('Failed to save clip')
    }
  }

  const handleCopy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      toast.success('Copied to clipboard')
    } catch (error) {
      toast.error('Failed to copy')
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
      toast.success('Clip deleted')
    } catch (error) {
      toast.error('Failed to delete')
    }
  }

  return (
    <div className="space-y-4">
      {/* Push New Clip */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clipboard className="w-5 h-5" />
            Push to Clipboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Enter text to save..."
              value={newClip}
              onChange={(e) => setNewClip(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePushClip()}
              className="flex-1"
            />
            <Button onClick={handlePushClip}>
              Save
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Use the Windows agent or Android app for automatic sync
          </p>
        </CardContent>
      </Card>

      {/* Clipboard History */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Clipboard History</CardTitle>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={loadClips}
            disabled={isLoading}
          >
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          </Button>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            <div className="space-y-2">
              {clipItems.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No clipboard history yet
                </p>
              ) : (
                clipItems.map((item) => (
                  <ClipCard
                    key={item.id}
                    item={item}
                    onCopy={() => handleCopy(item.content)}
                    onPin={() => handleTogglePin(item)}
                    onStar={() => handleToggleStar(item)}
                    onDelete={() => handleDelete(item.id)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}

function ClipCard({ 
  item, 
  onCopy, 
  onStar, 
  onDelete,
  onPin
}: { 
  item: Item
  onCopy: () => void
  onStar: () => void
  onDelete: () => void
  onPin: () => void
}) {
  const singleLine = item.content.replace(/\s+/g, ' ').trim()
  const title = singleLine ? (singleLine.length > 48 ? `${singleLine.slice(0, 48)}…` : singleLine) : 'Untitled'
  const summary = singleLine.length > 140 ? `${singleLine.slice(0, 140)}…` : singleLine
  const isPinned = !!item.metadata?.pinned

  return (
    <div className="border rounded-lg p-3 hover:bg-accent/50 transition-colors">
      {/* Line 1: Title + indicators */}
      <div className="flex items-center gap-2 mb-1">
        <h3 className="font-semibold text-sm truncate flex-1">{title}</h3>
        {isPinned && <Pin className="w-3.5 h-3.5 text-primary shrink-0" />}
        {item.starred && <Star className="w-3.5 h-3.5 fill-yellow-500 text-yellow-500 shrink-0" />}
      </div>

      {/* Line 2: Preview */}
      {summary && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
          {summary}
        </p>
      )}

      {/* Line 3: Actions */}
      <div className="flex items-center gap-2">
        <Button 
          size="sm" 
          onClick={onCopy}
          className="h-7 px-3"
        >
          <Copy className="w-3.5 h-3.5 mr-1.5" />
          Copy
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className={cn("h-7 w-7", isPinned && "text-primary")}
          onClick={onPin}
          title={isPinned ? 'Unpin' : 'Pin'}
        >
          <Pin className="w-3.5 h-3.5" />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-7 w-7"
          onClick={onStar}
          title={item.starred ? 'Unstar' : 'Star'}
        >
          <Star className={cn("w-3.5 h-3.5", item.starred && "fill-yellow-500 text-yellow-500")} />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={onDelete}
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {formatDistanceToNow(item.created_at, { addSuffix: true })}
        </span>
      </div>
    </div>
  )
}
