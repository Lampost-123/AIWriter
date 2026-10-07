// Downloading the search model, once (Settings › Models, "Find by meaning"): each file streamed into a part file beside
// where it goes, checked by size and hash, then put in place; installed.json is written last. Stop ends it at once and
// leaves no part file behind. A file already there and right is kept. The fetch is passed in (Electron's, so the
// computer's proxy settings count), so this is tested against a local server. No Electron imports.

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { filePath, fileUrl, readManifest, SEARCH_MODEL, SEARCH_MODEL_FILES, SEARCH_MODEL_REVISION, writeManifest, type ModelFile } from './files'

export interface DownloadProgress {
  /** Bytes in place or downloaded so far, of `total`. */
  done: number
  total: number
}

/** A hash that checks a file as Hugging Face lists it: sha256 for large files, git's blob sha1 for small ones. */
function hasherFor(f: ModelFile): { update(b: Uint8Array): void; matches(): boolean } {
  if (f.sha256) {
    const h = createHash('sha256')
    return { update: (b) => h.update(b), matches: () => h.digest('hex') === f.sha256 }
  }
  const h = createHash('sha1').update(`blob ${f.bytes}\u0000`)
  return { update: (b) => h.update(b), matches: () => !f.gitSha1 || h.digest('hex') === f.gitSha1 }
}

/** True when the file is there, the right size, with the right hash. */
async function fileIsRight(path: string, f: ModelFile): Promise<boolean> {
  try {
    if (statSync(path).size !== f.bytes) return false
  } catch {
    return false
  }
  const h = hasherFor(f)
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer)
  return h.matches()
}

export class DownloadStopped extends Error {
  constructor() {
    super('The download was stopped.')
  }
}

/**
 * Downloads every file in `files` (the fast engine's, unless told) into `dir`. Resolves when it is all there and checked.
 * What installed.json already says (the fast engine couldn't start, say) is kept.
 */
export async function downloadModel(
  dir: string,
  o: { fetchImpl: typeof fetch; signal: AbortSignal; onProgress?: (p: DownloadProgress) => void; base?: string; files?: ModelFile[] }
): Promise<void> {
  const files = o.files ?? SEARCH_MODEL_FILES
  mkdirSync(dir, { recursive: true })
  let done = 0
  const total = files.reduce((n, f) => n + f.bytes, 0)
  const tell = (): void => o.onProgress?.({ done, total })
  for (const f of files) {
    const path = filePath(dir, f)
    if (await fileIsRight(path, f)) {
      done += f.bytes
      tell()
      continue
    }
    if (o.signal.aborted) throw new DownloadStopped()
    mkdirSync(dirname(path), { recursive: true })
    const part = `${path}.part`
    let res: Response
    try {
      res = await o.fetchImpl(fileUrl(f, o.base), { signal: o.signal })
    } catch (e) {
      if (o.signal.aborted) throw new DownloadStopped()
      throw new Error(`The search model couldn't be downloaded (${e instanceof Error ? e.message : String(e)}). Check the internet connection, then try again.`)
    }
    if (!res.ok || !res.body) throw new Error(`The search model couldn't be downloaded (the server said ${res.status}). Try again later.`)
    const fh = await open(part, 'w')
    const h = hasherFor(f)
    let got = 0
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        if (o.signal.aborted) throw new DownloadStopped()
        got += chunk.byteLength
        if (got > f.bytes) throw new Error('The search model download was larger than expected, so it was not kept. Try again later.')
        h.update(chunk)
        await fh.write(chunk)
        done += chunk.byteLength
        tell()
      }
    } catch (e) {
      await fh.close().catch(() => undefined)
      await rm(part, { force: true }).catch(() => undefined)
      if (o.signal.aborted) throw new DownloadStopped()
      throw e
    }
    await fh.close()
    if (got !== f.bytes || !h.matches()) {
      await rm(part, { force: true })
      throw new Error('The search model download came out damaged, so it was not kept. Try again.')
    }
    await rename(part, path)
  }
  const before = readManifest(dir)
  const same = before?.model === SEARCH_MODEL && before.revision === SEARCH_MODEL_REVISION
  writeManifest(dir, { ...(same ? before : {}), model: SEARCH_MODEL, revision: SEARCH_MODEL_REVISION, at: new Date().toISOString() })
}

/** Removes the downloaded model (Settings › Models, Remove). */
export function removeModel(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}
