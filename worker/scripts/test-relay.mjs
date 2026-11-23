import assert from 'node:assert/strict'
import { once } from 'node:events'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import WebSocket from 'ws'

const scratch = await mkdtemp(join(tmpdir(), 'clipsync-relay-'))
const env = { ...process.env, XDG_CONFIG_HOME: scratch, WRANGLER_SEND_METRICS: 'false' }
const cli = join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const socketServer = createServer()
let worker
let ws
let output = ''
try {
  socketServer.listen(0, '127.0.0.1')
  await once(socketServer, 'listening')
  const port = socketServer.address().port
  await new Promise((resolve) => socketServer.close(resolve))
  const origin = `http://127.0.0.1:${port}`
  const db = ['d1', 'execute', 'clipsync-relay', '--local', '--persist-to', scratch]
  const credentials = join(scratch, 'credentials.json')
  const seed = join(scratch, 'devices.sql')
  const otherCredentials = join(scratch, 'other.json')
  const otherSeed = join(scratch, 'other.sql')
  const run = (args) => execFileSync(process.execPath, args, { env, stdio: 'pipe' })
  run(['scripts/provision.mjs', credentials, seed, '2'])
  run(['scripts/provision.mjs', otherCredentials, otherSeed, '1'])
  run([cli, ...db, '--file', 'migrations/0001_relay.sql'])
  run([cli, ...db, '--file', seed])
  run([cli, ...db, '--file', otherSeed])
  const { account, devices: [a, b] } = JSON.parse(await readFile(credentials, 'utf8'))
  const { devices: [other] } = JSON.parse(await readFile(otherCredentials, 'utf8'))

  worker = spawn(process.execPath, [cli, 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', scratch], { env })
  worker.stdout.on('data', (data) => { output += data })
  worker.stderr.on('data', (data) => { output += data })
  const request = (path, device, options = {}) => fetch(origin + path, {
    ...options,
    signal: AbortSignal.timeout(4000),
    headers: device ? { Authorization: `Bearer ${device.token}` } : {},
  })
  let healthy = false
  for (let tries = 0; tries < 50; tries += 1) {
    healthy = await request('/health').then((response) => response.ok, () => false)
    if (healthy) break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  assert.ok(healthy, 'Wrangler did not become ready')

  assert.equal((await request('/v1/events')).status, 401)
  assert.deepEqual(await (await request('/v1/session', b)).json(), { account, device: b.id })

  ws = new WebSocket(origin.replace(/^http/, 'ws') + '/v1/live', {
    headers: { Authorization: `Bearer ${b.token}` },
    handshakeTimeout: 4000,
  })
  await once(ws, 'open', { signal: AbortSignal.timeout(4000) })
  const notification = once(ws, 'message', { signal: AbortSignal.timeout(4000) })
  notification.catch(() => {})
  const payload = randomBytes(128)
  const upload = (body) => request(`/v1/events/${a.id}`, a, { method: 'PUT', body })
  assert.equal((await upload(Buffer.alloc(20))).status, 413)
  const first = await upload(payload)
  assert.equal(first.status, 200)
  const { seq } = await first.json()
  assert.ok(seq > 0)
  const [message] = await notification
  assert.equal(message.toString(), 'changed')

  assert.deepEqual(await (await upload(randomBytes(128))).json(), { seq })
  const events = await (await request('/v1/events?after=0', b)).json()
  assert.deepEqual(events, [{ seq, device: a.id, op: a.id, size: payload.length }])
  assert.deepEqual(await (await request(`/v1/events?after=${seq}`, b)).json(), [])
  const resource = `/v1/events/${a.id}/${a.id}`
  assert.deepEqual(Buffer.from(await (await request(resource, b)).arrayBuffer()), payload)
  assert.deepEqual(await (await request('/v1/events', other)).json(), [])
  assert.equal((await request(resource, other)).status, 404)
  const wrongToken = { token: 'csdev_' + createHash('sha256').update(a.token).digest('hex') }
  assert.equal((await request(resource, wrongToken)).status, 401)
  console.log('Relay verified device authentication, account isolation, idempotent ciphertext upload, cursor, R2 download, and WebSocket notification.')
} catch (error) {
  console.error(output)
  throw error
} finally {
  ws?.terminate()
  if (worker && worker.exitCode === null) {
    worker.kill()
    await once(worker, 'exit')
  }
  await rm(scratch, { recursive: true, force: true })
}
