import { useState } from 'react'
import { Settings, Server, Key, Monitor, Moon, Sun, Download } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAppStore } from '@/stores/appStore'
import { useTheme } from '@/components/ThemeProvider'
import { api } from '@/lib/api'
import { toast } from 'sonner'

export function SettingsView() {
  const { apiUrl, setApiUrl, deviceId, setDeviceId } = useAppStore()
  const { theme, setTheme } = useTheme()
  const [localApiUrl, setLocalApiUrl] = useState(apiUrl)
  const [localDeviceId, setLocalDeviceId] = useState(deviceId)

  const handleSaveApi = () => {
    setApiUrl(localApiUrl)
    toast.success('API URL saved')
  }

  const handleSaveDevice = () => {
    setDeviceId(localDeviceId)
    toast.success('Device ID saved')
  }

  const handleExportData = () => {
    const data = JSON.stringify({ apiUrl, deviceId, theme: theme }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'clipsync-settings.json'
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Settings exported')
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-2xl font-bold flex items-center gap-2">
        <Settings className="w-6 h-6" />
        Settings
      </h2>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="api">API</TabsTrigger>
          <TabsTrigger value="sync">Sync</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Customize how ClipSync looks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Theme</Label>
                <div className="flex gap-2 mt-2">
                  <Button
                    variant={theme === 'light' ? 'default' : 'outline'}
                    onClick={() => setTheme('light')}
                    className="gap-2"
                  >
                    <Sun className="w-4 h-4" />
                    Light
                  </Button>
                  <Button
                    variant={theme === 'dark' ? 'default' : 'outline'}
                    onClick={() => setTheme('dark')}
                    className="gap-2"
                  >
                    <Moon className="w-4 h-4" />
                    Dark
                  </Button>
                  <Button
                    variant={theme === 'system' ? 'default' : 'outline'}
                    onClick={() => setTheme('system')}
                    className="gap-2"
                  >
                    <Monitor className="w-4 h-4" />
                    System
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="w-5 h-5" />
                API Configuration
              </CardTitle>
              <CardDescription>Configure your ClipSync API endpoint</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="api-url">API URL</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    id="api-url"
                    value={localApiUrl}
                    onChange={(e) => setLocalApiUrl(e.target.value)}
                    placeholder="https://your-worker.your-subdomain.workers.dev/api"
                  />
                  <Button onClick={handleSaveApi}>Save</Button>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  Your Cloudflare Worker API endpoint
                </p>
              </div>

              <div className="pt-4 border-t">
                <Label>API Status</Label>
                <div className="mt-2">
                  <ApiStatus />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                Device Sync
              </CardTitle>
              <CardDescription>Configure clipboard sync between devices</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="device-id">Device ID</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    id="device-id"
                    value={localDeviceId}
                    onChange={(e) => setLocalDeviceId(e.target.value)}
                    placeholder="device-12345"
                  />
                  <Button onClick={handleSaveDevice}>Save</Button>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  Unique identifier for this device. Used for clipboard sync.
                </p>
              </div>

              <div className="pt-4 border-t">
                <Label>Windows Agent</Label>
                <p className="text-sm text-muted-foreground mt-2">
                  Download the Windows clipboard agent for automatic sync
                </p>
                <Button variant="outline" className="mt-2" asChild>
                  <a href="/clipboard_agent.py" download>
                    <Download className="w-4 h-4 mr-2" />
                    Download Agent
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Data Management</CardTitle>
              <CardDescription>Export and manage your data</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Export Settings</Label>
                <p className="text-sm text-muted-foreground mt-2">
                  Download your settings as a JSON file
                </p>
                <Button variant="outline" className="mt-2" onClick={handleExportData}>
                  <Download className="w-4 h-4 mr-2" />
                  Export Settings
                </Button>
              </div>

              <div className="pt-4 border-t">
                <Label className="text-destructive">Danger Zone</Label>
                <p className="text-sm text-muted-foreground mt-2">
                  Clear all local data and reset settings
                </p>
                <Button 
                  variant="destructive" 
                  className="mt-2"
                  onClick={() => {
                    localStorage.clear()
                    toast.success('Local data cleared')
                    window.location.reload()
                  }}
                >
                  Clear All Data
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ApiStatus() {
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking')

  const checkStatus = async () => {
    setStatus('checking')
    try {
      await api.health()
      setStatus('online')
    } catch (error) {
      setStatus('offline')
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className={`
        w-3 h-3 rounded-full
        ${status === 'checking' ? 'bg-yellow-500 animate-pulse' : ''}
        ${status === 'online' ? 'bg-green-500' : ''}
        ${status === 'offline' ? 'bg-red-500' : ''}
      `} />
      <span className="text-sm capitalize">{status}</span>
      <Button variant="ghost" size="sm" onClick={checkStatus}>
        Check
      </Button>
    </div>
  )
}
