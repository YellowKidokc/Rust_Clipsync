import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Item, Tag, ChatMessage } from '@/types'

interface AppState {
  // UI State
  sidebarOpen: boolean
  activeView: 'dashboard' | 'clips' | 'notes' | 'prompts' | 'bookmarks' | 'research' | 'chat' | 'stewards' | 'crawlers' | 'deepresearch' | 'settings'
  searchQuery: string
  selectedFolder: string | null
  selectedTags: string[]
  showStarredOnly: boolean
  
  // Data
  items: Item[]
  tags: Tag[]
  currentItem: Item | null
  isLoading: boolean
  
  // Chat
  chatMessages: ChatMessage[]
  isStreaming: boolean
  
  // Settings
  apiUrl: string
  openaiModel: string
  deviceId: string
  
  // Actions
  setSidebarOpen: (open: boolean) => void
  setActiveView: (view: AppState['activeView']) => void
  setSearchQuery: (query: string) => void
  setSelectedFolder: (folder: string | null) => void
  toggleTag: (tag: string) => void
  setShowStarredOnly: (show: boolean) => void
  setItems: (items: Item[]) => void
  addItem: (item: Item) => void
  updateItem: (id: string, updates: Partial<Item>) => void
  removeItem: (id: string) => void
  setTags: (tags: Tag[]) => void
  setCurrentItem: (item: Item | null) => void
  setIsLoading: (loading: boolean) => void
  addChatMessage: (message: ChatMessage) => void
  clearChat: () => void
  setIsStreaming: (streaming: boolean) => void
  setApiUrl: (url: string) => void
  setOpenaiModel: (model: string) => void
  setDeviceId: (id: string) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Initial state
      sidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
      activeView: 'dashboard',
      searchQuery: '',
      selectedFolder: null,
      selectedTags: [],
      showStarredOnly: false,
      items: [],
      tags: [],
      currentItem: null,
      isLoading: false,
      chatMessages: [],
      isStreaming: false,
      apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:8787/api',
      openaiModel: 'gpt-4o',
      deviceId: `device-${Math.random().toString(36).substring(2, 9)}`,
      
      // Actions
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setActiveView: (view) => set({ activeView: view }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setSelectedFolder: (folder) => set({ selectedFolder: folder }),
      toggleTag: (tag) => set((state) => ({
        selectedTags: state.selectedTags.includes(tag)
          ? state.selectedTags.filter(t => t !== tag)
          : [...state.selectedTags, tag]
      })),
      setShowStarredOnly: (show) => set({ showStarredOnly: show }),
      setItems: (items) => set({ items }),
      addItem: (item) => set((state) => ({ items: [item, ...state.items] })),
      updateItem: (id, updates) => set((state) => ({
        items: state.items.map(item => 
          item.id === id ? { ...item, ...updates } : item
        )
      })),
      removeItem: (id) => set((state) => ({
        items: state.items.filter(item => item.id !== id)
      })),
      setTags: (tags) => set({ tags }),
      setCurrentItem: (item) => set({ currentItem: item }),
      setIsLoading: (loading) => set({ isLoading: loading }),
      addChatMessage: (message) => set((state) => ({
        chatMessages: [...state.chatMessages, message]
      })),
      clearChat: () => set({ chatMessages: [] }),
      setIsStreaming: (streaming) => set({ isStreaming: streaming }),
      setApiUrl: (url) => set({ apiUrl: url }),
      setOpenaiModel: (model) => set({ openaiModel: model }),
      setDeviceId: (id) => set({ deviceId: id })
    }),
    {
      name: 'clipsync-storage',
      partialize: (state) => ({
        apiUrl: state.apiUrl,
        openaiModel: state.openaiModel,
        deviceId: state.deviceId,
        sidebarOpen: state.sidebarOpen
      })
    }
  )
)
