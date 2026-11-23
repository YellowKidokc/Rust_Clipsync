import { DurableObject } from 'cloudflare:workers'

const maxBytes = 66 * 1024 * 1024
const ulid = '[0-7][0-9A-HJKMNP-TV-Z]{25}'
const operationRoute = new RegExp(`^/v1/events/(${ulid})$`)
const downloadRoute = new RegExp(`^/v1/events/(${ulid})/(${ulid})$`)

interface Device {
  account: string
  device: string
}

export class AccountEvents extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(null, { status: 426 })
    }
    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  notify(): void {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send('changed')
      } catch {
        socket.close(1011, 'Reconnect')
      }
    }
  }
}

function reply(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function authenticate(request: Request, env: Env): Promise<Device | null> {
  const token = /^Bearer (csdev_[0-9a-f]{64})$/.exec(request.headers.get('Authorization') ?? '')?.[1]
  if (!token) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return env.RELAY_DB.prepare('SELECT account, device FROM devices WHERE token_hash = ?')
    .bind(hash).first<Device>()
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/health' && request.method === 'GET') return reply({ ok: true })
  const session = await authenticate(request, env)
  if (!session) return reply({ error: 'Unauthorized device' }, 401)
  const { account, device } = session

  if (request.method === 'GET' && url.pathname === '/v1/session') return reply(session)
  if (request.method === 'GET' && url.pathname === '/v1/live') {
    return env.ACCOUNT_EVENTS.getByName(account).fetch(new Request(request.url, {
      headers: { Upgrade: request.headers.get('Upgrade') ?? '' },
    }))
  }
  if (request.method === 'GET' && url.pathname === '/v1/events') {
    const after = Number(url.searchParams.get('after') ?? '0')
    if (!Number.isSafeInteger(after) || after < 0) return reply({ error: 'Invalid cursor' }, 400)
    const { results } = await env.RELAY_DB.withSession('first-primary').prepare(
      'SELECT seq, device, op, size FROM events WHERE account = ? AND seq > ? ORDER BY seq LIMIT 50',
    ).bind(account, after).all()
    return reply(results)
  }
  const upload = operationRoute.exec(url.pathname)
  if (request.method === 'PUT' && upload) {
    const op = upload[1]
    const db = env.RELAY_DB.withSession('first-primary')
    const existing = await db.prepare('SELECT seq FROM events WHERE account=? AND device=? AND op=?')
      .bind(account, device, op).first<number>('seq')
    if (existing !== null) return reply({ seq: existing })

    const size = Number(request.headers.get('Content-Length'))
    if (!request.body || !Number.isSafeInteger(size) || size < 41 || size > maxBytes) {
      return reply({ error: 'Invalid ciphertext length' }, 413)
    }
    const key = `${account}/${device}/${op}`
    const written = await env.CLIP_BLOBS.put(key, request.body, {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'application/octet-stream' },
    })
    const object = written ?? await env.CLIP_BLOBS.head(key)
    if (!object) return reply({ error: 'Retry the ciphertext upload' }, 503)

    await db.prepare('INSERT INTO events(account,device,op,size) VALUES(?,?,?,?) ON CONFLICT(account,device,op) DO NOTHING')
      .bind(account, device, op, object.size).run()
    const seq = await db.prepare('SELECT seq FROM events WHERE account=? AND device=? AND op=?')
      .bind(account, device, op).first<number>('seq')
    ctx.waitUntil(env.ACCOUNT_EVENTS.getByName(account).notify().catch(() => {
      console.warn(JSON.stringify({ event: 'sync_notification_failed' }))
    }))
    return reply({ seq })
  }
  const download = downloadRoute.exec(url.pathname)
  if (request.method === 'GET' && download) {
    const [, author, op] = download
    const exists = await env.RELAY_DB.withSession('first-primary').prepare(
      'SELECT size FROM events WHERE account=? AND device=? AND op=?',
    ).bind(account, author, op).first<number>('size')
    if (exists === null) return reply({ error: 'Event not found' }, 404)
    const object = await env.CLIP_BLOBS.get(`${account}/${author}/${op}`)
    if (!object) return reply({ error: 'Ciphertext unavailable' }, 503)
    return new Response(object.body, { headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(object.size),
      'Cache-Control': 'no-store',
    } })
  }
  return reply({ error: 'Route not found' }, 404)
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx)
    } catch (error) {
      console.error(JSON.stringify({ event: 'relay_request_failed', type: error instanceof Error ? error.name : 'unknown' }))
      return reply({ error: 'Relay temporarily unavailable' }, 503)
    }
  },
} satisfies ExportedHandler<Env>
