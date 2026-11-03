// Bridge to the Tauri shell. Every function is a no-op in the browser/PWA, so the same bundle
// runs on Cloudflare Pages and inside the desktop app.
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function core() {
  return import('@tauri-apps/api/core')
}

export interface DesktopConfig {
  api_url: string
  device_id: string
  capture_enabled: boolean
  hotkey: string
  autostart: boolean
}

export async function getDesktopConfig(): Promise<DesktopConfig | null> {
  if (!isDesktop) return null
  return (await core()).invoke<DesktopConfig>('get_config')
}

export async function setDesktopConfig(patch: Partial<DesktopConfig>): Promise<DesktopConfig | null> {
  if (!isDesktop) return null
  return (await core()).invoke<DesktopConfig>('set_config', { patch })
}

/** Put text on the clipboard, hide the picker, and send Ctrl+V to the window that was focused before. */
export async function pasteText(text: string): Promise<void> {
  if (!isDesktop) {
    await navigator.clipboard.writeText(text)
    return
  }
  await (await core()).invoke('paste_text', { text })
}

export async function hidePicker(): Promise<void> {
  if (!isDesktop) return
  await (await core()).invoke('hide_picker')
}

export async function openMainWindow(): Promise<void> {
  if (!isDesktop) return
  await (await core()).invoke('show_main')
}

export async function onDesktopEvent<T>(name: string, cb: (payload: T) => void): Promise<() => void> {
  if (!isDesktop) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  return listen<T>(name, e => cb(e.payload))
}
