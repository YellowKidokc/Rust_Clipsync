import { useMemo, useState } from 'react'
import { Terminal, Plus, Star, Trash2, Copy, Code, Pin, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/stores/appStore'
import { api } from '@/lib/api'
import type { Item, Prompt } from '@/types'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function PromptsView() {
  const { items, setItems } = useAppStore()
  const [isCreating, setIsCreating] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<(Item & { prompt?: Prompt }) | null>(null)
  const [filter, setFilter] = useState('')
  const [newPrompt, setNewPrompt] = useState({
    title: '',
    template: '',
    shortcut: ''
  })

  const promptItems = items.filter(i => i.type === 'prompt') as (Item & { prompt?: Prompt })[]

  const filteredPrompts = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const base = !q ? promptItems : promptItems.filter((p) => {
      const template = (p.prompt?.template || p.content || '').toLowerCase()
      const title = (p.title || '').toLowerCase()
      const shortcut = (p.prompt?.shortcut || '').toLowerCase()
      const tags = (p.tags || []).join(' ').toLowerCase()
      return (
        template.includes(q) ||
        title.includes(q) ||
        shortcut.includes(q) ||
        tags.includes(q)
      )
    })
    return [...base].sort((a, b) => {
      const ap = a.metadata?.pinned ? 1 : 0
      const bp = b.metadata?.pinned ? 1 : 0
      if (ap !== bp) return bp - ap
      const at = (a.updated_at || a.created_at || 0)
      const bt = (b.updated_at || b.created_at || 0)
      return bt - at
    })
  }, [filter, promptItems])

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

  const handleCreatePrompt = async () => {
    if (!newPrompt.template.trim()) {
      toast.error('Template is required')
      return
    }
    
    try {
      const prompt = await api.createPrompt({
        title: newPrompt.title,
        template: newPrompt.template,
        shortcut: newPrompt.shortcut || undefined,
        tags: ['ai']
      })
      setItems([prompt, ...items])
      setNewPrompt({ title: '', template: '', shortcut: '' })
      setIsCreating(false)
      toast.success('Prompt created')
    } catch (error) {
      toast.error('Failed to create prompt')
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
      toast.success('Prompt deleted')
    } catch (error) {
      toast.error('Failed to delete')
    }
  }

  const handleCopyTemplate = (template: string) => {
    navigator.clipboard.writeText(template)
    toast.success('Template copied')
  }

  const handleExportAllAhk = async () => {
    try {
      const script = await api.exportAllAhk()
      const blob = new Blob([script], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'clipsync_prompts.ahk'
      a.click()
      URL.revokeObjectURL(url)
      toast.success('All prompts exported')
    } catch (error) {
      toast.error('Failed to export')
    }
  }

  const extractVariables = (template: string): string[] => {
    const matches = template.match(/\{\{(\w+)\}\}/g)
    if (!matches) return []
    return [...new Set(matches.map(m => m.slice(2, -2)))]
  }

  const makeSummary = (template: string) => {
    const singleLine = template.replace(/\s+/g, ' ').trim()
    if (!singleLine) return ''
    return singleLine.length > 110 ? `${singleLine.slice(0, 110)}…` : singleLine
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold">Prompts</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
          <Button variant="outline" onClick={handleExportAllAhk} className="justify-center">
            <Download className="w-4 h-4 mr-2" />
            Export All AHK
          </Button>
          <Button onClick={() => setIsCreating(true)} className="justify-center">
            <Plus className="w-4 h-4 mr-2" />
            New Prompt
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Search prompts..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {filteredPrompts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Terminal className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>{promptItems.length === 0 ? 'No prompts yet. Create your first prompt!' : 'No prompts match your search.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredPrompts.map((item) => {
            const template = item.prompt?.template || item.content
            const shortcut = item.prompt?.shortcut
            const summary = makeSummary(template)
            const isPinned = !!item.metadata?.pinned
            return (
              <CompactPromptRow
                key={item.id}
                item={item}
                shortcut={shortcut}
                summary={summary}
                isPinned={isPinned}
                onCopy={() => handleCopyTemplate(template)}
                onPin={() => handleTogglePin(item)}
                onStar={() => handleToggleStar(item)}
                onEdit={() => setEditingPrompt(item)}
                onDelete={() => handleDelete(item.id)}
              />
            )
          })}
        </div>
      )}

      {/* Create Prompt Dialog */}
      <Dialog open={isCreating} onOpenChange={setIsCreating}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create New Prompt</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Title (optional)</label>
              <Input
                placeholder="Prompt title..."
                value={newPrompt.title}
                onChange={(e) => setNewPrompt({ ...newPrompt, title: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Template</label>
              <Textarea
                placeholder="Enter prompt template... Use {{variable}} for placeholders"
                value={newPrompt.template}
                onChange={(e) => setNewPrompt({ ...newPrompt, template: e.target.value })}
                className="min-h-[150px] font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Use {'{{variable}}'} syntax for placeholders
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">AutoHotkey Shortcut (optional)</label>
              <Input
                placeholder="e.g., !p (Alt+P) or ^!p (Ctrl+Alt+P)"
                value={newPrompt.shortcut}
                onChange={(e) => setNewPrompt({ ...newPrompt, shortcut: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                ^ = Ctrl, ! = Alt, + = Shift
              </p>
            </div>
            {newPrompt.template && (
              <div>
                <label className="text-sm font-medium">Detected Variables</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {extractVariables(newPrompt.template).map(v => (
                    <Badge key={v} variant="secondary">{v}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreating(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreatePrompt}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Prompt Dialog */}
      <Dialog open={!!editingPrompt} onOpenChange={() => setEditingPrompt(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Prompt</DialogTitle>
          </DialogHeader>
          {editingPrompt && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Template</label>
                <Textarea
                  defaultValue={editingPrompt.prompt?.template || editingPrompt.content}
                  className="min-h-[150px] font-mono"
                  id="edit-template"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Shortcut</label>
                <Input
                  defaultValue={editingPrompt.prompt?.shortcut || ''}
                  id="edit-shortcut"
                  placeholder="e.g., !p"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPrompt(null)}>
              Cancel
            </Button>
            <Button onClick={async () => {
              if (!editingPrompt) return
              const template = (document.getElementById('edit-template') as HTMLTextAreaElement)?.value
              const shortcut = (document.getElementById('edit-shortcut') as HTMLInputElement)?.value
              
              try {
                await api.updatePrompt(editingPrompt.id, { template, shortcut })
                toast.success('Prompt updated')
                setEditingPrompt(null)
                // Reload prompts
                const data = await api.getPrompts()
                const nonPrompts = items.filter(i => i.type !== 'prompt')
                setItems([...nonPrompts, ...(data.items || [])])
              } catch (error) {
                toast.error('Failed to update')
              }
            }}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CompactPromptRow({
  item,
  shortcut,
  summary,
  isPinned,
  onCopy,
  onPin,
  onStar,
  onEdit,
  onDelete
}: {
  item: Item & { prompt?: Prompt }
  shortcut?: string
  summary: string
  isPinned: boolean
  onCopy: () => void
  onPin: () => void
  onStar: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="border rounded-lg p-3 hover:bg-accent/50 transition-colors">
      {/* Line 1: Title + indicators */}
      <div className="flex items-center gap-2 mb-1">
        <h3 className="font-semibold text-sm truncate flex-1">{item.title || 'Untitled'}</h3>
        {isPinned && <Pin className="w-3.5 h-3.5 text-primary shrink-0" />}
        {shortcut && (
          <Badge variant="secondary" className="text-[10px] h-5 px-1.5 shrink-0">
            {shortcut}
          </Badge>
        )}
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
          className="h-7 w-7"
          onClick={onEdit}
          title="Edit"
        >
          <Code className="w-3.5 h-3.5" />
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
      </div>
    </div>
  )
}
