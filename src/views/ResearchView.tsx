import { useState } from 'react'
import { Search, Play, Loader2, ExternalLink, BookOpen, Sparkles, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppStore } from '@/stores/appStore'
import { api } from '@/lib/api'
import type { Item, ResearchResult, ResearchSource } from '@/types'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { marked } from 'marked'
import DOMPurify from 'isomorphic-dompurify'

export function ResearchView() {
  const { items, setItems } = useAppStore()
  const [query, setQuery] = useState('')
  const [depth, setDepth] = useState<'quick' | 'medium' | 'deep'>('medium')
  const [sources, setSources] = useState(5)
  const [isResearching, setIsResearching] = useState(false)
  const [activeResearch, setActiveResearch] = useState<(Item & { research?: ResearchResult }) | null>(null)

  const researchItems = items.filter(i => i.type === 'research') as (Item & { research?: ResearchResult })[]

  const handleStartResearch = async () => {
    if (!query.trim()) {
      toast.error('Enter a research query')
      return
    }

    setIsResearching(true)
    try {
      const result = await api.startResearch({
        query,
        depth,
        sources
      })
      
      toast.success('Research started!')
      
      // Start polling for status
      const interval = setInterval(async () => {
        try {
          const status = await api.getResearchStatus(result.item_id)
          
          if (status.status === 'completed') {
            clearInterval(interval)
            setIsResearching(false)
            
            // Load the completed research
            const research = await api.getResearch(result.item_id)
            setActiveResearch(research)
            
            // Add to items list
            setItems([research, ...items])
            
            toast.success('Research completed!')
          } else if (status.status === 'failed') {
            clearInterval(interval)
            setIsResearching(false)
            toast.error('Research failed')
          }
        } catch (error) {
          console.error('Polling error:', error)
        }
      }, 3000)
    } catch (error) {
      toast.error('Failed to start research')
      setIsResearching(false)
    }
  }

  const renderMarkdown = (content: string) => {
    const html = marked.parse(content || '', { async: false }) as string
    return DOMPurify.sanitize(html)
  }

  return (
    <div className="space-y-4">
      {/* Research Input */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Deep Research
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="Enter your research topic or question..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-h-[100px]"
          />
          
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Depth:</span>
              <Select value={depth} onValueChange={(v: any) => setDepth(v)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quick">Quick</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="deep">Deep</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Sources:</span>
              <Select value={String(sources)} onValueChange={(v) => setSources(Number(v))}>
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="15">15</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <Button 
              onClick={handleStartResearch} 
              disabled={isResearching || !query.trim()}
              className="ml-auto"
            >
              {isResearching ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Researching...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Start Research
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Active Research Result */}
      {activeResearch && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BookOpen className="w-5 h-5" />
              {activeResearch.title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Synthesis */}
              {activeResearch.research?.synthesis && (
                <div>
                  <h3 className="font-medium mb-3 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    AI Synthesis
                  </h3>
                  <div 
                    className="prose prose-sm dark:prose-invert max-w-none bg-muted p-4 rounded-lg"
                    dangerouslySetInnerHTML={{ 
                      __html: renderMarkdown(activeResearch.research.synthesis) 
                    }}
                  />
                </div>
              )}

              {/* Sources */}
              {activeResearch.research?.sources && activeResearch.research.sources.length > 0 && (
                <div>
                  <h3 className="font-medium mb-3 flex items-center gap-2">
                    <Search className="w-4 h-4" />
                    Sources ({activeResearch.research.sources.length})
                  </h3>
                  <div className="space-y-2">
                    {activeResearch.research.sources.map((source: ResearchSource, idx: number) => (
                      <SourceCard key={idx} source={source} index={idx + 1} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Research History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Research History</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {researchItems.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No research history yet. Start your first research!
                </p>
              ) : (
                researchItems.map((item) => (
                  <ResearchHistoryItem
                    key={item.id}
                    item={item}
                    onClick={() => setActiveResearch(item)}
                    isActive={activeResearch?.id === item.id}
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

function SourceCard({ source, index }: { source: ResearchSource; index: number }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border hover:border-primary/50 transition-colors">
      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-sm font-medium">
        {index}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <a 
            href={source.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="font-medium hover:text-primary flex items-center gap-1"
          >
            {source.title || source.url}
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        {source.description && (
          <p className="text-sm text-muted-foreground mt-1">{source.description}</p>
        )}
        {source.relevance_score && (
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="secondary" className="text-xs">
              Relevance: {source.relevance_score}/10
            </Badge>
            {source.ranking_reason && (
              <span className="text-xs text-muted-foreground">{source.ranking_reason}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ResearchHistoryItem({ 
  item, 
  onClick, 
  isActive 
}: { 
  item: Item & { research?: ResearchResult }
  onClick: () => void
  isActive: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors",
        isActive ? 'bg-primary/10 border border-primary/50' : 'hover:bg-accent border border-transparent'
      )}
    >
      <Search className="w-5 h-5 text-pink-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{item.title}</p>
        <p className="text-xs text-muted-foreground">
          {item.research?.query.slice(0, 100)}...
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={item.research?.status === 'completed' ? 'default' : 'secondary'} className="text-xs">
          {item.research?.status}
        </Badge>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatDistanceToNow(item.created_at, { addSuffix: true })}
        </span>
      </div>
    </button>
  )
}
