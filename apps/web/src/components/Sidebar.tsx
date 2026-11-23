import { 
  LayoutDashboard, 
  Clipboard, 
  FileText, 
  Terminal, 
  Bookmark, 
  Search, 
  MessageSquare, 
  Settings,
  Menu,
  X,
  Star,
  Tag,
  Cpu,
  Globe,
  Brain
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { useAppStore } from '@/stores/appStore'
import { cn } from '@/lib/utils'

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'clips', label: 'Clipboard', icon: Clipboard },
  { id: 'notes', label: 'Notes', icon: FileText },
  { id: 'prompts', label: 'Prompts', icon: Terminal },
  { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
  { id: 'research', label: 'Research', icon: Search },
  { id: 'chat', label: 'AI Chat', icon: MessageSquare },
  { id: 'stewards', label: 'Stewards Console', icon: Cpu },
  { id: 'crawlers', label: 'Web Crawlers', icon: Globe },
  { id: 'deepresearch', label: 'Deep Research', icon: Brain },
]

const bottomItems = [
  { id: 'settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const { sidebarOpen, setSidebarOpen, activeView, setActiveView, tags } = useAppStore()

  return (
    <>
      <div className={cn(
        "hidden md:block fixed left-0 top-0 h-full bg-card border-r border-border z-50 transition-all duration-300",
        sidebarOpen ? 'w-64' : 'w-16'
      )}>
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-4 border-b border-border">
          {sidebarOpen ? (
            <>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <Clipboard className="w-4 h-4 text-primary-foreground" />
                </div>
                <span className="font-semibold text-lg">ClipSync</span>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setSidebarOpen(false)}
                className="h-8 w-8"
              >
                <X className="w-4 h-4" />
              </Button>
            </>
          ) : (
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setSidebarOpen(true)}
              className="h-8 w-8 mx-auto"
            >
              <Menu className="w-4 h-4" />
            </Button>
          )}
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 h-[calc(100vh-7rem)]">
          <div className="p-2 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = activeView === item.id
              
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveView(item.id as any)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                    isActive 
                      ? 'bg-primary text-primary-foreground' 
                      : 'hover:bg-accent text-muted-foreground hover:text-foreground',
                    !sidebarOpen && 'justify-center px-2'
                  )}
                  title={!sidebarOpen ? item.label : undefined}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {sidebarOpen && <span className="text-sm font-medium">{item.label}</span>}
                </button>
              )
            })}
          </div>

          {/* Tags Section */}
          {sidebarOpen && tags.length > 0 && (
            <div className="mt-6 px-4">
              <div className="flex items-center gap-2 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <Tag className="w-3 h-3" />
                Tags
              </div>
              <div className="space-y-1">
                {tags.slice(0, 8).map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => setActiveView('dashboard')}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <span 
                      className="w-2 h-2 rounded-full" 
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {tag.usage_count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Starred Section */}
          {sidebarOpen && (
            <div className="mt-6 px-4">
              <button
                onClick={() => setActiveView('dashboard')}
                className="flex items-center gap-2 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
              >
                <Star className="w-3 h-3" />
                Starred
              </button>
            </div>
          )}
        </ScrollArea>

        {/* Bottom Items */}
        <div className="absolute bottom-0 left-0 right-0 p-2 border-t border-border bg-card">
          {bottomItems.map((item) => {
            const Icon = item.icon
            const isActive = activeView === item.id
            
            return (
              <button
                key={item.id}
                onClick={() => setActiveView(item.id as any)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                  isActive 
                    ? 'bg-primary text-primary-foreground' 
                    : 'hover:bg-accent text-muted-foreground hover:text-foreground',
                  !sidebarOpen && 'justify-center px-2'
                )}
                title={!sidebarOpen ? item.label : undefined}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {sidebarOpen && <span className="text-sm font-medium">{item.label}</span>}
              </button>
            )
          })}
        </div>
      </div>

      <div className="md:hidden">
        <Drawer open={sidebarOpen} onOpenChange={setSidebarOpen} direction="left">
          <DrawerContent className="p-0">
            <div className="flex items-center justify-between h-14 px-4 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <Clipboard className="w-4 h-4 text-primary-foreground" />
                </div>
                <span className="font-semibold text-lg">ClipSync</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(false)}
                className="h-8 w-8"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <ScrollArea className="h-[calc(100vh-3.5rem)]">
              <div className="p-2">
                <Accordion type="multiple" className="w-full">
                  <AccordionItem value="nav">
                    <AccordionTrigger className="px-2">Navigation</AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-1 pt-2">
                        {navItems.map((item) => {
                          const Icon = item.icon
                          const isActive = activeView === item.id
                          
                          return (
                            <button
                              key={item.id}
                              onClick={() => {
                                setActiveView(item.id as any)
                                setSidebarOpen(false)
                              }}
                              className={cn(
                                "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                                isActive 
                                  ? 'bg-primary text-primary-foreground' 
                                  : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                              )}
                            >
                              <Icon className="w-5 h-5 flex-shrink-0" />
                              <span className="text-sm font-medium">{item.label}</span>
                            </button>
                          )
                        })}
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {tags.length > 0 && (
                    <AccordionItem value="tags">
                      <AccordionTrigger className="px-2">Tags</AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-1 pt-2">
                          {tags.slice(0, 12).map((tag) => (
                            <button
                              key={tag.id}
                              onClick={() => {
                                setActiveView('dashboard')
                                setSidebarOpen(false)
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                            >
                              <span 
                                className="w-2 h-2 rounded-full" 
                                style={{ backgroundColor: tag.color }}
                              />
                              <span className="truncate">{tag.name}</span>
                              <span className="ml-auto text-xs text-muted-foreground">
                                {tag.usage_count}
                              </span>
                            </button>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  <AccordionItem value="settings">
                    <AccordionTrigger className="px-2">Settings</AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-1 pt-2">
                        {bottomItems.map((item) => {
                          const Icon = item.icon
                          const isActive = activeView === item.id

                          return (
                            <button
                              key={item.id}
                              onClick={() => {
                                setActiveView(item.id as any)
                                setSidebarOpen(false)
                              }}
                              className={cn(
                                "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                                isActive 
                                  ? 'bg-primary text-primary-foreground' 
                                  : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                              )}
                            >
                              <Icon className="w-5 h-5 flex-shrink-0" />
                              <span className="text-sm font-medium">{item.label}</span>
                            </button>
                          )
                        })}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            </ScrollArea>
          </DrawerContent>
        </Drawer>
      </div>
    </>
  )
}
