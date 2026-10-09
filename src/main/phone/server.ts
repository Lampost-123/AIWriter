// The page the phone opens, and the calls it makes. One small server on the local network, started only
// while Settings allows the phone. It is not the speech engine: that still listens on this computer alone.
// The phone's browser cannot do bytes or the portrait scheme, so values go through shared/phoneWire.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect as netConnect } from 'node:net'
import { extname, join, normalize, sep } from 'node:path'
import type { PhoneHello } from '@shared/contracts/phone'
import { normalizePhoneCode } from '@shared/contracts/phone'
import { decodeWire, encodeWire } from '@shared/phoneWire'
import type { IpcResult } from '@shared/api'

const COOKIE = 'aiwrite_phone'
const JOIN = '/__phone/join'
const PAIR = '/__phone/pair'
const HELLO = '/__phone/hello'
const CALL = '/__phone/call'
const EVENTS = '/__phone/events'
const IMAGE = '/__phone/image/entry/'
const BODY_LIMIT = 20_000_000
const FAIL_LIMIT = 8
const FAIL_WAIT_MS = 60_000

export interface PhoneHost {
  /** The name of this computer, shown on the phone's code page. */
  computerName(): string
  checkCode(code: string): boolean
  call(method: string, args: unknown[]): Promise<IpcResult<unknown>>
  /** Live updates, the same ones the desktop window gets. Returns an unsubscribe. */
  subscribe(send: (event: string, payload: unknown) => void): () => void
  hello(): PhoneHello
  image(id: string): { type: string; bytes: Uint8Array } | null
  /** The dev window's address, or the built pages' folder. One of the two. */
  ui(): { proxy: string | null; root: string | null }
}

export interface PhoneServer {
  port: number
  close(): Promise<void>
}

interface FailState {
  fails: number
  until: number
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.map': 'application/json',
  '.ico': 'image/x-icon'
}

function cookieValue(req: IncomingMessage): string {
  const raw = req.headers.cookie ?? ''
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === COOKIE) return decodeURIComponent(rest.join('='))
  }
  return ''
}

function send(res: ServerResponse, status: number, body: string, type: string, extra?: Record<string, string>): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra })
  res.end(body)
}

function json(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), 'application/json; charset=utf-8')
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)
}

