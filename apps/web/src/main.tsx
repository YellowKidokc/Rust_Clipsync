import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { isTauri } from '@tauri-apps/api/core'
import DesktopApp from './DesktopApp'
import './index.css'

const LegacyApp = import.meta.env.DEV && import.meta.env.VITE_ENABLE_LEGACY_UI === 'true'
  ? lazy(() => import('./App'))
  : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isTauri() ? <DesktopApp /> : LegacyApp
      ? <Suspense><LegacyApp /></Suspense>
      : <main className="p-6">Open ClipSync in its desktop window.</main>}
  </StrictMode>,
)
