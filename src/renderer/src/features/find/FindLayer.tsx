// Find and replace (Writing by hand), mounted once in the workspace (App.tsx): Ctrl+F shows the find bar over
// the open scene (FindBar, in the writing page), Ctrl+Shift+F find and replace across the story (StoryFind).
import { useEffect } from 'react'
import { isShortcut } from '@/lib/shortcuts'
import { useFind } from './findStore'
import { openFindInScene, openFindInStory } from './open'
import { StoryFind } from './StoryFind'

/** A dialog or menu of another part is open: its keys are its own. */
const otherLayerOpen = (): boolean =>
  !!document.querySelector('[role="dialog"][data-state="open"]:not([data-find-story]), [role="alertdialog"][data-state="open"]')

export function FindLayer(): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat) return
      const scene = isShortcut(e, 'findInScene')
      const story = isShortcut(e, 'findInStory')
      if (!scene && !story) return
      const storyOpen = useFind.getState().storyOpen
      if (!storyOpen && otherLayerOpen()) return
      e.preventDefault()
      if (story) openFindInStory()
      else openFindInScene()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return <StoryFind />
}
