// The Hugging Face key, for the voices' download when Hugging Face asks for their licence to be accepted, and
// the sound effects' (Stable Audio Open always asks). It is kept by secrets.ts like the AI keys (encrypted, never
// in settings.json), the status only says whether there is one, and only the voices' and the sound effects'
// weights steps get it (plan.ts), with every line they print scrubbed (output.ts). Pure.
import { UserError } from '../util'

/** Its name in secrets.ts. */
export const HF_KEY_SECRET = 'speech:huggingface'

/** Checks a key as pasted: one word, of a sensible length. '' for an empty box. */
export function cleanHuggingFaceKey(input: string): string {
  const key = input.trim()
  if (!key) return ''
  if (/\s/.test(key) || key.length < 8 || key.length > 300) {
    throw new UserError('That doesn’t look like a Hugging Face key. Copy it again from Hugging Face (it starts with “hf_”).', 'speech-key')
  }
  return key
}
