// "Show speakers and tone" beside Listen in the scene toolbar: a small toggle, off by default (also in Settings ›
// Read aloud and dictation, and in the palette). Shown while read aloud is on, or while the labels are showing so
// they can be hidden where they are seen. Owned by the Read aloud part.
import { MessageSquareQuote } from 'lucide-react'
import { toast } from '@/components/ui'
import { useApp } from '@/lib/store'
import { ToolButton } from '@/features/editor/ToolButton'

/** Turns "Show speakers and tone" on or off (saved at once). */
export async function setShowSpeakers(on: boolean): Promise<void> {
  try {
    await useApp.getState().updateSettings({ speech: { showSpeakers: on } })
  } catch (e) {
    toast(`That change couldn't be saved. ${(e as Error).message}`, { tone: 'danger' })
  }
}

export function SpeakersButton(): React.JSX.Element | null {
  const readAloud = useApp((s) => !!s.settings?.speech.readAloud)
  const on = useApp((s) => !!s.settings?.speech.showSpeakers)
  if (!readAloud && !on) return null
  return (
    <ToolButton
      icon={<MessageSquareQuote size={15} />}
      label="Speakers and tone"
      wordsFrom="never"
      active={on}
      title={on ? 'Hide who says each paragraph, and how' : 'Show who says each paragraph, and how'}
      // The caret stays in the page.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => void setShowSpeakers(!on)}
    />
  )
}
