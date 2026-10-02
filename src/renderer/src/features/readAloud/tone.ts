// "Emotion and tone", as the reading bar and Settings › Read aloud and dictation say it. It is on when Mark who
// says what is on: the AI notes how each line is said (its feeling, tone and pace) and the voice performs it. Sighs
// and laughs are Perform written sounds, said beside it. Owned by the Read aloud part.
import type { SpeechSettings } from '@shared/types'

export const TONE_ON =
  'Each line is read with the feeling the scene calls for: the AI notes how every line is said, its tone and pace, a little ahead of the reading.'
export const TONE_OFF = 'Lines are read evenly, with a tone only where the words say how (“she snapped”).'
export const SOUNDS_ON = 'Sighs, laughs and “Ahem” are performed as real sounds.'
export const SOUNDS_OFF = 'Sighs, laughs and “Ahem” are read out as words.'

/** The id of How it reads in Settings › Read aloud and dictation (Mark who says what, Perform written sounds). */
export const HOW_IT_READS = 'read-aloud-how-it-reads'

/** On or Off, as plain words. */
export const onOff = (on: boolean): string => (on ? 'On' : 'Off')

/** The reading bar's Emotion and tone tooltip: what it does now, and where to change it. */
export function toneTooltip(speech: Pick<SpeechSettings, 'markSpeakers' | 'sounds'>): string {
  return [
    `Emotion and tone: ${onOff(speech.markSpeakers)}. ${speech.markSpeakers ? TONE_ON : TONE_OFF}`,
    `Sighs and laughs: ${onOff(speech.sounds)}. ${speech.sounds ? SOUNDS_ON : SOUNDS_OFF}`,
    'Click to change them, here or in Settings › Read aloud and dictation › More › How it reads.'
  ].join('\n')
}
