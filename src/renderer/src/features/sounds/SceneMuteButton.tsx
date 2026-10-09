// The reading bar's "Mute sounds in this scene" (shown while sound effects are on): a round button beside the speed,
// a speaker while the scene's sounds play and a crossed-out speaker once they are muted. Pressed, the ambience fades
// out at once and the reading plans its next lines without sounds; pressed again, they come back from the next line.
// Kept with the world (muteSceneSounds); what it shows comes from the scene's sounds (SceneSounds.muted).
import { Volume2, VolumeX } from '@/components/ui/icons'
import { useEffect } from 'react'
import type { ID } from '@shared/types'
import { onEvent } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { useSceneMute } from './sceneMute'
import { loadSceneMute, setSceneMuted } from './soundsStore'

export function SceneMuteButton({ sceneId }: { sceneId: ID | null }): React.JSX.Element | null {
  const on = useApp((s) => !!s.settings?.speech.readAloud && !!s.settings?.speech.soundEffects)
  const muted = useSceneMute((s) => (sceneId ? !!s.muted[sceneId] : false))

  useEffect(() => {
    if (!on || !sceneId) return
    void loadSceneMute(sceneId)
    // Changed from elsewhere (the Sounds view's Undo of a scene's edits brings its mute back too).
    return onEvent('sounds:marked', (e) => {
      if (e.sceneId === sceneId) void loadSceneMute(sceneId)
    })
  }, [on, sceneId])

  if (!on || !sceneId) return null
  return (
    <button
      type="button"
      aria-label="Mute sounds in this scene"
      aria-pressed={muted}
      title={muted ? 'The sounds in this scene are muted. Press to hear them again.' : 'Mute sounds in this scene'}
      onClick={() => void setSceneMuted(sceneId, !muted)}
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border outline-none transition-colors duration-150',
        'focus-visible:ring-2 focus-visible:ring-accent/50',
        muted
          ? 'border-line-strong bg-surface-2 text-muted hover:text-fg'
          : 'border-accent/35 bg-page text-accent hover:border-accent/70'
      )}
    >
      {muted ? <VolumeX size={14} aria-hidden /> : <Volume2 size={14} aria-hidden />}
    </button>
  )
}
