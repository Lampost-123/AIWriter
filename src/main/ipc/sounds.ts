// AI sound effects under Read aloud: the handlers for src/shared/contracts/sounds.ts. The work is done in
// src/main/sounds/; what comes from the window is checked and cut to size there and here.
import type { Handlers } from './index'
import type { CueTimesRequest, SoundsApi } from '@shared/contracts/sounds'
import { defaultSpeechSettings } from '@shared/defaults'
import { getSettings } from '../settings'
import * as readAloud from '../readAloud'
import { clipKey } from '../readAloud/speak'
import * as sounds from '../sounds'

/** At most this many sounds are timed in one clip. */
const MAX_CUES = 50

/** When a clip's sounds are heard: the request checked (the clip as reading aloud would ask for it, places inside it). */
function cueTimes(req: CueTimesRequest): Promise<{ seconds: number[]; aligned: boolean }> {
  const text = typeof req?.text === 'string' ? req.text.slice(0, 20_000) : ''
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(text.length, Math.round(v))) : 0)
  const from = num(req?.from)
  const to = Math.max(from, num(req?.to))
  const at = Array.isArray(req?.at) ? req.at.slice(0, MAX_CUES).map(num) : []
  if (!at.length) return Promise.resolve({ seconds: [], aligned: false })
  const engine = { ...defaultSpeechSettings(), ...getSettings().speech }.engine
  const key = clipKey(readAloud.clipOf(req?.clip), engine)
  return sounds.soundCueTimes({ key, text, from, to, at }, readAloud.audioCache())
}

export const soundsHandlers: Handlers<keyof SoundsApi> = {
  getSoundsStatus: () => sounds.getSoundsStatus(),
  getSceneSounds: (sceneId, paragraphs) => sounds.getSceneSounds(sceneId, paragraphs),
  markSceneSounds: (sceneId, paragraphs) => sounds.markSceneSounds(sceneId, paragraphs),
  editSoundCue: (sceneId, paragraphs, cueId, cue) => sounds.editSoundCue(sceneId, paragraphs, cueId, cue),
  restoreSoundEdits: (sceneId, edits, paragraphs) => sounds.restoreSoundEdits(sceneId, edits, paragraphs),
  soundAudio: (soundId) => sounds.soundAudio(soundId),
  makeSoundNow: (soundId) => sounds.makeSoundNow(soundId),
  soundCueTimes: (req) => cueTimes(req),
  listSoundLibrary: () => sounds.listSoundLibrary(),
  clearSoundLibrary: () => sounds.clearSoundLibrary(),
  undoClearSoundLibrary: () => sounds.undoClearSoundLibrary(),
  retakeSound: (soundId) => sounds.retakeSound(soundId),
  keepTake: (soundId, keep) => sounds.keepTake(soundId, keep),
  muteSceneSounds: (sceneId, muted) => sounds.muteSceneSounds(sceneId, muted)
}
