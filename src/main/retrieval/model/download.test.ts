// The search model's download, against a local server with made-up files (nothing is fetched from the internet).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { downloadModel, DownloadStopped, removeModel } from './download'
import { engineToDownload, filePath, filesFor, fileUrl, installed, readManifest, SEARCH_MODEL, SEARCH_MODEL_FILES, SEARCH_MODEL_REVISION, writeManifest, type ModelFile } from './files'

const small = Buffer.from('{"hidden_size": 8}')
const big = Buffer.alloc(300_000, 7)
const FILES: ModelFile[] = [
  { name: 'config.json', bytes: small.length, gitSha1: createHash('sha1').update(`blob ${small.length}\u0000`).update(small).digest('hex') },
  { name: 'onnx/model.onnx', bytes: big.length, sha256: createHash('sha256').update(big).digest('hex') }
]

let server: Server
let base = ''
const hits: string[] = []
let damaged = false
let slow = false
beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '')
    const body = req.url?.endsWith('config.json') ? small : req.url?.endsWith('model.onnx') ? big : null
    if (!body) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'Content-Length': body.length })
    if (damaged) {
      res.end(Buffer.alloc(body.length, 1))
      return
    }
    if (!slow) {
      res.end(body)
      return
    }
    // In pieces, so a stop can come part way.
    let at = 0
    const tick = (): void => {
      if (at >= body.length) return void res.end()
      res.write(body.subarray(at, at + 10_000))
      at += 10_000
      setTimeout(tick, 5)
    }
    tick()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

const dirs: string[] = []
const dir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'aiwrite-model-'))
  dirs.push(d)
  return join(d, 'search-model', SEARCH_MODEL)
}
afterEach(() => {
  damaged = false
  slow = false
  hits.length = 0
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('downloading the search model', () => {
  it('takes the files from Hugging Face at a fixed revision, about 133 MB in all', () => {
    expect(fileUrl(SEARCH_MODEL_FILES[2])).toBe(`https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/${SEARCH_MODEL_REVISION}/onnx/model.onnx`)
    expect(fileUrl(filesFor('ts')[2])).toBe(`https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/${SEARCH_MODEL_REVISION}/model.safetensors`)
    expect(Math.round(SEARCH_MODEL_FILES.reduce((n, f) => n + f.bytes, 0) / 1e6)).toBe(133)
  })

  it('downloads, checks and records each file, telling how far it has got', async () => {
    const d = dir()
    const seen: number[] = []
    await downloadModel(d, { fetchImpl: fetch, signal: new AbortController().signal, base, files: FILES, onProgress: (p) => seen.push(p.done / p.total) })
    expect(readFileSync(join(d, 'onnx', 'model.onnx')).equals(big)).toBe(true)
    expect(readManifest(d)).toMatchObject({ model: SEARCH_MODEL, revision: SEARCH_MODEL_REVISION })
    expect(seen.at(-1)).toBe(1)
    expect(readdirSync(join(d, 'onnx')).some((n) => n.endsWith('.part'))).toBe(false)
    // Asked again, nothing is fetched.
    hits.length = 0
    await downloadModel(d, { fetchImpl: fetch, signal: new AbortController().signal, base, files: FILES })
    expect(hits).toEqual([])
  })

  it('keeps a file already there and right, and fetches only the rest', async () => {
    const d = dir()
    await downloadModel(d, { fetchImpl: fetch, signal: new AbortController().signal, base, files: FILES })
    rmSync(join(d, 'installed.json'))
    rmSync(join(d, 'config.json'))
    hits.length = 0
    await downloadModel(d, { fetchImpl: fetch, signal: new AbortController().signal, base, files: FILES })
    expect(hits.map((h) => h.split('/').pop())).toEqual(['config.json'])
  })

  it('never keeps a damaged download', async () => {
    const d = dir()
    damaged = true
    await expect(downloadModel(d, { fetchImpl: fetch, signal: new AbortController().signal, base, files: FILES })).rejects.toThrow(/damaged/)
    expect(readManifest(d)).toBeNull()
    expect(readdirSync(d)).toEqual([])
  })

  it('stops part way and leaves nothing half-downloaded', async () => {
    const d = dir()
    slow = true
    const stop = new AbortController()
    const p = downloadModel(d, {
      fetchImpl: fetch,
      signal: stop.signal,
      base,
      files: FILES,
      onProgress: (x) => {
        if (x.done > small.length + 50_000) stop.abort()
      }
    })
    await expect(p).rejects.toBeInstanceOf(DownloadStopped)
    expect(existsSync(join(d, 'onnx', 'model.onnx'))).toBe(false)
    expect(readdirSync(join(d, 'onnx')).some((n) => n.endsWith('.part'))).toBe(false)
    expect(readManifest(d)).toBeNull()
  })

  it('keeps what installed.json said before (the fast engine couldn’t start), and Remove takes it all away', async () => {
    const d = dir()
    mkdirSync(d, { recursive: true })
    writeManifest(d, { model: SEARCH_MODEL, revision: SEARCH_MODEL_REVISION, at: 'x', onnxFailed: { at: 'x', why: 'no' } })
    await downloadModel(d, { fetchImpl: fetch, signal: new AbortController().signal, base, files: FILES })
    expect(readManifest(d)?.onnxFailed).toEqual({ at: 'x', why: 'no' })
    removeModel(d)
    expect(existsSync(d)).toBe(false)
  })
})

describe('which form of the model is here', () => {
  /** The real files' sizes, without their contents (sparse files). */
  const lay = (d: string, engine: 'onnx' | 'ts'): void => {
    for (const f of filesFor(engine)) {
      const p = filePath(d, f)
      mkdirSync(join(p, '..'), { recursive: true })
      writeFileSync(p, '')
      truncateSync(p, f.bytes)
    }
  }

  it('reads each engine as downloaded only when its files are all there at their sizes', () => {
    const d = dir()
    lay(d, 'onnx')
    expect(installed(d)).toBeNull()
    writeManifest(d, { model: SEARCH_MODEL, revision: SEARCH_MODEL_REVISION, at: 'now' })
    expect(installed(d)?.engines).toEqual(['onnx'])
    lay(d, 'ts')
    expect(installed(d)?.engines).toEqual(['onnx', 'ts'])
    // A file cut short (emptied by hand, or another revision) isn't the model.
    writeFileSync(filePath(d, filesFor('onnx')[2]), 'cut short')
    expect(installed(d)?.engines).toEqual(['ts'])
    writeManifest(d, { model: SEARCH_MODEL, revision: 'older', at: 'now' })
    expect(installed(d)).toBeNull()
  })

  it('downloads the fast engine’s form unless that engine isn’t here or couldn’t start', () => {
    const d = dir()
    expect(engineToDownload(d, true)).toBe('onnx')
    expect(engineToDownload(d, false)).toBe('ts')
    mkdirSync(d, { recursive: true })
    writeManifest(d, { model: SEARCH_MODEL, revision: SEARCH_MODEL_REVISION, at: 'now', onnxFailed: { at: 'now', why: 'no' } })
    expect(engineToDownload(d, true)).toBe('ts')
  })
})
