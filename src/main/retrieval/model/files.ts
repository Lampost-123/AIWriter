// The search model's files: bge-small-en-v1.5 by BAAI (MIT licence), from Hugging Face at a fixed revision, each
// checked by size and hash once downloaded. They go into the app's own data folder (search-model/), never into the
// app, git, a world folder or a backup, as the speech models do. installed.json there records a finished download,
// and the files are checked too, so a folder emptied by hand reads as not downloaded.
//
// The model comes in two forms of the same weights, about 134 MB each, and only one is downloaded: the ONNX file for
// the fast engine (onnxruntime-node), or, on a computer where that engine can't start, the safetensors file for the
// slower one written in TypeScript (bert.ts). No Electron imports.

import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { readJson, writeFileAtomic } from '../../util'

export const SEARCH_MODEL = 'bge-small-en-v1.5'
const REPO = 'BAAI/bge-small-en-v1.5'
/** The revision the files are taken from, so the same files come down every time. */
export const SEARCH_MODEL_REVISION = '5c38ec7c405ec4b44b94cc5a9bb96e735b38267a'

export interface ModelFile {
  /** Its path in the model's folder (and under the revision on Hugging Face), with forward slashes. */
  name: string
  bytes: number
  /** sha256 of the file (Hugging Face's large-file hash), or the git blob sha1 for small files. */
  sha256?: string
  gitSha1?: string
}

/** Which engine reads the model: onnxruntime-node (fast), or the TypeScript reader (bert.ts) when that can't start. */
export type Engine = 'onnx' | 'ts'

/** What both engines need: the config and the vocabulary. */
export const COMMON_FILES: ModelFile[] = [
  { name: 'config.json', bytes: 743, gitSha1: '3992bf890728a92476c700e6e657fd696eb94160' },
  { name: 'vocab.txt', bytes: 231_508, gitSha1: 'fb140275c155a9c7c5a3b3e0e77a9e839594a938' }
]

/** Each engine's weights. */
export const WEIGHTS: Record<Engine, ModelFile> = {
  onnx: { name: 'onnx/model.onnx', bytes: 133_093_490, sha256: '828e1496d7fabb79cfa4dcd84fa38625c0d3d21da474a00f08db0f559940cf35' },
  ts: { name: 'model.safetensors', bytes: 133_466_304, sha256: '3c9f31665447c8911517620762200d2245a2518d6e7208acc78cd9db317e21ad' }
}

/** The files an engine needs. */
export const filesFor = (engine: Engine): ModelFile[] => [...COMMON_FILES, WEIGHTS[engine]]

/** The fast engine's files, the usual download (about 134 MB). */
export const SEARCH_MODEL_FILES = filesFor('onnx')
export const SEARCH_MODEL_BYTES = SEARCH_MODEL_FILES.reduce((n, f) => n + f.bytes, 0)

/** Where a file comes from. `base` lets tests point at a server of their own (AIWRITE_SEARCH_MODEL_URL). */
export const fileUrl = (f: ModelFile, base = 'https://huggingface.co'): string => `${base.replace(/\/$/, '')}/${REPO}/resolve/${SEARCH_MODEL_REVISION}/${f.name}`

/** Where a file goes in the model's folder. */
export const filePath = (dir: string, f: ModelFile): string => join(dir, ...f.name.split('/'))

/** The folder the model lives in, under the app's data folder. */
export const modelDir = (userData: string): string => join(userData, 'search-model', SEARCH_MODEL)
const manifestPath = (dir: string): string => join(dir, 'installed.json')

export interface ModelManifest {
  model: string
  revision: string
  /** When the download finished. */
  at: string
  /** The model passed its check (it tells related sentences from unrelated ones), and when; by engine. */
  checked?: Partial<Record<Engine, { at: string; ok: boolean; why?: string }>>
  /** The fast engine couldn't start on this computer (the slower one's file is downloaded next time), and why. */
  onnxFailed?: { at: string; why: string }
}

const sizeIs = (path: string, bytes: number): boolean => {
  try {
    return statSync(path).size === bytes
  } catch {
    return false
  }
}

/** The finished download's record, for this revision, with the engines whose files are all there (fast one first). */
export function installed(dir: string): (ModelManifest & { engines: Engine[] }) | null {
  const m = readManifest(dir)
  if (!m || m.model !== SEARCH_MODEL || m.revision !== SEARCH_MODEL_REVISION) return null
  const engines = (['onnx', 'ts'] as Engine[]).filter((e) => filesFor(e).every((f) => sizeIs(filePath(dir, f), f.bytes)))
  return engines.length ? { ...m, engines } : null
}

/** The record as it is on disk (whatever files are there), for adding to it. */
export const readManifest = (dir: string): ModelManifest | null => readJson<ModelManifest | null>(manifestPath(dir), null)

export function writeManifest(dir: string, m: ModelManifest): void {
  writeFileAtomic(manifestPath(dir), JSON.stringify(m, null, 2))
}

/**
 * Whether the fast engine is here for this computer: onnxruntime-node is installed with its native files for this
 * platform. Doesn't load it (that happens on a worker thread, which says if it can't start).
 */
export function onnxShipped(platform: NodeJS.Platform = process.platform, arch: string = process.arch): boolean {
  try {
    const main = createRequire(__filename).resolve('onnxruntime-node')
    return existsSync(join(dirname(main), '..', 'bin', 'napi-v6', platform, arch, 'onnxruntime_binding.node'))
  } catch {
    return false
  }
}

/** The engine to download for: the fast one, unless it isn't here or it couldn't start before. */
export function engineToDownload(dir: string, shipped = onnxShipped()): Engine {
  return shipped && !readManifest(dir)?.onnxFailed ? 'onnx' : 'ts'
}
