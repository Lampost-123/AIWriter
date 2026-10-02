// The keyboard shortcuts list's line for dictation (milestone 4): hold the key Adam picked to talk. Its key
// is his own choice, so it isn't in lib/shortcuts.ts: the line shows the key picked, or where to pick one.
// Owned by the Dictation part; placed by features/palette/ShortcutsList.tsx.
import { Kbd } from '@/components/ui'
import { isMac } from '@/lib/api'
import { useApp } from '@/lib/store'
import { usePalette } from '@/features/palette/paletteStore'
import { keyName } from './keys'
import { openSpeechSettings } from './session'

export function HoldToTalkLine(): React.JSX.Element {
  const key = useApp((s) => s.settings?.speech?.dictationKey ?? '')
  const name = keyName(key, isMac())
  return (
    <li className="flex min-h-8 items-center gap-4 border-b border-line py-1 last:border-b-0">
      <span className="flex-1 text-[13.5px] text-fg">
        Speak instead of typing
        <span className="text-muted"> (hold, talk, let go)</span>
        <span className="sr-only">: {key ? `hold ${name}` : 'pick a key in Settings, Read aloud and dictation'}</span>
      </span>
      {key ? (
        <span className="flex shrink-0 items-center gap-1 text-[12px] text-faint" aria-hidden>
          <Kbd>{name}</Kbd>
        </span>
      ) : (
        <button
          type="button"
          className="shrink-0 rounded text-[12px] text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
          onClick={() => {
            usePalette.setState({ shortcuts: false })
            openSpeechSettings()
          }}
        >
          Pick a key in Settings › Read aloud and dictation
        </button>
      )}
    </li>
  )
}
