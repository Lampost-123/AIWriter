// Where the speech engine's files are. Pure: src/main/speech/index.ts passes in the user data folder and
// where the server's source is, so tests can use any folder.
//
// Everything downloaded (Python environments, packages, models) goes in the speech folder of AI Write's
// user data, never in the app's own folder, git, a world folder or a backup. The server's Python source
// ships with the app (resources/speech-server) and is only read.
import { join } from 'node:path'

export interface SpeechPaths {
  /** The speech folder in AI Write's user data. */
  home: string
  /** The server's Python source, shipped with the app. Never written to. */
  source: string
  /** The server's own Python environment, and its Python for the download steps. */
  venv: string
  python: string
  /** The Python that runs the server: pythonw on Windows, so no console window opens. */
  serve: string
  /** Breeze's environment, code and weights: AI Write's own copy (the speech folder) or MCreader's tts folder. */
  breezeRoot: string
  breezePython: string
  /** server.log and install.log. */
  logs: string
  /** pip's downloads, Python's compiled files and the steps' temporary files: emptied after each download. */
  cache: string
  /** Which downloads finished (installed.json). */
  manifest: string
  /** Dictation models (the server's config.py names the same folders). */
  parakeet: string
  whisper: string
}

/** The Python inside a virtual environment. `windowed` is pythonw on Windows (no console window). */
export function venvPython(venv: string, platform: NodeJS.Platform = process.platform, windowed = false): string {
  return platform === 'win32' ? join(venv, 'Scripts', windowed ? 'pythonw.exe' : 'python.exe') : join(venv, 'bin', 'python')
}

/** The speech folder's layout. `breezeRoot` is MCreader's tts folder when its copy of the voices is used. */
export function speechPaths(
  userData: string,
  source: string,
  breezeRoot?: string | null,
  platform: NodeJS.Platform = process.platform
): SpeechPaths {
  const home = join(userData, 'speech')
  const venv = join(home, 'venv')
  const root = breezeRoot || home
  return {
    home,
    source,
    venv,
    python: venvPython(venv, platform),
    serve: venvPython(venv, platform, true),
    breezeRoot: root,
    breezePython: venvPython(join(root, 'venvs', 'breeze'), platform),
    logs: join(home, 'logs'),
    cache: join(home, 'cache'),
    manifest: join(home, 'installed.json'),
    parakeet: join(home, 'models', 'parakeet'),
    whisper: join(home, 'models', 'whisper')
  }
}

/** The Breeze weights' folder in a Hugging Face cache (the repo id MCreader uses, so its copy is the same files). */
export const breezeWeightsDir = (breezeRoot: string): string => join(breezeRoot, 'models', 'hf', 'hub', 'models--BreezeBlue--breeze-tts-2')

/** Breeze's inference code, unpacked from a pinned commit. */
export const breezeCodeDir = (breezeRoot: string): string => join(breezeRoot, 'models', 'breeze', 'code')

/**
 * The mark the voices' last download step leaves once everything checked out (speech-server/tools/install.py,
 * breeze-check): AI Write's own copy counts as downloaded only with it. Removed as the voices start downloading.
 */
export const breezeMark = (breezeRoot: string): string => join(breezeRoot, 'models', 'breeze', '.ready')
