// On an entry's page: a character's "Read-aloud voice" (Suggest, Hear) and, for any entry, "Say it as"
// with Listen. Kept in the world's meta key read_aloud. Shown in features/world/EntryForm.tsx only once
// read aloud is turned on. Owned by the Read aloud part. Groundwork stand-in.
import type { Entry } from '@shared/types'

export function EntryVoice(_props: { entry: Entry }): React.JSX.Element | null {
  return null
}
