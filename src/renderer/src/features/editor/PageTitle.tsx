// The New look: the scene's title at the head of the page, in Literata's display cut, under a small line saying where
// the scene sits ("Chapter 1 · Scene 2"). Click it to rename the scene, as the title in Classic's header does. It
// scrolls with the words; the prose itself is untouched.
import { useState } from 'react'
import type { ID } from '@shared/types'
import * as actions from '@/features/binder/actions'
import { InlineTitle } from '@/features/binder/InlineTitle'
import { useOutline } from '@/features/binder/outlineStore'

export function PageTitle({ sceneId, fallbackTitle }: { sceneId: ID; fallbackTitle: string }): React.JSX.Element {
  const { outline } = useOutline()
  const [editing, setEditing] = useState(false)
  const meta = outline?.scenes.find((s) => s.id === sceneId)
  const title = meta?.title ?? fallbackTitle
  const chapterIndex = meta && outline ? outline.chapters.findIndex((c) => c.id === meta.chapterId) : -1
  const sceneIndex = meta && outline ? outline.scenes.filter((s) => s.chapterId === meta.chapterId).findIndex((s) => s.id === sceneId) : -1
  const where = chapterIndex >= 0 && sceneIndex >= 0 ? `Chapter ${chapterIndex + 1} · Scene ${sceneIndex + 1}` : ''
  return (
    <div data-page-title className="mb-7 select-none font-sans">
      <p className="flex h-4 items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-faint">
        {where ? (
          <>
            <span>{where}</span>
            <i aria-hidden className="h-px w-[18px] bg-line-strong" />
          </>
        ) : null}
      </p>
      {editing ? (
        <div className="mt-2 flex">
          <InlineTitle
            label="Scene title"
            value={title}
            className="h-[42px] font-heading text-[30px] font-semibold tracking-[-0.015em]"
            onCommit={(t) => actions.renameScene(sceneId, t)}
            onDone={() => setEditing(false)}
          />
        </div>
      ) : (
        <h1 className="mt-2">
          <button
            type="button"
            title="Rename this scene"
            onClick={() => setEditing(true)}
            className="-mx-1.5 max-w-full rounded-md px-1.5 text-left font-heading text-[30px] font-semibold leading-[1.15] tracking-[-0.015em] text-fg outline-none transition-colors duration-(--dur-quick) [overflow-wrap:anywhere] hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {title || 'Untitled scene'}
          </button>
        </h1>
      )}
    </div>
  )
}
