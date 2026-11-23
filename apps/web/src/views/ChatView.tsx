import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Trash2, Copy, Check } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppStore } from '@/stores/appStore'
import { api } from '@/lib/api'
import type { ChatMessage } from '@/types'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { marked } from 'marked'
import DOMPurify from 'isomorphic-dompurify'

const models = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet' },
  { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
]

export function ChatView() {
  const { chatMessages, addChatMessage, clearChat, isStreaming, setIsStreaming, openaiModel, setOpenaiModel } = useAppStore()
  const [input, setInput] = useState('')
  const [streamingContent, setStreamingContent] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [chatMessages, streamingContent])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return

    const userMessage: ChatMessage = { role: 'user', content: input }
    addChatMessage(userMessage)
    setInput('')
    setIsStreaming(true)
    setStreamingContent('')

    try {
      const messages = [...chatMessages, userMessage]
      const response = await api.chat(messages, { model: openaiModel, stream: true })

      if (!response.body) {
        throw new Error('No response body')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              const content = parsed.choices?.[0]?.delta?.content || ''
              if (content) {
                fullContent += content
                setStreamingContent(fullContent)
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }

      // Add completed message
      addChatMessage({ role: 'assistant', content: fullContent })
      setStreamingContent('')
    } catch (error: any) {
      toast.error('Failed to get response: ' + error.message)
    } finally {
      setIsStreaming(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const renderMarkdown = (content: string) => {
    const html = marked.parse(content || '', { async: false }) as string
    return DOMPurify.sanitize(html)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Bot className="w-6 h-6 text-primary" />
          AI Chat
        </h2>
        <div className="flex items-center gap-2">
          <Select value={openaiModel} onValueChange={setOpenaiModel}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {models.map(m => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" onClick={clearChat}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Chat Messages */}
      <Card className="flex-1 flex flex-col overflow-hidden">
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-4">
            {chatMessages.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Bot className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Start a conversation with AI</p>
                <p className="text-sm mt-2">Ask questions, get help with research, or brainstorm ideas</p>
              </div>
            ) : (
              chatMessages.map((message, idx) => (
                <ChatMessageComponent 
                  key={idx} 
                  message={message}
                  renderMarkdown={renderMarkdown}
                />
              ))
            )}
            
            {/* Streaming message */}
            {isStreaming && streamingContent && (
              <ChatMessageComponent 
                message={{ role: 'assistant', content: streamingContent }}
                renderMarkdown={renderMarkdown}
                isStreaming
              />
            )}
          </div>
        </ScrollArea>

        {/* Input Area */}
        <CardContent className="border-t p-4">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              placeholder="Type your message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              className="flex-1"
            />
            <Button 
              onClick={handleSend} 
              disabled={!input.trim() || isStreaming}
            >
              {isStreaming ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ChatMessageComponent({ 
  message, 
  renderMarkdown,
  isStreaming 
}: { 
  message: ChatMessage
  renderMarkdown: (content: string) => string
  isStreaming?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={cn(
      "flex gap-3",
      isUser ? 'flex-row-reverse' : 'flex-row'
    )}>
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
        isUser ? 'bg-primary' : 'bg-muted'
      )}>
        {isUser ? (
          <User className="w-4 h-4 text-primary-foreground" />
        ) : (
          <Bot className="w-4 h-4" />
        )}
      </div>
      
      <div className={cn(
        "flex-1 max-w-[80%]",
        isUser && 'text-right'
      )}>
        <div className={cn(
          "inline-block rounded-lg p-3 text-left",
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        )}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div 
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
            />
          )}
        </div>
        
        {!isUser && !isStreaming && (
          <div className="flex items-center gap-1 mt-1 opacity-0 hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