function joinPage(computer: string, message: string): string {
  const note = message ? `<p class="err">${esc(message)}</p>` : ''
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>AI Write</title>
  <style>
    html, body { margin: 0; min-height: 100%; background: #12110f; color: #f4efe6; font-family: "Segoe UI", sans-serif; }
    body { display: grid; place-items: center; padding: 24px 16px env(safe-area-inset-bottom); }
    form { width: min(360px, 100%); }
    h1 { font-size: 22px; font-weight: 600; margin: 0 0 8px; }
    p { margin: 0 0 16px; line-height: 1.45; color: #c9c0b4; font-size: 15px; }
    .err { color: #f0a8a0; }
    input { width: 100%; box-sizing: border-box; font-size: 28px; letter-spacing: 0.3em; text-align: center; padding: 12px; border-radius: 12px; border: 1px solid #3a342c; background: #1c1a17; color: inherit; }
    button { margin-top: 16px; width: 100%; height: 48px; border: 0; border-radius: 12px; background: #e7e1d6; color: #1c1a17; font-size: 16px; font-weight: 600; }
  </style>
</head>
<body>
  <form method="POST" action="${PAIR}">
    <h1>AI Write</h1>
    <p>Type the code shown on ${esc(computer)}, in Settings, About and updates, under On your phone.</p>
    ${note}
    <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" autofocus required aria-label="Code">
    <button type="submit">Connect</button>
  </form>
</body>
</html>`
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function headerText(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(', ') : (value ?? '')
}

/** Starts listening. Rejects when the port is taken or cannot be used. */
export function startPhoneServer(port: number, host: PhoneHost, bind = '0.0.0.0'): Promise<PhoneServer> {
  const fails = new Map<string, FailState>()
  const clients = new Set<ServerResponse>()
  const offEvents = host.subscribe((event, payload) => {
    const line = `data: ${JSON.stringify({ event, payload: encodeWire(payload) })}\n\n`
    for (const client of clients) {
      try {
        client.write(line)
      } catch {
        clients.delete(client)
      }
    }
  })
  const beat = setInterval(() => {
    for (const client of clients) {
      try {
        client.write(': ping\n\n')
      } catch {
        clients.delete(client)
      }
    }
  }, 15_000)
  beat.unref?.()

  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, 'Something went wrong on this computer. Try again.', 'text/plain; charset=utf-8')
    })
  })
  server.requestTimeout = 0
  server.headersTimeout = 60_000

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://phone.local')
    const path = url.pathname
    if (req.method === 'GET' && path === JOIN) {
      const why = url.searchParams.get('e') === 'wait' ? 'Too many tries. Wait a minute, then type the code again.' : url.searchParams.get('e') === 'code' ? 'That code isn’t the one on your computer.' : ''
      send(res, 200, joinPage(host.computerName(), why), 'text/html; charset=utf-8')
      return
    }
    if (req.method === 'POST' && path === PAIR) {
      await pair(req, res)
      return
    }
    if (!host.checkCode(normalizePhoneCode(cookieValue(req)))) {
      if (req.method === 'GET' && (path === '/' || path === '/phone.html')) {
        res.writeHead(302, { location: JOIN })
        res.end()
        return
      }
      send(res, 401, 'This phone has not connected. Open the page and type the code.', 'text/plain; charset=utf-8')
      return
    }
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      res.writeHead(302, { location: '/phone.html' })
      res.end()
      return
    }
    if (req.method === 'GET' && path === HELLO) {
      json(res, 200, host.hello())
      return
    }
    if (req.method === 'POST' && path === CALL) {
      await call(req, res)
      return
    }
    if (req.method === 'GET' && path === EVENTS) {
      events(req, res)
      return
    }
    if (req.method === 'GET' && path.startsWith(IMAGE)) {
      portrait(path.slice(IMAGE.length), res)
      return
    }
    await files(req, res, url)
  }

  async function pair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = req.socket.remoteAddress ?? ''
    const state = fails.get(ip)
    if (state && state.until > Date.now()) {
      send(res, 429, joinPage(host.computerName(), 'Too many tries. Wait a minute, then type the code again.'), 'text/html; charset=utf-8')
      return
    }
    let raw = ''
    try {
      const body = await readBody(req)
      const type = headerText(req.headers['content-type'])
      raw = type.includes('application/json') ? String((JSON.parse(body) as { code?: unknown }).code ?? '') : new URLSearchParams(body).get('code') ?? ''
    } catch {
      raw = ''
    }
    const code = normalizePhoneCode(raw)
    if (!code || !host.checkCode(code)) {
      const next = (state?.fails ?? 0) + 1
      fails.set(ip, next >= FAIL_LIMIT ? { fails: 0, until: Date.now() + FAIL_WAIT_MS } : { fails: next, until: 0 })
      send(res, 401, joinPage(host.computerName(), 'That code isn’t the one on your computer.'), 'text/html; charset=utf-8')
      return
    }
    fails.delete(ip)
    res.writeHead(303, {
      location: '/',
      'set-cookie': `${COOKIE}=${encodeURIComponent(code)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`
    })
    res.end()
  }

  async function call(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let method = ''
    let args: unknown[] = []
    try {
      const body = decodeWire(JSON.parse(await readBody(req))) as { method?: unknown; args?: unknown }
      if (typeof body?.method !== 'string' || body.method.length > 80 || !Array.isArray(body.args)) throw new Error('bad')
      method = body.method
      args = body.args
    } catch {
      json(res, 400, { ok: false, error: { message: 'That request could not be read. Try again.' } })
      return
    }
    try {
      const result = await host.call(method, args)
      json(res, 200, encodeWire(result))
    } catch {
      json(res, 200, { ok: false, error: { message: 'Something went wrong on this computer. Try again.' } })
    }
  }

  function events(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive'
    })
    res.write(': ok\n\n')
    clients.add(res)
    const drop = (): void => {
      clients.delete(res)
    }
    req.on('close', drop)
    res.on('error', drop)
  }

  function portrait(id: string, res: ServerResponse): void {
    let name = ''
    try {
      name = decodeURIComponent(id)
    } catch {
      name = ''
    }
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
      send(res, 404, '', 'text/plain')
      return
    }
    const image = host.image(name)
    if (!image) {
      send(res, 404, '', 'text/plain')
      return
    }
    res.writeHead(200, { 'content-type': image.type, 'cache-control': 'private, max-age=31536000, immutable' })
    res.end(Buffer.from(image.bytes))
  }

  async function files(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const ui = host.ui()
    if (ui.proxy) {
      proxy(req, res, ui.proxy, url)
      return
    }
    if (!ui.root) {
      send(res, 503, 'AI Write is still starting. Try again in a moment.', 'text/plain; charset=utf-8')
      return
    }
    const root = normalize(ui.root)
    const rel = decodeURIComponent(url.pathname).replace(/^[/\\]+/, '')
    const file = normalize(join(root, rel))
    if (file !== root && !file.startsWith(root + sep)) {
      send(res, 404, '', 'text/plain')
      return
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      send(res, 404, '', 'text/plain')
      return
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
    createReadStream(file).pipe(res)
  }

  function proxy(req: IncomingMessage, res: ServerResponse, origin: string, url: URL): void {
    const target = new URL(origin)
    const headers = { ...req.headers, host: target.host }
    const upstream = httpRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${url.pathname}${url.search}`,
        method: req.method,
        headers
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers)
        up.pipe(res)
      }
    )
    upstream.on('error', () => {
      if (!res.headersSent) send(res, 502, 'AI Write’s window is still starting. Try again in a moment.', 'text/plain; charset=utf-8')
    })
    req.pipe(upstream)
  }

  server.on('upgrade', (req, socket, head) => {
    const ui = host.ui()
    if (!ui.proxy || !host.checkCode(normalizePhoneCode(cookieValue(req)))) {
      socket.destroy()
      return
    }
    const target = new URL(ui.proxy)
    const remote = netConnect(Number(target.port) || 80, target.hostname, () => {
      const lines = Object.entries(req.headers)
        .filter(([name]) => name.toLowerCase() !== 'host')
        .map(([name, value]) => `${name}: ${headerText(value)}`)
      remote.write(`GET ${req.url ?? '/'} HTTP/1.1\r\nHost: ${target.host}\r\n${lines.join('\r\n')}\r\n\r\n`)
      if (head.length) remote.write(head)
      remote.pipe(socket)
      socket.pipe(remote)
    })
    remote.on('error', () => socket.destroy())
    socket.on('error', () => remote.destroy())
  })

  return new Promise((resolve, reject) => {
    const fail = (err: Error): void => {
      clearInterval(beat)
      offEvents()
      reject(err)
    }
    server.once('error', fail)
    server.listen(port, bind, () => {
      server.off('error', fail)
      const address = server.address()
      const got = address && typeof address === 'object' ? address.port : port
      resolve({
        port: got,
        close: () => closeServer(server, clients, beat, offEvents)
      })
    })
  })
}

function closeServer(server: Server, clients: Set<ServerResponse>, beat: ReturnType<typeof setInterval>, offEvents: () => void): Promise<void> {
  clearInterval(beat)
  offEvents()
  for (const client of clients) {
    try {
      client.end()
    } catch {
      /* already gone */
    }
  }
  clients.clear()
  server.closeAllConnections?.()
  return new Promise((resolve) => server.close(() => resolve()))
}
