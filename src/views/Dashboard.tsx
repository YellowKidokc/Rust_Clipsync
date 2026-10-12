import { useEffect, useState } from 'react'
import { 
  Clipboard, 
  FileText, 
  Terminal, 
  Bookmark, 
  Search, 
  Star,
  Clock,
  TrendingUp
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppStore } from '@/stores/appStore'
import { api } from '@/lib/api'
import type { Item } from '@/types'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'

const typeIcons = {
  clip: Clipboard,
  note: FileText,
  prompt: Terminal,
  bookmark: Bookmark,
  research: Search
}

const typeColors = {
  clip: 'bg-blue-500/10 text-blue-500',
  note: 'bg-green-500/10 text-green-500',
  prompt: 'bg-purple-500/10 text-purple-500',
  bookmark: 'bg-orange-500/10 text-orange-500',
  research: 'bg-pink-500/10 text-pink-500'
}

export function Dashboard() {
  const { items, setCurrentItem, setActiveView } = useAppStore()
  const [stats, setStats] = useState({
    total: 0,
    clips: 0,
    notes: 0,
    prompts: 0,
    bookmarks: 0,
    starred: 0
  })

  useEffect(() => {
    const loadStats = async () => {
      try {
        const [allItems, starredItems] = await Promise.all([
          api.getItems({ limit: 1000 }),
          api.getItems({ starred: true, limit: 1000 })
        ])

        const items = allItems.items || []
        setStats({
          total: items.length,
          clips: items.filter((i: Item) => i.type === 'clip').length,
          notes: items.filter((i: Item) => i.type === 'note').length,
          prompts: items.filter((i: Item) => i.type === 'prompt').length,
          bookmarks: items.filter((i: Item) => i.type === 'bookmark').length,
          starred: (starredItems.items || []).length
        })
      } catch (error) {
        console.error('Failed to load stats:', error)
      }
    }

    loadStats()
  }, [items])

  const recentItems = items.slice(0, 10)
  const starredItems = items.filter(i => i.starred).slice(0, 5)

  const handleItemClick = (item: Item) => {
    setCurrentItem(item)
  }

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard
          title="Total Items"
          value={stats.total}
          icon={TrendingUp}
          color="bg-primary"
        />
        <StatCard
          title="Clipboard"
          value={stats.clips}
          icon={Clipboard}
          color="bg-blue-500"
          onClick={() => setActiveView('clips')}
        />
        <StatCard
          title="Notes"
          value={stats.notes}
          icon={FileText}
          color="bg-green-500"
          onClick={() => setActiveView('notes')}
        />
        <StatCard
          title="Prompts"
          value={stats.prompts}
          icon={Terminal}
          color="bg-purple-500"
          onClick={() => setActiveView('prompts')}
        />
        <StatCard
          title="Bookmarks"
          value={stats.bookmarks}
          icon={Bookmark}
          color="bg-orange-500"
          onClick={() => setActiveView('bookmarks')}
        />
        <StatCard
          title="Starred"
          value={stats.starred}
          icon={Star}
          color="bg-yellow-500"
        />
      </div>

      {/* Recent and Starred */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Items */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="w-5 h-5 text-muted-foreground" />
              Recent Items
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setActiveView('dashboard')}>
              View All
            </Button>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {recentItems.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    No items yet. Start by creating your first note, prompt, or bookmark!
                  </p>
                ) : (
                  recentItems.map((item) => (
                    <ItemRow 
                      key={item.id} 
                      item={item} 
                      onClick={() => handleItemClick(item)} 
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Starred Items */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
              Starred
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setActiveView('dashboard')}>
              View All
            </Button>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {starredItems.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    Star items to see them here. Click the star icon on any item!
                  </p>
                ) : (
                  starredItems.map((item) => (
                    <ItemRow 
                      key={item.id} 
                      item={item} 
                      onClick={() => handleItemClick(item)} 
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setActiveView('notes')}>
              <FileText className="w-4 h-4 mr-2" />
              New Note
            </Button>
            <Button onClick={() => setActiveView('prompts')} variant="secondary">
              <Terminal className="w-4 h-4 mr-2" />
              New Prompt
            </Button>
            <Button onClick={() => setActiveView('bookmarks')} variant="outline">
              <Bookmark className="w-4 h-4 mr-2" />
              Add Bookmark
            </Button>
            <Button onClick={() => setActiveView('research')} variant="outline">
              <Search className="w-4 h-4 mr-2" />
              Deep Research
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  color,
  onClick 
}: { 
  title: string
  value: number
  icon: React.ElementType
  color: string
  onClick?: () => void
}) {
  return (
    <Card 
      className={cn(
        "cursor-pointer transition-all hover:shadow-md",
        onClick && "hover:scale-[1.02]"
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
          <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", color)}>
            <Icon className="w-5 h-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ItemRow({ item, onClick }: { item: Item; onClick: () => void }) {
  const Icon = typeIcons[item.type]
  const colorClass = typeColors[item.type]
  
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition-colors text-left"
    >
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", colorClass)}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{item.title || 'Untitled'}</p>
        <p className="text-xs text-muted-foreground">
          {formatDistanceToNow(item.created_at, { addSuffix: true })}
          {item.tags.length > 0 && ` • ${item.tags.join(', ')}`}
        </p>
      </div>
      {item.starred && (
        <Star className="w-4 h-4 text-yellow-500 fill-yellow-500 flex-shrink-0" />
      )}
    </button>
  )
}
