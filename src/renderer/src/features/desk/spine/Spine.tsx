// The desk's story spine (the New look's desk layout), down the left of the writing page, in two shapes that share one
// leather capsule:
// - Full (the default, while the window is wide enough): the capsule opened out to hold the whole story, the real binder
//   (features/binder/Binder.tsx) with everything it does, in the spine's light ink: each chapter with its numeral and
//   word count, each scene with its status and words, the open one marked by a ribbon, the binder's menus, renaming,
//   dragging, folding and keys, a check or an import running, and New scene. A chevron collapses it.
// - Slim (collapsed, or a narrower window): the narrow spine. Each chapter's numeral and a ring for each scene (hollow
//   when planned, half when drafted, three quarters when revised, full with a tick when done), the open scene lit by the
//   lamp; a ring names its scene when the pointer rests on it and opens it when clicked; the spine itself opens the
//   flyout with the whole story; + adds a scene after the open one; the chevron at its head opens it out again.
// The capsule's edge glides between the two (280ms out, 140ms back, on the drawer's curve) while the slim and full
// contents cross-fade, each drawn at its own width so no words are squeezed; the sheet glides across with it. From the
// keyboard and with less motion, at once. Which shape Adam left it in is kept (layout.deskStory).
// spineLayout.ts decides where the slim spine's rings go (a long story's chapters fold to their numerals).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ID, Outline, SceneStatus } from '@shared/types'
import { chapterLabel } from '@shared/numberWords'
import { ChevronLeft, ChevronRight, Plus } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { Binder } from '@/features/binder/Binder'
import { useOutline } from '@/features/binder/outlineStore'
import { STATUS_LABELS } from '@/features/binder/StatusDot'
import { requestEditorFocus } from '@/features/editor/focusRequest'
import { newSceneAfterOpen } from '@/features/palette/actions'
import { useDeskFrame } from '@/layout/desk/deskFit'
import { setSpineFull, toggleFlyout, useDeskStore } from '../deskStore'
import { Flyout } from './Flyout'
import { spineLayout, type SpineChapter } from './spineLayout'
import { useStays } from './useStays'

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

const wordsLabel = (n: number): string => `${n.toLocaleString('en-GB')} ${n === 1 ? 'word' : 'words'}`

/** How long the pointer rests on a ring before its name shows (once one shows, the next shows at once). */
const TIP_DELAY = 120

/** What a ring's tip says: the scene's title, its chapter, and its status and words. */
interface Tip {
  id: ID
  top: number
  title: string
  chapter: string
  detail: string
}

/** The slim spine's head room: the chevron that opens it out sits above the first numeral. */
const HEAD = 40

