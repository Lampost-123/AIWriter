// What is downloaded: installed.json in the speech folder records each download that finished, and the
// files themselves are checked too, so a folder emptied by hand reads as not downloaded. No Electron here.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { SpeechStatus } from '@shared/contracts/speech'
import { readJson, writeFileAtomic } from '../util'
import { breezeCodeDir, breezeWeightsDir, venvPython, type SpeechPaths } from './paths'

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
    return readdirSync(path) !== null
  } catch {
    return false
  }
}

/** Breeze can run from `root`: its environment, its code and a complete snapshot of its weights are there. */
export function breezeComplete(root: string, platform: NodeJS.Platform = process.platform): boolean {
  if (!existsSync(venvPython(join(root, 'venvs', 'breeze'), platform))) return false
  if (!isDir(join(breezeCodeDir(root), 'breeze_infer'))) return false
  const snapshots = join(breezeWeightsDir(root), 'snapshots')
  try {
    return readdirSync(snapshots).some((s) => existsSync(join(snapshots, s, 'config.json')))
  } catch {
    return false
  }
}

/** Parakeet's model is unpacked under `dir` (one folder down, as its archive unpacks). */
export function parakeetFiles(dir: string): boolean {
  if (existsSync(join(dir, 'encoder.int8.onnx'))) return true
  try {
    return readdirSync(dir).some((d) => existsSync(join(dir, d, 'encoder.int8.onnx')))
  } catch {
    return false
  }
}

/** Whisper's English model is in its Hugging Face cache under `dir` (where faster-whisper looks). */
export function whisperFiles(dir: string): boolean {
  const snapshots = join(dir, 'models--Systran--faster-whisper-base.en', 'snapshots')
  try {
    return readdirSync(snapshots).some((s) => existsSync(join(snapshots, s, 'model.bin')))
  } catch {
    return false
  }
}

/** What is downloaded now: finished (in the manifest) and still on disk. */
export function installedNow(
  paths: SpeechPaths,
  manifest: SpeechManifest,
  platform: NodeJS.Platform = process.platform
): SpeechStatus['installed'] {
  const server = !!manifest.server && existsSync(paths.python)
  const voices = manifest.voices && breezeComplete(manifest.voices.root, platform) ? manifest.voices.from : null
  return {
    server,
    voices,
    parakeet: !!manifest.parakeet && parakeetFiles(paths.parakeet),
    whisper: !!manifest.whisper && whisperFiles(paths.whisper)
  }
}
