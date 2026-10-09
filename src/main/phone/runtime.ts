// Starts and stops the phone's page. The page is another window: every call it makes is one the desktop
// window can make, and it runs here. Turning it on waits a moment so a call that asked for the change can
// answer before the page closes.
import { timingSafeEqual } from 'node:crypto'
import { app, nativeTheme } from 'electron'
import { hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { IpcResult } from '@shared/api'
import { normalizePhoneCode, type PhoneHello, type PhoneLink } from '@shared/contracts/phone'
import { accentIdOf, lookOf } from '@shared/contracts/look'
import * as repo from '../db/repo'
import { onPhoneEvent } from '../events'
import { deskReady, getSettings } from '../settings'
import { maybeCurrentWorld } from '../world'
import { freshPhoneCode, readPhone, writePhone } from './config'
import { startPhoneServer, type PhoneServer } from './server'
import { lanIpv4, phoneLinkOf } from './status'

type Call = (method: string, args: unknown[]) => Promise<IpcResult<unknown>>

let call: Call = async () => ({ ok: false, error: { message: 'AI Write is still starting. Try again in a moment.' } })

/** The desktop's calls, so the phone can make the same ones. Set once the calls are registered. */
export function bindPhoneCall(fn: Call): void {
  call = fn
}

let server: PhoneServer | null = null
let problem = ''
/** Quit has closed the page; a start that was already under way must not open it again. */
let closed = false
let running = false
let again = false
let timer: ReturnType<typeof setTimeout> | null = null

function codesMatch(given: string, real: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(real)
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

function accepts(code: string): boolean {
  const cfg = readPhone()
  if (!cfg.on || !cfg.code) return false
  const typed = normalizePhoneCode(code)
  return typed !== '' && codesMatch(typed, cfg.code)
}

function hello(): PhoneHello {
  const settings = getSettings()
  const theme =
    settings.theme === 'light' || settings.theme === 'dark' || settings.theme === 'sepia'
      ? settings.theme
      : nativeTheme.shouldUseDarkColors
        ? 'dark'
        : 'light'
  return { theme, accent: accentIdOf(settings.accent), look: lookOf(settings.look), deskReady: deskReady() }
}

export function currentPhoneLink(): PhoneLink {
  const cfg = readPhone()
  return phoneLinkOf({
    on: cfg.on,
    listening: server !== null,
    port: server?.port ?? cfg.port,
    code: cfg.code,
    ips: lanIpv4(networkInterfaces()),
    bindError: problem
  })
}

function schedule(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    void kick()
  }, 40)
  timer.unref?.()
}

/** Runs the latest asked-for start or stop, and runs once more if it changed while that was happening. */
async function kick(): Promise<void> {
  if (running) {
    again = true
    return
  }
  running = true
  try {
    do {
      again = false
      await applyNow()
    } while (again)
  } finally {
    running = false
    if (again) void kick()
  }
}

/** Starts the page when it was left on. */
export function initPhone(): void {
  if (readPhone().on) void kick()
}

/** Closes the page. Safe to call when it is already closed. */
export async function stopPhone(): Promise<void> {
  closed = true
  again = false
  if (timer) clearTimeout(timer)
  timer = null
  const open = server
  server = null
  await open?.close()
}

async function applyNow(): Promise<void> {
  if (closed) return
  const cfg = readPhone()
  if (!cfg.on) {
    problem = ''
    const open = server
    server = null
    await open?.close()
    return
  }
  if (server) return
  if (!cfg.code) writePhone({ code: freshPhoneCode() })
  const want = readPhone()
  let last: unknown
  for (let port = want.port; port < want.port + 6; port++) {
    try {
      server = await startPhoneServer(port, {
        computerName: () => hostname(),
        checkCode: accepts,
        call: (method, args) => call(method, args),
        subscribe: (send) => onPhoneEvent(send),
        hello,
        image: (id) => {
          const world = maybeCurrentWorld()
          if (!world) return null
          const image = repo.getEntryImage(world.db, id)
          return image ? { type: image.type, bytes: new Uint8Array(image.bytes) } : null
        },
        ui: () =>
          !app.isPackaged && process.env.ELECTRON_RENDERER_URL
            ? { proxy: process.env.ELECTRON_RENDERER_URL, root: null }
            : { proxy: null, root: join(__dirname, '../renderer') }
      })
      problem = ''
      if (closed) {
        const open = server
        server = null
        await open?.close()
        return
      }
      if (server.port !== want.port) writePhone({ port: server.port })
      return
    } catch (err) {
      last = err
      server = null
    }
  }
  const code = (last as NodeJS.ErrnoException | undefined)?.code
  problem =
    code === 'EACCES'
      ? 'Windows did not allow AI Write to listen for your phone. Allow it on private networks, then turn this off and on again.'
      : 'Something else is using the phone port. Turn this off and on again.'
}

export async function setPhoneLink(on: boolean): Promise<PhoneLink> {
  const cfg = readPhone()
  writePhone({ on, code: on && !cfg.code ? freshPhoneCode() : cfg.code || freshPhoneCode() })
  schedule()
  return currentPhoneLink()
}

export async function newPhoneCode(): Promise<PhoneLink> {
  writePhone({ code: freshPhoneCode() })
  return currentPhoneLink()
}
