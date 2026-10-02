// Adapted from mcreader-v2, src/server/speech/paths.ts (MCreader's speech server lives in tts/ inside its own
// folder, or wherever MCREADER_TTS_DIR says) (Adam's rule, 2 October 2026: only speech code is reused).
//
// Finding MCreader v2's copy of the voices, so the 12 GB isn't downloaded twice. Its tts folder has the same
// layout AI Write's speech folder uses for Breeze (venvs/breeze, models/breeze/code, models/hf), so AI Write's
// server runs Breeze from it as it is. Nothing there is ever changed. No Electron here.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { breezeComplete } from './installed'

/** The folder names MCreader v2 is likely to have been put in. */
const NAMES = ['mcreader-v2', 'MCreader-v2', 'mcreader', 'MCreader', 'mcreader2', 'MCreader v2']

/** Where people keep code they cloned, under their home folder (and a few drive roots on Windows). */
const ROOTS = [
  '',
  'Documents',
  'Documents/GitHub',
  'GitHub',
  'source/repos',
  'Desktop',
  'Projects',
  'projects',
  'code',
  'Code',
  'dev',
  'repos',
  'src',
  'OneDrive/Documents',
  'OneDrive/Documents/GitHub'
]
const DRIVES = ['C:\\', 'C:\\dev', 'C:\\code', 'C:\\Projects', 'C:\\src', 'D:\\', 'D:\\dev', 'D:\\code', 'D:\\Projects']

/** Every tts folder MCreader v2 might have, most likely first. `guess` false: only where MCREADER_TTS_DIR says. */
export function mcreaderCandidates(
  env: Record<string, string | undefined>,
  home: string,
  platform: NodeJS.Platform = process.platform,
  guess = true
): string[] {
  const out: string[] = []
  const add = (p: string): void => {
    if (p && !out.includes(p)) out.push(p)
  }
  if (env.MCREADER_TTS_DIR?.trim()) add(env.MCREADER_TTS_DIR.trim())
  if (!guess) return out
  for (const root of ROOTS) for (const name of NAMES) add(join(home, ...root.split('/').filter(Boolean), name, 'tts'))
  if (platform === 'win32') for (const root of DRIVES) for (const name of NAMES) add(join(root, name, 'tts'))
  return out
}

/** The tts folder in `dir` (MCreader's own folder, or its tts folder itself) when the voices are complete there; else null. */
export function mcreaderVoicesIn(dir: string, platform: NodeJS.Platform = process.platform): string | null {
  for (const tts of [join(dir, 'tts'), dir]) {
    if (existsSync(tts) && breezeComplete(tts, platform, false)) return tts
  }
  return null
}

/** MCreader v2's tts folder with complete voices, if it is on this computer. */
export function findMCreader(
  env: Record<string, string | undefined>,
  home: string,
  platform: NodeJS.Platform = process.platform,
  guess = true
): string | null {
  for (const tts of mcreaderCandidates(env, home, platform, guess)) {
    if (existsSync(tts) && breezeComplete(tts, platform, false)) return tts
  }
  return null
}
