// The phone opens this page. It is the same app as the window; the calls go to the computer over the local network.
import type { AppEventName, AppEvents, Bridge, IpcResult } from '@shared/api'
import type { PhoneHello } from '@shared/contracts/phone'
import { decodeWire, encodeWire } from '@shared/phoneWire'

const listeners = new Map<string, Set<(payload: unknown) => void>>()

function events(): void {
  const source = new EventSource('/__phone/events')
  source.onmessage = (message) => {
    const body = JSON.parse(message.data) as { event: string; payload: unknown }
    const payload = decodeWire(body.payload)
    for (const listener of listeners.get(body.event) ?? []) listener(payload)
  }
  source.onerror = () => {
    void fetch('/__phone/hello').then((res) => {
      if (res.status === 401) location.replace('/__phone/join')
    })
  }
}

async function invoke(method: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  // Showing the computer's window is the computer's own business. The phone is already showing.
  if (method === 'showWindow') return { ok: true, value: undefined }
  const res = await fetch('/__phone/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args: encodeWire(args) })
  })
  if (res.status === 401) {
    location.replace('/__phone/join')
    return new Promise(() => undefined)
  }
  return decodeWire(await res.json()) as IpcResult<unknown>
}

function bridge(hello: PhoneHello): Bridge {
  return {
    invoke: (method, ...args) => invoke(method, ...args),
    on: <E extends AppEventName>(event: E, listener: (payload: AppEvents[E]) => void) => {
      const set = listeners.get(event) ?? new Set<(payload: unknown) => void>()
      const wrapped = listener as (payload: unknown) => void
      set.add(wrapped)
      listeners.set(event, set)
      return () => set.delete(wrapped)
    },
    platform: 'phone',
    initialTheme: hello.theme,
    initialAccent: hello.accent,
    initialLook: hello.look,
    deskReady: hello.deskReady,
    pathForFile: () => ''
  }
}

/** Puts the computer's bridge in place before the app starts. Leaves the page when the code is missing. */
export async function installPhoneBridge(): Promise<void> {
  const res = await fetch('/__phone/hello')
  if (res.status === 401) {
    location.replace('/__phone/join')
    return new Promise(() => undefined)
  }
  if (!res.ok) throw new Error('Can’t reach the computer. Check that it and the phone are on the same Wi-Fi, and that AI Write is open.')
  const hello = (await res.json()) as PhoneHello
  document.documentElement.dataset.theme = hello.theme
  document.documentElement.dataset.look = hello.look
  document.documentElement.dataset.phone = '1'
  if (hello.accent) document.documentElement.dataset.accent = hello.accent
  window.aiwrite = bridge(hello)
  events()
}
