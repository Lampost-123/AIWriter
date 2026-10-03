// Typewriter scrolling for the scene's page (typewriter.ts). Draws nothing.
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { attachTypewriter } from './typewriter'

export function TypewriterLayer({ editor, scrollerRef }: { editor: Editor; scrollerRef: React.RefObject<HTMLDivElement | null> }): null {
  useEffect(() => attachTypewriter(editor, () => scrollerRef.current), [editor, scrollerRef])
  return null
}
