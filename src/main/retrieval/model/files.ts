// The search model's files: bge-small-en-v1.5 by BAAI (MIT licence), from Hugging Face at a fixed revision, each
// checked by size and hash once downloaded. They go into the app's own data folder (search-model/), never into the
// app, git, a world folder or a backup, as the speech models do. installed.json there records a finished download,
// and the files are checked too, so a folder emptied by hand reads as not downloaded. No Electron imports.

import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeFileAtomic } from '../../util'

export const SEARCH_MODEL = 'bge-small-en-v1.5'
const REPO = 'BAAI/bge-small-en-v1.5'
/** The revision the files are taken from, so the same files come down every time. */
export const SEARCH_MODEL_REVISION = '5c38ec7c405ec4b44b94cc5a9bb96e735b38267a'

export interface ModelFile {
  name: string
  bytes: number
  /** sha256 of the file (Hugging Face's large-file hash), or the git blob sha1 for small files. */
  sha256?: string
  gitSha1?: string
}

/** What the reader needs: the weights, the vocabulary and the config. About 134 MB in all. */
export const SEARCH_MODEL_FILES: ModelFile[] = [
  { name: 'config.json', bytes: 743, gitSha1: '3992bf890728a92476c700e6e657fd696eb94160' },
  { name: 'vocab.txt', bytes: 231_508, gitSha1: 'fb140275c155a9c7c5a3b3e0e77a9e839594a938' },
  { name: 'model.safetensors', bytes: 133_466_304, sha256: '3c9f31665447c8911517620762200d2245a2518d6e7208acc78cd9db317e21ad' }
]

export const SEARCH_MODEL_BYTES = SEARCH_MODEL_FILES.reduce((n, f) => n + f.bytes, 0)

/** Where a file comes from. `base` lets tests point at a server of their own (AIWRITE_SEARCH_MODEL_URL). */
export const fileUrl = (f: ModelFile, base = 'https://huggingface.co'): string => `${base.replace(/\/$/, '')}/${REPO}/resolve/${SEARCH_MODEL_REVISION}/${f.name}`

/** The folder the model lives in, under the app's data folder. */
export const modelDir = (userData: string): string => join(userData, 'search-model', SEARCH_MODEL)
const manifestPath = (dir: string): string => join(dir, 'installed.json')

export interface ModelManifest {
  model: string
  revision: string
  /** When the download finished. */
  at: string
  /** The model passed its check (it tells related sentences from unrelated ones), and when. */
  checked?: { at: string; ok: boolean; why?: string }
}

/** The finished download's record, when it is there, for this revision, with every file the right size. */
export function installed(dir: string, files: ModelFile[] = SEARCH_MODEL_FILES): ModelManifest | null {
  const m = readJson<ModelManifest | null>(manifestPath(dir), null)
  if (!m || m.model !== SEARCH_MODEL || m.revision !== SEARCH_MODEL_REVISION) return null
  for (const f of files) {
    try {
      if (statSync(join(dir, f.name)).size !== f.bytes) return null
    } catch {
      return null
    }
  }
  return m
}

export function writeManifest(dir: string, m: ModelManifest): void {
  writeFileAtomic(manifestPath(dir), JSON.stringify(m, null, 2))
}

export const hasAnyFiles = (dir: string): boolean => existsSync(dir)
