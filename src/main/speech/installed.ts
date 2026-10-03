// What is downloaded: installed.json in the speech folder records each download that finished, and the
// files themselves are checked too, so a folder emptied by hand reads as not downloaded, and a download
// stopped part way never reads as done. The speech server makes the same checks (speech-server/app/
// downloaded.py). No Electron here.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SpeechStatus } from '@shared/contracts/speech'
import { readJson, writeFileAtomic } from '../util'
import { breezeCodeDir, breezeMark, breezeWeightsDir, venvPython, type SpeechPaths } from './paths'

export interface SpeechManifest {
  /** The server's environment, made with this Python. */
  server?: { at: string; python: string }
  /** The voices: AI Write's own copy (in the speech folder), and the graphics card seen. Only `own` counts. */
  voices?: { at: string; from: 'own'; root: string; gpu: string }
  parakeet?: { at: string }
  whisper?: { at: string }
}

export const readManifest = (file: string): SpeechManifest => readJson<SpeechManifest>(file, {})

export const writeManifest = (file: string, manifest: SpeechManifest): void => writeFileAtomic(file, JSON.stringify(manifest, null, 2))

const isDir = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** Whisper's English model (Systran/faster-whisper-base.en): every file faster-whisper reads. */
export const WHISPER_FILES = ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt']
export const PARAKEET_FILES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']
/** Where Parakeet's archive is unpacked before it is moved into place: never counted as downloaded. */
const UNPACKING = '.unpack'

/** Hugging Face keeps a file it is still fetching (or was, when it was stopped) as blobs/<id>.incomplete. */
function halfDownloaded(cache: string): boolean {
  try {
    return readdirSync(join(cache, 'blobs')).some((n) => n.endsWith('.incomplete'))
  } catch {
    return false
  }
}

/** The snapshot in a Hugging Face cache folder the server loads (the one refs/main names, else any) when it has every file in `needs`. */
export function snapshotWith(cache: string, needs: readonly string[]): string | null {
  const snapshots = join(cache, 'snapshots')
  let ref = ''
  try {
    ref = readFileSync(join(cache, 'refs', 'main'), 'utf8').trim()
  } catch {
    /* no ref: any snapshot */
  }
  let names: string[]
  try {
    names = ref && isDir(join(snapshots, ref)) ? [ref] : readdirSync(snapshots).filter((n) => isDir(join(snapshots, n)))
  } catch {
    return null
  }
  for (const name of names.sort()) {
    if (needs.every((f) => isFile(join(snapshots, name, f)))) return join(snapshots, name)
  }
  return null
}

/**
 * Breeze can run from `root`: its environment, its code and its weights are there, and the voices' last download
 * step checked them and left its mark. AI Write only ever uses its own copy, in its speech folder.
 */
export function breezeComplete(root: string, platform: NodeJS.Platform = process.platform): boolean {
  if (!existsSync(venvPython(join(root, 'venvs', 'breeze'), platform))) return false
  if (!isDir(join(breezeCodeDir(root), 'breeze_infer'))) return false
  return isFile(breezeMark(root)) && snapshotWith(breezeWeightsDir(root), ['config.json']) !== null
}

/** All four of Parakeet's files are in one folder under `dir` (itself, or one folder down as its archive unpacks). */
export function parakeetFiles(dir: string): boolean {
  let folders: string[]
  try {
    const inside = readdirSync(dir).filter((d) => d !== UNPACKING && isDir(join(dir, d)))
    folders = [dir, ...inside.map((d) => join(dir, d))]
  } catch {
    return false
  }
  return folders.some((f) => PARAKEET_FILES.every((name) => isFile(join(f, name))))
}

/** All of Whisper's English model is in its Hugging Face cache under `dir` (where faster-whisper looks). */
export function whisperFiles(dir: string): boolean {
  const cache = join(dir, 'models--Systran--faster-whisper-base.en')
  return !halfDownloaded(cache) && snapshotWith(cache, WHISPER_FILES) !== null
}

/** What is downloaded now: finished (in the manifest) and still on disk. */
export function installedNow(
  paths: SpeechPaths,
  manifest: SpeechManifest,
  platform: NodeJS.Platform = process.platform
): SpeechStatus['installed'] {
  const server = !!manifest.server && existsSync(paths.python)
  const v = manifest.voices
  // Only AI Write's own copy in its own speech folder: a test build once recorded MCreader's folder here.
  const voices = v?.from === 'own' && breezeComplete(paths.home, platform) ? 'own' : null
  return {
    server,
    voices,
    parakeet: !!manifest.parakeet && parakeetFiles(paths.parakeet),
    whisper: !!manifest.whisper && whisperFiles(paths.whisper)
  }
}
