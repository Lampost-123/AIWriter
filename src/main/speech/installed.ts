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
  /** The voices: AI Write's own copy (in the speech folder) or MCreader's (its tts folder), and the graphics card seen. */
  voices?: { at: string; from: 'own' | 'mcreader'; root: string; gpu: string }
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

/** Besides the shards its index names: what Breeze reads to speak (its tokenizer and the audio codec). */
export const BREEZE_NEEDS = ['config.json', 'tokenizer.json', 'tokenizer_config.json', join('audio_tokenizer', 'model.safetensors')]
const BREEZE_INDEX = 'model.safetensors.index.json'
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

/** Breeze's weights at `root` look whole (a copy without AI Write's mark): every shard its index names and what speaking needs, nothing half-downloaded. */
export function breezeWeightsWhole(root: string): boolean {
  const cache = breezeWeightsDir(root)
  if (halfDownloaded(cache)) return false
  const snapshot = snapshotWith(cache, [...BREEZE_NEEDS, BREEZE_INDEX])
  if (!snapshot) return false
  try {
    const index = JSON.parse(readFileSync(join(snapshot, BREEZE_INDEX), 'utf8')) as { weight_map?: Record<string, unknown> }
    const shards = [...new Set(Object.values(index.weight_map ?? {}).map(String))]
    return shards.length > 0 && shards.every((f) => isFile(join(snapshot, f)))
  } catch {
    return false
  }
}

/**
 * Breeze can run from `root`: its environment, its code and all of its weights are there. AI Write's own copy
 * (`own`) counts once its last download step checked it and left its mark; MCreader v2's copy, which has no
 * mark, when its weights look whole.
 */
export function breezeComplete(root: string, platform: NodeJS.Platform = process.platform, own = true): boolean {
  if (!existsSync(venvPython(join(root, 'venvs', 'breeze'), platform))) return false
  if (!isDir(join(breezeCodeDir(root), 'breeze_infer'))) return false
  if (own) return isFile(breezeMark(root)) && snapshotWith(breezeWeightsDir(root), ['config.json']) !== null
  return breezeWeightsWhole(root)
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
  const voices = v && breezeComplete(v.root, platform, v.from === 'own') ? v.from : null
  return {
    server,
    voices,
    parakeet: !!manifest.parakeet && parakeetFiles(paths.parakeet),
    whisper: !!manifest.whisper && whisperFiles(paths.whisper)
  }
}
