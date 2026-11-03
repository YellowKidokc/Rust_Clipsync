import { useEffect, useState } from 'react'
import { Keyboard, Power, ClipboardCopy } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { getDesktopConfig, isDesktop, setDesktopConfig, type DesktopConfig } from '@/lib/desktop'
import { toast } from 'sonner'

/** Settings for the Tauri shell. Renders nothing in the browser/PWA. */
export function DesktopSettings() {
  const [cfg, setCfg] = useState<DesktopConfig | null>(null)
  const [hotkey, setHotkey] = useState('')

  useEffect(() => {
    getDesktopConfig().then(c => { setCfg(c); setHotkey(c?.hotkey || '') })
  }, [])

  if (!isDesktop || !cfg) return null

  const save = async (patch: Partial<DesktopConfig>) => {
    try {
      const next = await setDesktopConfig(patch)
      if (next) setCfg(next)
      toast.success('Desktop settings saved')
    } catch (e: any) {
      toast.error(String(e))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Desktop</CardTitle>
        <CardDescription>Tray app, hotkey picker and clipboard capture. Secrets are masked before upload.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-2"><ClipboardCopy className="h-4 w-4" />Capture clipboard</Label>
          <Switch checked={cfg.capture_enabled} onCheckedChange={v => save({ capture_enabled: v })} />
        </div>
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-2"><Power className="h-4 w-4" />Start with Windows</Label>
          <Switch checked={cfg.autostart} onCheckedChange={v => save({ autostart: v })} />
        </div>
        <div className="space-y-1">
          <Label className="flex items-center gap-2"><Keyboard className="h-4 w-4" />Picker hotkey</Label>
          <div className="flex gap-2">
            <Input value={hotkey} onChange={e => setHotkey(e.target.value)} placeholder="ctrl+shift+space" />
            <Button variant="outline" onClick={() => save({ hotkey })}>Set</Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Device: {cfg.device_id} · pushing to {cfg.api_url}</p>
      </CardContent>
    </Card>
  )
}
