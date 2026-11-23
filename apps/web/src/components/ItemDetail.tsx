import { X, Star, Trash2, Edit3, Save, Copy, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useAppStore } from '@/stores/appStore'
import { api } from '@/lib/api'
import type { Item } from '@/types'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { marked } from 'marked'
import DOMPurify from 'isomorphic-dompurify'

const typeColors = {
  clip: 'bg-blue-500',
  note: 'bg-green-500',
  prompt: 'bg-purple-500',
  bookmark: 'bg-orange-500',
  research: 'bg-pink-500'
}

const typeLabels = {
  clip: 'Clipboard',
  note: 'Note',
  prompt: 'Prompt',
  bookmark: 'Bookmark',
  research: 'Research'
}

export function ItemDetail() {
  const { currentItem, setCurrentItem, items, setItems } = useAppStore()
  const [isEditing, setIsEditing] = useState(false)
  const [editData, setEditData] = useState<Partial<Item>>({})

  if (!currentItem) return null

  const handleClose = () => {
    setCurrentItem(null)
    setIsEditing(false)
  }

  const handleToggleStar = async () => {
    try {
      await api.toggleStar(currentItem.id, !currentItem.starred)
      const updatedItems = items.map(i => 
        i.id === currentItem.id ? { ...i, starred: !i.starred } : i
      )
      setItems(updatedItems)
      setCurrentItem({ ...currentItem, starred: !currentItem.starred })
    } catch (error) {
      toast.error('Failed to update')
    }
  }

  const handleDelete = async () => {
    try {
      await api.deleteItem(currentItem.id)
      setItems(items.filter(i => i.id !== currentItem.id))
      setCurrentItem(null)
      toast.success('Item deleted')
    } catch (error) {
      toast.error('Failed to delete')
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(currentItem.content)
    toast.success('Copied to clipboard')
  }

  const handleSaveEdit = async () => {
    try {
      await api.updateItem(currentItem.id, editData)
      const updatedItems = items.map(i => 
        i.id === currentItem.id ? { ...i, ...editData } : i
      )
      setItems(updatedItems)
      setCurrentItem({ ...currentItem, ...editData })
      setIsEditing(false)
      toast.success('Item updated')
    } catch (error) {
      toast.error('Failed to update')
    }
  }

  const renderMarkdown = (content: string) => {
    const html = marked.parse(content || '', { async: false }) as string
    return DOMPurify.sanitize(html)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50"
        onClick={handleClose}
      />
      
      {/* Panel */}
      <div className="relative w-full max-w-2xl bg-card border-l border-border h-full shadow-xl animate-in slide-in-from-right">
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className={cn("w-3 h-3 rounded-full", typeColors[currentItem.type])} />
            <span className="text-sm text-muted-foreground">
              {typeLabels[currentItem.type]}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleToggleStar}>
              <Star className={cn("w-4 h-4", currentItem.starred && "fill-yellow-500 text-yellow-500")} />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCopy}>
              <Copy className="w-4 h-4" />
            </Button>
            {!isEditing ? (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                setEditData({ title: currentItem.title, content: currentItem.content })
                setIsEditing(true)
              }}>
                <Edit3 className="w-4 h-4" />
              </Button>
            ) : (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSaveEdit}>
                <Save className="w-4 h-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={handleDelete}>
              <Trash2 className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <ScrollArea className="h-[calc(100vh-3.5rem)]">
          <div className="p-6 space-y-6">
            {/* Title */}
            {isEditing ? (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Title</label>
                <Input
                  value={editData.title || ''}
                  onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                  className="mt-1"
                />
              </div>
            ) : (
              <h1 className="text-2xl font-bold">{currentItem.title || 'Untitled'}</h1>
            )}

            {/* Metadata */}
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{formatDistanceToNow(currentItem.created_at, { addSuffix: true })}</span>
              {currentItem.folder && (
                <>
                  <span>•</span>
                  <span>{currentItem.folder}</span>
                </>
              )}
            </div>

            {/* Tags */}
            {currentItem.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {currentItem.tags.map(tag => (
                  <Badge key={tag} variant="secondary">{tag}</Badge>
                ))}
              </div>
            )}

            {/* Content */}
            <div>
              {isEditing ? (
                <Textarea
                  value={editData.content || ''}
                  onChange={(e) => setEditData({ ...editData, content: e.target.value })}
                  className="min-h-[300px] font-mono"
                />
              ) : (
                <div className="space-y-4">
                  {currentItem.type === 'note' ? (
                    <div 
                      className="prose prose-sm dark:prose-invert max-w-none"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(currentItem.content) }}
                    />
                  ) : currentItem.type === 'bookmark' && currentItem.extension?.url ? (
                    <div className="space-y-4">
                      <a 
                        href={currentItem.extension.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-primary hover:underline"
                      >
                        {currentItem.extension.url}
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      {currentItem.extension.extracted_text && (
                        <div className="bg-muted p-4 rounded-lg">
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                            {currentItem.extension.extracted_text.slice(0, 2000)}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : currentItem.type === 'prompt' ? (
                    <div className="bg-muted p-4 rounded-lg font-mono text-sm whitespace-pre-wrap">
                      {currentItem.extension?.template || currentItem.content}
                    </div>
                  ) : (
                    <div className="bg-muted p-4 rounded-lg font-mono text-sm whitespace-pre-wrap">
                      {currentItem.content}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Type-specific details */}
            {currentItem.type === 'prompt' && currentItem.extension && (
              <div className="pt-4 border-t">
                <h3 className="font-medium mb-2">Prompt Details</h3>
                {currentItem.extension.shortcut && (
                  <p className="text-sm text-muted-foreground">
                    Shortcut: <code className="bg-muted px-1 rounded">{currentItem.extension.shortcut}</code>
                  </p>
                )}
                {currentItem.extension.variables?.length > 0 && (
                  <div className="mt-2">
                    <p className="text-sm text-muted-foreground">Variables:</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {currentItem.extension.variables.map((v: string) => (
                        <Badge key={v} variant="outline">{v}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {currentItem.type === 'research' && currentItem.extension && (
              <div className="pt-4 border-t">
                <h3 className="font-medium mb-2">Research Details</h3>
                <p className="text-sm text-muted-foreground">
                  Query: {currentItem.extension.query}
                </p>
                <p className="text-sm text-muted-foreground">
                  Status: {currentItem.extension.status}
                </p>
                {currentItem.extension.sources && (
                  <p className="text-sm text-muted-foreground">
                    Sources: {currentItem.extension.sources.length}
                  </p>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
