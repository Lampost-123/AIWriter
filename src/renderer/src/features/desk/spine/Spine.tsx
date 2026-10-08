// The desk's story spine (the New look's desk layout): a slim dark capsule down the left of the writing page, with each
// chapter's numeral and a ring for each scene (hollow when planned, half when drafted, three quarters when revised,
// full with a tick when done), the open scene lit by the lamp. A ring opens its scene; the spine itself opens the
// flyout with the whole story (the binder, with everything it does). + adds a scene after the open one.
// spineLayout.ts decides where everything goes (a long story's chapters fold to their numerals, the open one stays).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ID, Outline, SceneStatus } from '@shared/types'
import { Plus } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { useOutline } from '@/features/binder/outlineStore'
import { requestEditorFocus } from '@/features/editor/focusRequest'
import { STATUS_LABELS } from '@/features/binder/StatusDot'
import { newSceneAfterOpen } from '@/features/palette/actions'
import { useDeskStore, toggleFlyout } from '../deskStore'
import { Flyout } from './Flyout'
import { spineLayout, type SpineChapter } from './spineLayout'

/** The story's chapters and their scenes in reading order, for the spine. */
export function spineChapters(outline: Outline | null): SpineChapter[] {
  if (!outline) return []
  return outline.chapters.map((c) => ({
    id: c.id,
    title: c.title,
    scenes: outline.scenes
      .filter((s) => s.chapterId === c.id)
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ id: s.id, title: s.title, status: s.status }))
  }))
}

/** A scene's ring, drawn as the mockup's: a track, a half, a fill and a tick, each shown for its status. */
function Ring({ status }: { status: SceneStatus }): React.JSX.Element {
  return (
    <svg className="spine-glyph" width={14} height={14} viewBox="0 0 16 16" aria-hidden data-status={status}>
      <circle className="r-bg" cx={8} cy={8} r={7} />
      <circle className="r-track" cx={8} cy={8} r={6.25} />
      <path className="r-half" d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" />
      <path className="r-three" d="M8 1.75a6.25 6.25 0 1 1 -6.25 6.25H8z" />
      <circle className="r-fill" cx={8} cy={8} r={7} />
      <path className="r-tick" d="M5.1 8.2l1.9 1.9 3.9-4" />
    </svg>
  )
}

function openScene(id: ID): void {
  const { storyId, sceneId, view, navigate, selectScene } = useApp.getState()
  if (id !== sceneId) selectScene(id, storyId ?? undefined)
  else if (view.kind !== 'write') navigate({ kind: 'write' })
  requestEditorFocus(id)
}

export function Spine(): React.JSX.Element {
  const { outline } = useOutline()
  const sceneId = useApp((s) => s.sceneId)
  const story = useApp((s) => s.stories.find((x) => x.id === s.storyId) ?? null)
  const flyoutOpen = useDeskStore((s) => s.flyoutOpen)
  const capsule = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const el = capsule.current
    if (!el) return
    setHeight(el.clientHeight)
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const chapters = useMemo(() => spineChapters(outline), [outline])
  const layout = useMemo(() => spineLayout(chapters, sceneId, height || 600), [chapters, sceneId, height])

  // A spine that scrolls keeps the open scene's ring in view.
  useEffect(() => {
    if (!layout.scrolls) return
    list.current?.querySelector<HTMLElement>('[data-current]')?.scrollIntoView({ block: 'nearest' })
  }, [layout, sceneId])

  return (
    <>
      <div
        data-focus-chrome
        data-desk-spine
        className="absolute bottom-6 left-5 top-5 z-20 w-12"
      >
        <div ref={capsule} className="spine-capsule relative h-full w-12 rounded-[24px]">
          {/* The spine itself: opens the story's flyout. */}
          <button
            type="button"
            className="spine-hit absolute inset-0 rounded-[24px]"
            aria-label="Story contents"
            title="Story contents: every chapter and scene"
            aria-expanded={flyoutOpen}
            onClick={toggleFlyout}
          />
          <div
            ref={list}
            className={cn('pointer-events-none absolute inset-x-0 top-0', layout.scrolls ? 'spine-scroll pointer-events-auto overflow-y-auto' : 'overflow-hidden')}
            style={{ bottom: layout.showTitle ? 264 : 52 }}
          >
            <div className="relative" style={{ height: layout.contentHeight }}>
              {layout.rows.map((r) =>
                r.type === 'chapter' ? (
                  <span
                    key={`c-${r.id}`}
                    aria-hidden
                    className={cn('spine-num absolute inset-x-0 text-center', r.numeral.length > 3 && 'spine-num-long')}
                    style={{ top: r.top }}
                    title={r.title || undefined}
                  >
                    {r.numeral}
                  </span>
                ) : r.type === 'line' ? (
                  <span key={`l-${r.id}`} aria-hidden className="spine-line absolute left-[23.5px] w-px" style={{ top: r.top, height: r.height }} />
                ) : (
                  <button
                    key={r.id}
                    type="button"
                    tabIndex={-1}
                    data-current={r.current || undefined}
                    aria-current={r.current ? 'page' : undefined}
                    aria-label={`${r.title || 'Untitled scene'} (${STATUS_LABELS[r.status]})`}
                    title={r.title || 'Untitled scene'}
                    onClick={() => openScene(r.id)}
                    className={cn('spine-ring pointer-events-auto absolute left-3 grid h-6 w-6 place-items-center rounded-full', r.current && 'is-current')}
                    style={{ top: r.top }}
                  >
                    <span className="spine-halo" aria-hidden />
                    <Ring status={r.status} />
                  </button>
                )
              )}
            </div>
          </div>
          {layout.showTitle && story ? (
            <>
              <svg aria-hidden className="spine-orn absolute left-[19px]" style={{ bottom: 254 }} width={10} height={10} viewBox="0 0 10 10">
                <path d="M5 1.5L8.5 5 5 8.5 1.5 5z" fill="none" stroke="currentColor" strokeWidth={1} />
              </svg>
              <span aria-hidden className="spine-title pointer-events-none absolute inset-x-0 flex justify-center overflow-hidden" style={{ bottom: 64, height: 180 }}>
                <span>{story.title}</span>
              </span>
            </>
          ) : null}
          <button
            type="button"
            aria-label="New scene"
            title="New scene after this one"
            disabled={!story}
            onClick={() => void newSceneAfterOpen()}
            className="spine-add absolute bottom-2 left-2 z-[2] grid h-8 w-8 place-items-center rounded-full"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
      <Flyout />
    </>
  )
}
