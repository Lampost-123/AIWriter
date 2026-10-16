// Adapted from mcreader-v2, src/server/speech/speak.ts (engineFingerprint, isWav) and src/server/speech/library.ts
// (libraryKeyParts) (reading aloud's own text-to-speech code; Adam's rule, 2 October 2026). MCreader's studio voices
// carry their acted clips in their list; AI Write's are read off the folder, as the speech server reads them.
//
// What a clip's key needs beyond the request itself, so the cache never plays a line made another way: Breeze's code
// and switches (engineFingerprint), and what the studio voice it is copied from has now (studioKeyParts).
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** github.com/breezeblue-ai/breeze-tts at the commit AI Write installs (speech-server/tools/install.py, BREEZE_COMMIT). */
export const BREEZE_COMMIT = '008f769016b0a24711becd7a4925030bc93f608c'
/** Breeze's weights (speech-server/app/workers/breeze.py, REPO). */
export const BREEZE_MODEL = 'BreezeBlue/breeze-tts-2'

/**
 * Which acted clip a studio voice reads a line's feeling from: the speech server's MOOD_CLIPS
 * (speech-server/app/workers/breeze.py), which a test keeps the same.
 */
export const MOOD_CLIPS: Readonly<Record<string, string>> = {
  angry: 'anger',
  afraid: 'fear',
  happy: 'amusement',
  playful: 'amusement',
  tender: 'adoration',
  sad: 'sadness',
  contemptuous: 'disgust',
  surprised: 'amazement',
  excited: 'amazement',
  anxious: 'distress',
  tense: 'distress',
  longing: 'disappointment',
  warm: 'contentment',
  whisper: 'whisper',
  loud: 'loud'
}

/**
 * What changes how Breeze sounds without changing the request: its code, its weights, and the switches the speech
 * server's worker reads from the environment it inherits from AI Write (speech-server/app/workers/breeze.py).
 */
export function engineFingerprint(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return {
    commit: BREEZE_COMMIT,
    model: env.AIWRITE_BREEZE_MODEL || BREEZE_MODEL,
    cfg: env.AIWRITE_BREEZE_CFG ?? '',
    narrationCfg: env.AIWRITE_BREEZE_NARRATION_CFG ?? '',
    fast: env.AIWRITE_BREEZE_FAST ?? '',
    compile: env.AIWRITE_BREEZE_COMPILE ?? ''
  }
}

/** Whether a reply is a WAV clip with sound in it: anything else (a stray server's page, an empty clip) isn't kept. */
export const isWav = (audio: Buffer): boolean =>
  audio.length > 44 && audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE'

const STUDIO = /^clip:library\/([A-Za-z0-9_-]+)\.wav$/

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** For each studio voice whose calm clip is there (with its words), the acted clips it has: read once per change of its list. */
let facts: { key: string; byId: Map<string, Set<string>> } | null = null

function voiceFacts(dir: string): Map<string, Set<string>> {
  let stamp = 0
  try {
    stamp = statSync(join(dir, 'index.json')).mtimeMs
  } catch {
    /* not downloaded: every voice is missing */
  }
  const key = `${dir}|${stamp}`
  if (facts?.key === key) return facts.byId
  const byId = new Map<string, Set<string>>()
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    names = []
  }
  for (const name of names) {
    const id = name.match(/^([A-Za-z0-9_-]+)\.wav$/)?.[1]
    if (!id || !isFile(join(dir, `${id}.txt`))) continue
    const moods = new Set<string>()
    try {
      for (const f of readdirSync(join(dir, id))) {
        const acted = f.match(/^(.+)\.wav$/)?.[1]
        if (acted && isFile(join(dir, id, `${acted}.txt`))) moods.add(acted)
      }
    } catch {
      /* no acted clips: every feeling is read from the calm one */
    }
    byId.set(id, moods)
  }
  facts = { key, byId }
  return byId
}

/**
 * What a clip's key needs to know about the studio voice it is copied from, so the cache never plays a line in a sound
 * the voice doesn't have now. The worker reads a voice that is gone in a designed voice instead (`missing`), and a
 * feeling the voice has no acted clip of from its calm clip (`calmFor`); both change once the clip is there. Nothing
 * for a line made from a description (the worker puts a description first) or a voice that isn't a studio one.
 */
export function studioKeyParts(
  voice: string | undefined,
  voiceDesign: string | undefined,
  mood: string | undefined,
  dir: string | null
): { missing?: true; calmFor?: string } {
  const id = voice?.match(STUDIO)?.[1]
  if (!id || voiceDesign?.trim() || !dir) return {}
  const moods = voiceFacts(dir).get(id)
  if (!moods) return { missing: true }
  const acted = mood ? MOOD_CLIPS[mood] : undefined
  return acted && !moods.has(acted) ? { calmFor: mood } : {}
}
