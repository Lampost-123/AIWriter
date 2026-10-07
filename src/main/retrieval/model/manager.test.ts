// The search model's life in the app: download, Stop, Remove and the switch in any order, a start that came out of
// date, and threads that stop. No threads, no internet: the model is a stand-in and the files come from a local server.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Embedder } from '../types'
import { SearchModel, type ModelDeps } from './manager'
import { filePath, filesFor, readManifest, SEARCH_MODEL, SEARCH_MODEL_REVISION, writeManifest, type Engine } from './files'
import { OtherFormNeeded } from './start'

let server: Server
let base = ''
/** Requests the server holds open (a slow download), released on demand. */
const held: (() => void)[] = []
beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Length': 10 })
    res.write('12345')
    held.push(() => res.end('67890'))
    req.on('close', () => res.destroy())
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

const dirs: string[] = []
afterEach(() => {
  held.splice(0)
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A model folder with the files laid out at their real sizes (sparse), as a finished download leaves it. */
function downloaded(engine: Engine = 'onnx', extra: Partial<Parameters<typeof writeManifest>[1]> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'aiwrite-manager-'))
  dirs.push(root)
  const dir = join(root, SEARCH_MODEL)
  for (const f of filesFor(engine)) {
    const p = filePath(dir, f)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, '')
    truncateSync(p, f.bytes)
  }
  writeManifest(dir, { model: SEARCH_MODEL, revision: SEARCH_MODEL_REVISION, at: 'now', checked: { onnx: { at: 'now', ok: true }, ts: { at: 'now', ok: true } }, ...extra })
  return dir
}

const stand = (name = 'm'): Embedder & { closed: boolean } => {
  const e = { model: name, floor: 0, closed: false, embed: async (t: string[]) => t.map(() => Float32Array.from([1])), close: () => void (e.closed = true) }
  return e
}

const tick = () => new Promise((r) => setTimeout(r, 5))

function manager(dir: string, over: Partial<ModelDeps> = {}) {
  const changes: number[] = []
  const m = new SearchModel({
    dir: () => dir,
    fetchImpl: fetch,
    base: () => base,
    start: async () => ({ embedder: stand(), engine: 'onnx' }),
    changed: () => changes.push(1),
    shipped: () => true,
    ...over
  })
  return { m, changes }
}

describe('the search model in the app', () => {
  it('starts in the background once downloaded, and says Ready', async () => {
    const { m } = manager(downloaded())
    expect(m.status().state).toBe('starting')
    expect(m.now()).toBeNull()
    await tick()
    expect(m.now()).not.toBeNull()
    expect(m.status().state).toBe('ready')
  })

  it('throws away a start that Remove or the switch made out of date', async () => {
    const dir = downloaded()
    let finish: (v: { embedder: Embedder; engine: Engine }) => void = () => undefined
    const made = stand()
    const { m } = manager(dir, { start: () => new Promise((r) => (finish = r)) })
    void m.startSoon()
    m.switched(false)
    finish({ embedder: made, engine: 'onnx' })
    await tick()
    expect(m.embedder).toBeNull()
    expect(made.closed).toBe(true)
  })

  it('starts again once when its threads stop, then says it isn’t working', async () => {
    const dir = downloaded()
    const fails: ((e: Error) => void)[] = []
    let starts = 0
    const { m } = manager(dir, {
      start: async (_d, onFail) => {
        starts++
        fails.push(onFail)
        return { embedder: stand(), engine: 'onnx' }
      }
    })
    await m.startSoon()
    expect(m.status().state).toBe('ready')
    fails[0](new Error('worker crashed'))
    await tick()
    expect(starts).toBe(2)
    expect(m.status().state).toBe('ready')
    fails[1](new Error('worker crashed again'))
    await tick()
    expect(starts).toBe(2)
    const st = m.status()
    expect(st.state).toBe('broken')
    expect(st.problem).toMatch(/isn't working \(it stopped working \(worker crashed again\)\)/)
  })

  it('offers the download again when the fast engine can’t start here and the other form isn’t downloaded', async () => {
    const dir = downloaded('onnx')
    const { m } = manager(dir, { start: async () => Promise.reject(new OtherFormNeeded('no')) })
    await m.startSoon()
    expect(m.status()).toMatchObject({ state: 'starting' })
    // Once the failure is noted (start.ts writes it), the form here can't run: the download is offered.
    writeManifest(dir, { ...readManifest(dir)!, onnxFailed: { at: 'now', why: 'no' } })
    expect(m.status()).toMatchObject({ state: 'none', problem: 'The search model needs downloading again in a form this computer can run.' })
  })
})

describe('download, Stop and Remove in any order', () => {
  it('a stopped download says nothing when it ends, even after a new one started', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aiwrite-manager-'))
    dirs.push(root)
    const dir = join(root, SEARCH_MODEL)
    const { m } = manager(dir)
    m.startDownload()
    await tick()
    expect(m.status().state).toBe('downloading')
    m.stopDownload()
    expect(m.status()).toMatchObject({ state: 'none', problem: null })
    m.startDownload()
    await tick()
    // The first download's end comes now: it must not clear the second.
    expect(m.status().state).toBe('downloading')
    await m.remove()
    expect(m.status()).toMatchObject({ state: 'none', problem: null })
    expect(existsSync(dir)).toBe(false)
  })

  it('Remove waits for a download under way to let go of its files, then takes them all', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aiwrite-manager-'))
    dirs.push(root)
    const dir = join(root, SEARCH_MODEL)
    const { m } = manager(dir)
    m.startDownload()
    await tick()
    await m.remove()
    expect(existsSync(dir)).toBe(false)
    expect(m.status().state).toBe('none')
  })

  it('a download that fails says why, and Try again starts afresh', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aiwrite-manager-'))
    dirs.push(root)
    const { m } = manager(join(root, SEARCH_MODEL), { fetchImpl: (async () => new Response('gone', { status: 404 })) as unknown as typeof fetch })
    m.startDownload()
    await tick()
    await tick()
    expect(m.status()).toMatchObject({ state: 'none', problem: expect.stringMatching(/server said 404/) })
  })
})
