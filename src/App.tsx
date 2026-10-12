import { useEffect } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { Header } from '@/components/Header'
import { Dashboard } from '@/views/Dashboard'
import { ClipsView } from '@/views/ClipsView'
import { NotesView } from '@/views/NotesView'
import { PromptsView } from '@/views/PromptsView'
import { BookmarksView } from '@/views/BookmarksView'
import { ResearchView } from '@/views/ResearchView'
import { ChatView } from '@/views/ChatView'
import { SettingsView } from '@/views/SettingsView'
import { StewardsView } from '@/views/StewardsView'
import { CrawlersView } from '@/views/CrawlersView'
import { DeepResearchView } from '@/views/DeepResearchView'
import { ItemDetail } from '@/components/ItemDetail'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/ThemeProvider'
import { useAppStore } from '@/stores/appStore'
import { api } from '@/lib/api'
import { toast } from 'sonner'

function AppContent() {
  const { 
    sidebarOpen, 
    activeView, 
    currentItem,
    setItems, 
    setTags,
    setIsLoading,
    apiUrl
  } = useAppStore()

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true)
      try {
        // Check API health
        await api.health()
        
        // Load items and tags
        const [itemsData, tagsData] = await Promise.all([
          api.getItems({ limit: 100 }),
          api.getTags()
        ])
        
        setItems(itemsData.items || [])
        setTags(tagsData.tags || [])
      } catch (error: any) {
        console.error('Failed to load data:', error)
        toast.error('Failed to connect to API. Check your settings.')
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [setItems, setTags, setIsLoading, apiUrl])

  // Render current view
  const renderView = () => {
    switch (activeView) {
      case 'dashboard':
        return <Dashboard />
      case 'clips':
        return <ClipsView />
      case 'notes':
        return <NotesView />
      case 'prompts':
        return <PromptsView />
      case 'bookmarks':
        return <BookmarksView />
      case 'research':
        return <ResearchView />
      case 'chat':
        return <ChatView />
      case 'stewards':
        return <StewardsView />
      case 'crawlers':
        return <CrawlersView />
      case 'deepresearch':
        return <DeepResearchView />
      case 'settings':
        return <SettingsView />
      default:
        return <Dashboard />
    }
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <Sidebar />
      
      {/* Main Content */}
      <div
        className={
          `flex-1 flex flex-col transition-all duration-300 ` +
          `${sidebarOpen ? 'md:ml-64' : 'md:ml-16'} ml-0`
        }
      >
        <Header />
        
        <main className="flex-1 overflow-auto p-4">
          {renderView()}
        </main>
      </div>
      
      {/* Item Detail Slide-over */}
      {currentItem && <ItemDetail />}
      
      {/* Toast notifications */}
      <Toaster position="top-right" />
    </div>
  )
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="clipsync-theme">
      <AppContent />
    </ThemeProvider>
  )
}

export default App
