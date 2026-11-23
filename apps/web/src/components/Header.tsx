import { Search, Plus, RefreshCw, Star, FolderOpen, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAppStore } from '@/stores/appStore'
import { cn } from '@/lib/utils'

export function Header() {
  const { 
    searchQuery, 
    setSearchQuery, 
    showStarredOnly, 
    setShowStarredOnly,
    selectedFolder,
    setSelectedFolder,
    activeView,
    setCurrentItem,
    setSidebarOpen
  } = useAppStore()

  const handleCreateNew = () => {
    // Open create dialog based on active view
    switch (activeView) {
      case 'notes':
        setCurrentItem({
          id: 'new',
          type: 'note',
          title: '',
          content: '',
          content_storage: 'inline',
          starred: false,
          folder: 'notes',
          tags: [],
          metadata: {},
          created_at: Date.now(),
          updated_at: Date.now(),
          user_id: 'default'
        } as any)
        break
      case 'prompts':
        setCurrentItem({
          id: 'new',
          type: 'prompt',
          title: '',
          content: '',
          content_storage: 'inline',
          starred: false,
          folder: 'prompts',
          tags: ['ai'],
          metadata: {},
          created_at: Date.now(),
          updated_at: Date.now(),
          user_id: 'default'
        } as any)
        break
      case 'bookmarks':
        setCurrentItem({
          id: 'new',
          type: 'bookmark',
          title: '',
          content: '',
          content_storage: 'inline',
          starred: false,
          folder: 'bookmarks',
          tags: [],
          metadata: {},
          created_at: Date.now(),
          updated_at: Date.now(),
          user_id: 'default'
        } as any)
        break
      default:
        break
    }
  }

  const showCreateButton = ['notes', 'prompts', 'bookmarks', 'research'].includes(activeView)

  return (
    <header className="h-14 border-b border-border bg-card/50 backdrop-blur-sm flex items-center justify-between px-4 gap-3">
      <Button
        variant="ghost"
        size="icon"
        className="h-12 w-12 md:hidden"
        onClick={() => setSidebarOpen(true)}
      >
        <Menu className="w-6 h-6" />
      </Button>

      {/* Search */}
      <div className="flex-1 max-w-xl relative min-w-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search items..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 h-9 bg-background"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Button
          variant={showStarredOnly ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowStarredOnly(!showStarredOnly)}
          className={cn(
            'h-9 gap-2',
            showStarredOnly && 'bg-yellow-500 hover:bg-yellow-600 text-white'
          )}
        >
          <Star className={cn('w-4 h-4', showStarredOnly && 'fill-current')} />
          {showStarredOnly && <span>Starred</span>}
        </Button>

        {selectedFolder && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedFolder(null)}
            className="h-9 gap-2"
          >
            <FolderOpen className="w-4 h-4" />
            <span>{selectedFolder}</span>
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="w-4 h-4" />
        </Button>

        {showCreateButton && (
          <Button 
            size="sm" 
            className="h-9 gap-2"
            onClick={handleCreateNew}
          >
            <Plus className="w-4 h-4" />
            New
          </Button>
        )}
      </div>
    </header>
  )
}
