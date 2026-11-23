import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const cli = require.resolve('@tauri-apps/cli/tauri.js')
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL('../apps/desktop/', import.meta.url)),
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
