// Adapted from mcreader-v2, src/server/speech/tts.ts (startTts, stopTts, killTts, ttsUp: start it hidden
// unless it already answers, wait for /health, a polite /shutdown then by force) (Adam's rule, 2 October
// 2026: only speech code is reused).
//
// The speech server's process and its address. Started hidden (no console window) in its own process
// group, its output going to logs/server.log, and ended with everything it started. No Electron here.
import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname } from 'node:path'
import { killTree, ownGroup } from './processes'
import { readHealth, type Health } from './status'
import { SPEECH_HEADER } from './url'

/** What every request to the server carries (url.ts), and with a JSON body its type. */
const OURS: Record<string, string> = { [SPEECH_HEADER[0]]: SPEECH_HEADER[1] }
const JSON_HEADERS = { ...OURS, 'content-type': 'application/json' }

export interface ServerLaunch {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  /** Where its output goes (logs/server.log), started afresh each time. */
  logFile: string
}

/** The server AI Write started. */
export class ServerProcess {
  private child: ChildProcess | null = null
  private exitListeners: ((code: number | null) => void)[] = []

  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  get running(): boolean {
    return !!this.child && this.child.exitCode === null && this.child.signalCode === null
  }

  get pid(): number | null {
    return this.child?.pid ?? null
  }

  /** Starts it; throws only if the program can't be started at all. */
  start(launch: ServerLaunch): void {
    mkdirSync(dirname(launch.logFile), { recursive: true })
    const log = openSync(launch.logFile, 'w')
    let child: ChildProcess
    try {
      child = spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
        stdio: ['ignore', log, log],
        windowsHide: true,
        detached: ownGroup(this.platform),
        shell: false
      })
    } finally {
      closeSync(log)
    }
    this.child = child
    const done = (code: number | null): void => {
      if (this.child !== child) return
      this.child = null
      for (const l of this.exitListeners) l(code)
    }
    child.on('error', () => done(null))
    child.on('exit', (code) => done(code))
  }

  /** Called when the server AI Write started ends (by itself or stopped). */
  onExit(listener: (code: number | null) => void): void {
    this.exitListeners.push(listener)
  }

  /** Ends it and everything it started, at once. Synchronous: it also runs as AI Write quits. */
  stop(): void {
    const child = this.child
    this.child = null
    if (child) killTree(child, this.platform)
  }
}

/** The server's root address (for /shutdown): its base without /v1. */
export const rootOf = (base: string): string => base.replace(/\/v1\/?$/, '')

/** What the server says about itself, or null when nothing answers in time. */
export async function fetchHealth(base: string, timeoutMs = 1500): Promise<Health | null> {
  try {
    const res = await fetch(`${base}/health`, { headers: OURS, signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    return readHealth(await res.json())
  } catch {
    return null
  }
}

/** Asks the server to stop (it unloads its models first). True if it said yes. */
export async function askToShutDown(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${rootOf(base)}/shutdown`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{}',
      signal: AbortSignal.timeout(5000)
    })
    return res.ok
  } catch {
    return false
  }
}

/** Tells the server which dictation model to load ('none' lets both go). */
export async function pickDictation(base: string, engine: string, timeoutMs = 120_000): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${base}/dictation`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ engine }),
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (res.ok) return { ok: true, detail: '' }
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown; error?: unknown }
    return { ok: false, detail: String(body.detail ?? body.error ?? '') }
  } catch {
    return { ok: false, detail: '' }
  }
}

/** True when nothing is listening on host:port. */
export function portFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen({ host, port, exclusive: true }, () => probe.close(() => resolve(true)))
  })
}

/** The first free port from `from` to `to`, or null. */
export async function freePort(host: string, from: number, to: number): Promise<number | null> {
  for (let p = from; p <= to; p++) if (await portFree(host, p)) return p
  return null
}

/** The last few lines of a log file (for a plain-words reason a start failed). */
export function logTail(file: string, lines = 12): string {
  try {
    return readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(-lines).join('\n')
  } catch {
    return ''
  }
}

/** Where the server listens, from its address: ::1 stays ::1; everything else on this computer is 127.0.0.1. */
export function listenOn(address: string): { host: string; port: number } {
  const u = new URL(address)
  const host = u.hostname.replace(/^\[|\]$/g, '') === '::1' ? '::1' : '127.0.0.1'
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80)
  return { host, port }
}