/** The slim spine: numerals, rings, the story's title down its foot, + and the chevron that opens it out. */
function SlimSpine({ shown, fullRoom }: { shown: boolean; fullRoom: boolean }): React.JSX.Element {
  const { outline } = useOutline()
  const sceneId = useApp((s) => s.sceneId)
  const liveWords = useApp((s) => s.sceneWords)
  const story = useApp((s) => s.stories.find((x) => x.id === s.storyId) ?? null)
  const flyoutOpen = useDeskStore((s) => s.flyoutOpen)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const [tip, setTip] = useState<Tip | null>(null)
  const tipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    setHeight(el.clientHeight)
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const chapters = useMemo(() => spineChapters(outline), [outline])
  const layout = useMemo(() => spineLayout(chapters, sceneId, (height || 600) - HEAD), [chapters, sceneId, height])

  // A spine that scrolls keeps the open scene's ring in view.
  useEffect(() => {
    if (!layout.scrolls) return
    list.current?.querySelector<HTMLElement>('[data-current]')?.scrollIntoView({ block: 'nearest' })
  }, [layout, sceneId])

  useEffect(() => () => clearTimeout(tipTimer.current), [])
  // A tip goes when the spine opens out.
  useEffect(() => {
    if (!shown) setTip(null)
  }, [shown])

  const tipFor = (id: ID, ringTop: number): Tip | null => {
    const meta = outline?.scenes.find((s) => s.id === id)
    if (!meta || !outline) return null
    const index = outline.chapters.findIndex((c) => c.id === meta.chapterId)
    const chapter = index >= 0 ? outline.chapters[index] : null
    const words = id === sceneId ? liveWords : meta.wordCount
    return {
      id,
      top: HEAD + ringTop - (list.current?.scrollTop ?? 0) + 12,
      title: meta.title || 'Untitled scene',
      chapter: chapter ? chapterLabel(index + 1, chapter.title) : '',
      detail: `${STATUS_LABELS[meta.status]} · ${wordsLabel(words)}`
    }
  }
  const restOn = (id: ID, ringTop: number): void => {
    clearTimeout(tipTimer.current)
    const show = (): void => setTip(tipFor(id, ringTop))
    if (tip) show()
    else tipTimer.current = setTimeout(show, TIP_DELAY)
  }
  const leave = (): void => {
    clearTimeout(tipTimer.current)
    setTip(null)
  }

  return (
    <div ref={box} className="spine-slim absolute inset-y-0 left-0 w-12" inert={!shown} aria-hidden={!shown || undefined} data-shown={shown || undefined}>
      {/* The spine itself: opens the story's flyout. */}
      <button
        type="button"
        className="spine-hit absolute inset-0 rounded-[24px]"
        aria-label="Story contents"
        title="Story contents: every chapter and scene"
        aria-expanded={flyoutOpen}
        onClick={toggleFlyout}
      />
      {/* Open it out: the whole story beside the page (in a window too narrow for that, over the page). */}
      <button
        type="button"
        className="spine-open absolute left-2 top-2 z-[2] grid h-8 w-8 place-items-center rounded-full"
        aria-label="Show every chapter and scene"
        title={fullRoom ? 'Open the spine out: every chapter and scene beside the page' : 'Every chapter and scene, over the page'}
        onClick={() => (fullRoom ? setSpineFull(true) : toggleFlyout())}
      >
        <ChevronRight size={15} />
      </button>
      <div
        ref={list}
        className={cn('pointer-events-none absolute inset-x-0', layout.scrolls ? 'spine-scroll pointer-events-auto overflow-y-auto' : 'overflow-hidden')}
        style={{ top: HEAD, bottom: layout.showTitle ? 264 : 52 }}
        onScroll={leave}
      >
        <div className="relative" style={{ height: layout.contentHeight }}>
          {layout.rows.map((r) =>
            r.type === 'chapter' ? (
              <span key={`c-${r.id}`} aria-hidden className={cn('spine-num absolute inset-x-0 text-center', r.numeral.length > 3 && 'spine-num-long')} style={{ top: r.top }}>
                {r.numeral}
              </span>
            ) : r.type === 'line' ? (
              <span key={`l-${r.id}`} aria-hidden className="spine-line absolute left-[23.5px] w-px" style={{ top: r.top, height: r.height }} />
            ) : (
              // The spine's whole width at the ring's height is the ring's, so a click a little off it still opens the
              // scene (rather than the flyout behind it).
              <button
                key={r.id}
                type="button"
                tabIndex={-1}
                data-current={r.current || undefined}
                aria-current={r.current ? 'page' : undefined}
                aria-label={`${r.title || 'Untitled scene'} (${STATUS_LABELS[r.status]})`}
                aria-describedby={tip?.id === r.id ? 'spine-tip' : undefined}
                onClick={() => {
                  leave()
                  openScene(r.id)
                }}
                onPointerEnter={() => restOn(r.id, r.top)}
                onPointerLeave={leave}
                className={cn('spine-ring pointer-events-auto absolute left-0 grid h-6 w-12 place-items-center', r.current && 'is-current')}
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
      {tip ? (
        <div id="spine-tip" role="tooltip" className="spine-tip pointer-events-none absolute left-[58px] z-[5] w-max max-w-[280px]" style={{ top: tip.top }}>
          <span className="block truncate text-[13px] font-semibold leading-[18px] text-fg">{tip.title}</span>
          {tip.chapter ? <span className="block truncate text-[11.5px] leading-4 text-muted">{tip.chapter}</span> : null}
          <span className="block truncate text-[11.5px] leading-4 tabular-nums text-muted">{tip.detail}</span>
        </div>
      ) : null}
    </div>
  )
}

/** The full spine: the story's title and size, the whole binder, and New scene. */
function FullSpine({ shown }: { shown: boolean }): React.JSX.Element {
  const { outline } = useOutline()
  const story = useApp((s) => s.stories.find((x) => x.id === s.storyId) ?? null)
  const sceneId = useApp((s) => s.sceneId)
  const liveWords = useApp((s) => s.sceneWords)
  // The binder lives here only while it shows (and while it fades out), so it is never in two places at once.
  const present = useStays(shown)
  const scenes = outline?.scenes ?? []
  const words = scenes.reduce((n, s) => n + (s.id === sceneId ? liveWords : s.wordCount), 0)
  const sub = outline ? `${scenes.length.toLocaleString('en-GB')} ${scenes.length === 1 ? 'scene' : 'scenes'} · ${wordsLabel(words)}` : ''

  return (
    <aside
      aria-label="Chapters and scenes"
      className="spine-full absolute inset-y-0 left-0 flex w-[320px] flex-col"
      inert={!shown}
      aria-hidden={!shown || undefined}
      data-shown={shown || undefined}
    >
      <div className="flex shrink-0 items-start gap-2 pb-2.5 pl-5 pr-2.5 pt-4">
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="spine-story-title truncate">{story?.title ?? 'No story yet'}</h2>
          {sub ? <p className="mt-0.5 truncate text-[12px] leading-4 tabular-nums text-muted">{sub}</p> : null}
        </div>
        <button
          type="button"
          className="spine-collapse grid h-8 w-8 shrink-0 place-items-center rounded-full"
          aria-label="Collapse to the spine"
          title="Collapse to the slim spine (or Ctrl+K: “Show or hide the binder”)"
          onClick={() => setSpineFull(false)}
        >
          <ChevronLeft size={16} />
        </button>
      </div>
      <i aria-hidden className="spine-rule mx-5 h-px shrink-0" />
      <div className="desk-binder spine-binder mt-1.5 min-h-0 flex-1 px-2">{present ? <Binder world={false} switcher={false} /> : null}</div>
      <div className="flex shrink-0 items-center px-3 pb-3 pt-2.5">
        <button
          type="button"
          className="spine-new flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[11px] text-[13px] font-medium"
          disabled={!story}
          onClick={() => void newSceneAfterOpen()}
        >
          <Plus size={15} />
          New scene
        </button>
      </div>
    </aside>
  )
}

export function Spine(): React.JSX.Element {
  const frame = useDeskFrame()
  const full = frame.full
  // While the open drawer needs the full spine's room, the spine shows slim and can't open out (Adam's choice is kept).
  const room = frame.fullRoom && !frame.spineYields
  const instant = useDeskStore((s) => s.spineInstant)

  return (
    <>
      <div
        data-focus-chrome
        data-desk-spine
        data-shape={full ? 'full' : 'slim'}
        data-instant={instant || undefined}
        className="desk-spine pointer-events-none absolute bottom-6 left-5 top-5 z-20 w-[320px]"
      >
        <div aria-hidden className="spine-capsule absolute inset-0" />
        <FullSpine shown={full} />
        <SlimSpine shown={!full} fullRoom={room} />
      </div>
      <Flyout full={full} fullRoom={room} />
    </>
  )
}
