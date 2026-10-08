// The headphones button in the scene toolbar (only once read aloud is turned on). Owned by the Read
// aloud part. It reads from the paragraph at the cursor; pressed again it pauses, then carries on. Ctrl+L
// does the same from the page.
import { Headphones } from '@/components/ui/icons'
import { useEffect } from 'react'
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { layerOpen } from '@/lib/layers'
import { isShortcut, withShortcut } from '@/lib/shortcuts'
import { ToolButton } from '@/features/editor/ToolButton'
import { toggleListen, useReading } from './control'

export function ListenButton({ sceneId }: { sceneId: ID }): React.JSX.Element | null {
  const on = useApp((s) => !!s.settings?.speech.readAloud)
  const reading = useReading((s) => s.reading && s.sceneId === sceneId)
  const paused = useReading((s) => s.paused)

  useEffect(() => {
    if (!on) return
    const onKey = (e: KeyboardEvent): void => {
      if (!isShortcut(e, 'listen') || useApp.getState().view.kind !== 'write' || layerOpen()) return
      e.preventDefault()
      toggleListen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [on])

  if (!on) return null
  const title = reading ? (paused ? 'Carry on reading aloud' : 'Pause reading aloud') : 'Listen from the cursor'
  return (
    <ToolButton
      icon={<Headphones size={15} />}
      label="Listen"
      active={reading}
      title={withShortcut(title, 'listen')}
      // The caret stays in the page, so Adam can keep writing while it reads.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => toggleListen()}
    />
  )
}
