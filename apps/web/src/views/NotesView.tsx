import { useState } from 'react'
import { FileText, Plus, Star, Trash2, Edit3, Pin, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useAppStore } from '@/stores/appStore'
import { api } from '@/lib/api'
import type { Item } from '@/types'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function NotesView() {
  const { items, setItems, setCurrentItem } = useAppStore()
  const [isCreating, setIsCreating] = useState(false)
  const [newNoteTitle, setNewNoteTitle] = useState('')
  const [filter, setFilter] = useState('')

  const noteItems = [...items.filter(i => i.type === 'note')].sort((a, b) => {
    const ap = a.metadata?.pinned ? 1 : 0
    const bp = b.metadata?.pinned ? 1 : 0
    if (ap !== bp) return bp - ap
    const at = (a.updated_at || a.created_at || 0)
    const bt = (b.updated_at || b.created_at || 0)
    return bt - at
  })

  const filteredNotes = filter.trim() 
    ? noteItems.filter(n => 
        (n.title || '').toLowerCase().includes(filter.toLowerCase()) ||
        (n.content || '').toLowerCase().includes(filter.toLowerCase())
      )
    : noteItems

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

  const handleCreateNote = async () => {
    if (!newNoteTitle.trim()) return
    
    try {
      const note = await api.createNote({
        title: newNoteTitle,
        content: '# ' + newNoteTitle + '\n\n',
        format: 'markdown'
      })
      setItems([note, ...items])
      setNewNoteTitle('')
      setIsCreating(false)
      toast.success('Note created')
      setCurrentItem(note)
    } catch (error) {
      toast.error('Failed to create note')
    }
  }

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content)
    toast.success('Copied to clipboard')
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
      toast.success('Note deleted')
    } catch (error) {
      toast.error('Failed to delete')
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold">Notes</h2>
        <Button onClick={() => setIsCreating(true)} className="justify-center">
          <Plus className="w-4 h-4 mr-2" />
          New Note
        </Button>
      </div>

      {/* Search */}
      <Input
        placeholder="Search notes..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      {/* Notes List */}
      {filteredNotes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>{noteItems.length === 0 ? 'No notes yet. Create your first note!' : 'No notes match your search.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredNotes.map((item) => (
            <CompactNoteRow
              key={item.id}
              item={item}
              onCopy={() => handleCopy(item.content)}
              onPin={() => handleTogglePin(item)}
              onStar={() => handleToggleStar(item)}
              onEdit={() => setCurrentItem(item)}
              onDelete={() => handleDelete(item.id)}
            />
          ))}
        </div>
      )}

      {/* Create Note Dialog */}
      <Dialog open={isCreating} onOpenChange={setIsCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Note</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Note title..."
            value={newNoteTitle}
            onChange={(e) => setNewNoteTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateNote()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreating(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateNote}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CompactNoteRow({ 
  item, 
  onCopy,
  onPin,
  onStar,
  onEdit,
  onDelete 
}: { 
  item: Item
  onCopy: () => void
  onPin: () => void
  onStar: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const singleLine = (item.content || '').replace(/\s+/g, ' ').trim()
  const preview = singleLine.length > 120 ? `${singleLine.slice(0, 120)}…` : singleLine
  const isPinned = !!item.metadata?.pinned

  return (
    <div className="border rounded-lg p-3 hover:bg-accent/50 transition-colors">
      {/* Line 1: Title + indicators */}
      <div className="flex items-center gap-2 mb-1">
        <h3 className="font-semibold text-sm truncate flex-1">{item.title || 'Untitled'}</h3>
        {isPinned && <Pin className="w-3.5 h-3.5 text-primary shrink-0" />}
        {item.starred && <Star className="w-3.5 h-3.5 fill-yellow-500 text-yellow-500 shrink-0" />}
      </div>

      {/* Line 2: Preview */}
      {preview && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
          {preview}
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
          className="h-7 w-7"
          onClick={onEdit}
          title="Edit"
        >
          <Edit3 className="w-3.5 h-3.5" />
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
