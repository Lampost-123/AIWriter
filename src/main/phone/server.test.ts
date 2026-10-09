import { afterEach, describe, expect, it } from 'vitest'
import type { PhoneHost } from './server'
import { startPhoneServer } from './server'
import { encodeWire } from '@shared/phoneWire'

const CODE = '482193'

function harness(): PhoneHost & { sent: { event: string; payload: unknown }[]; push(event: string, payload: unknown): void; calls: { method: string; args: unknown[] }[] } {
  let send: ((event: string, payload: unknown) => void) | null = null
  const calls: { method: string; args: unknown[] }[] = []
  return {
    calls,
    sent: [],
    computerName: () => 'Study-PC',
    checkCode: (code) => code === CODE,
    call: async (method, args) => {
      calls.push({ method, args })
      if (method === 'speak') return { ok: true, value: new Uint8Array([9, 8, 7]) }
      return { ok: true, value: args[0] }
    },
    subscribe: (fn) => {
      send = fn
      return () => {
        send = null
      }
    },
    push: (event, payload) => send?.(event, payload),
    hello: () => ({ theme: 'dark', accent: null, look: 'new', deskReady: true }),
    image: (id) => (id === 'mara' ? { type: 'image/png', bytes: new Uint8Array([1, 2, 3]) } : null),
    ui: () => ({ proxy: null, root: null })
  }
}

describe('phone server', () => {
  let close: (() => Promise<void>) | null = null
  afterEach(async () => {
    await close?.()
    close = null
  })

  async function start(): Promise<{ base: string; host: ReturnType<typeof harness> }> {
    const host = harness()
    const server = await startPhoneServer(0, host, '127.0.0.1')
    close = () => server.close()
    return { base: `http://127.0.0.1:${server.port}`, host }
  }

  it('asks for the code, then lets the phone call the computer', async () => {
    const { base, host } = await start()
    const join = await fetch(`${base}/`)
    expect(join.status).toBe(200)
    expect(await join.text()).toContain('Study-PC')

    const wrong = await fetch(`${base}/__phone/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'code=000000'
    })
    expect(wrong.status).toBe(401)
    expect(await wrong.text()).toContain('isn’t the one')

    const paired = await fetch(`${base}/__phone/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'code=482+193',
      redirect: 'manual'
    })
    expect(paired.status).toBe(303)
    const cookie = paired.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('aiwrite_phone=482193')

    const denied = await fetch(`${base}/__phone/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    })
    expect(denied.status).toBe(401)

    const call = await fetch(`${base}/__phone/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'aiwrite_phone=482193' },
      body: JSON.stringify({ method: 'speak', args: encodeWire([undefined]) })
    })
    expect(call.status).toBe(200)
    const body = (await call.json()) as { ok: boolean; value: { $aiw: string } }
    expect(body.ok).toBe(true)
    expect(body.value.$aiw).toBeTruthy()
    expect(host.calls[0]?.args).toEqual([undefined])

    const events = await fetch(`${base}/__phone/events`, { headers: { cookie: 'aiwrite_phone=482193' } })
    host.push('memory:status', { busy: false })
    const reader = events.body!.getReader()
    const dec = new TextDecoder()
    let text = ''
    const timer = setTimeout(() => void reader.cancel(), 2000)
    while (!text.includes('memory:status')) {
      const chunk = await reader.read()
      if (chunk.done) break
      text += dec.decode(chunk.value)
    }
    clearTimeout(timer)
    expect(text).toContain('memory:status')

    const picture = await fetch(`${base}/__phone/image/entry/mara`, { headers: { cookie: 'aiwrite_phone=482193' } })
    expect(picture.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await picture.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })
})
