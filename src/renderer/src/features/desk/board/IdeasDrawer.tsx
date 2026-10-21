// The story board's ideas drawer (UI overhaul, D5.3): "What could come next", over the board's right edge. It is today's
// next scene ideas (features/outline/ideasStore.ts) for one planned scene: the board's amber button makes a planned
// scene at the end of the story when there is no empty one there (it stays, as an empty card, if no idea is used, as a
// scene added in the binder does), and a planned card's own Ideas asks for that one. The three ideas come in as index
// cards, each naming who is in it; Use this fills the scene's card (and names a plain-titled scene after the idea), the
// card flies from the drawer to its place on the board and wears "AI idea" until it has words; Undo in the toast
// empties it again. Dismiss puts one idea away; Three more ideas asks again, Stop while they come (the shared card and
// foot, outline/IdeaCard.tsx). Slides in 240ms, out 140ms; at once from
// the keyboard or with less motion.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CodexCard } from '@shared/contracts/entryViews'
import type { ID, Outline } from '@shared/types'
import { BookOpenText, Sparkles, X } from '@/components/ui/icons'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { buildNameIndex, entriesNamedIn } from '@/features/editor/names/nameMatch'
import { keyboardDriven, reducedMotion, tokenMs } from '@/features/look/motion'
import { applyIdea, askIdeas, ideasKey, setWish, stopIdeas, useSceneIdeas } from '@/features/outline/ideasStore'
import { parseIdeas, type SceneIdea } from '@/features/outline/parse'
import { IdeaCard, IdeasFooter } from '@/features/outline/IdeaCard'
import { Portrait } from '@/features/views/Portrait'
import { LampStatus, WaitingCards } from '@/features/planning/LampThinking'
import { readingOrder, sceneWhere } from '@/features/desk/home/homeLogic'
import { addSceneTo } from './boardActions'
import { bumpMarks, useBoardStore } from './boardStore'

/** The planned scene the drawer is for: the story's last scene when it is planned with nothing on it, else none (one is made). */
export function lastEmptyScene(outline: Outline, empty: (id: ID) => boolean): ID | null {
  const last = readingOrder(outline).at(-1)
  return last && last.status === 'planned' && last.wordCount === 0 && empty(last.id) ? last.id : null
}

/** Opens the drawer for a scene (the board's own button finds or makes one). */
export const openIdeasFor = (sceneId: ID): void => {
  useBoardStore.setState({ ideasFor: sceneId, ideasInstant: keyboardDriven() })
  void askIfNeeded(sceneId)
}

async function askIfNeeded(sceneId: ID): Promise<void> {
  // "Plan its pay-off" (the plot threads board): what to aim the ideas at, asked for afresh.
  const wish = useBoardStore.getState().ideasWish
  if (wish) {
    useBoardStore.setState({ ideasWish: null })
    setWish(sceneId, wish)
    return void (await askIdeas(sceneId))
  }
  const key = ideasKey(useApp.getState().world?.id, sceneId)
  const s = useSceneIdeas.getState().sessions[key]
  if (!s || s.hidden || s.status === 'error') await askIdeas(sceneId)
}

/** The board's amber button: the drawer for the empty planned scene at the story's end, made first if need be. */
export async function ideasForWhatComesNext(outline: Outline, empty: (id: ID) => boolean): Promise<void> {
  const ready = lastEmptyScene(outline, empty)
  if (ready) return openIdeasFor(ready)
  const chapter = outline.chapters.at(-1)
  if (!chapter) return
  const made = await addSceneTo(chapter.id)
  if (made) openIdeasFor(made)
}

export function IdeasDrawer({ outline, people }: { outline: Outline; people: CodexCard[] }): React.JSX.Element | null {
  const sceneId = useBoardStore((s) => s.ideasFor)
  const instant = useBoardStore((s) => s.ideasInstant)
  const worldId = useApp((s) => s.world?.id ?? null)
  const [closing, setClosing] = useState(false)
  const [gone, setGone] = useState<Set<number>>(new Set())
  const [leaving, setLeaving] = useState<number | null>(null)
  const session = useSceneIdeas((s) => (sceneId ? s.sessions[ideasKey(worldId, sceneId)] : undefined))
  const index = useMemo(() => buildNameIndex(people), [people])
  const panel = useRef<HTMLElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const scene = sceneId ? outline.scenes.find((s) => s.id === sceneId) : undefined

  // A new ask brings every idea back.
  useEffect(() => setGone(new Set()), [session?.taskId])
  // Esc closes it.
  useEffect(() => {
    if (!sceneId) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId])
  useEffect(() => {
    if (!sceneId) return
    // Opened again while closing: it stays open.
    clearTimeout(closeTimer.current)
    setClosing(false)
    panel.current?.focus({ preventScroll: true })
  }, [sceneId])
  useEffect(() => () => clearTimeout(closeTimer.current), [])

  if (!sceneId) return null
  const running = session?.status === 'running'
  const ideas = session ? parseIdeas(session.text, !running) : []
  const shown = ideas.map((idea, i) => ({ idea, i })).filter((x) => !gone.has(x.i))

  function close(): void {
    clearTimeout(closeTimer.current)
    const exit = panel.current && !keyboardDriven() && !reducedMotion() ? tokenMs(panel.current, '--dur-exit') : 0
    if (!exit) {
      setClosing(false)
      useBoardStore.setState({ ideasFor: null })
      return
    }
    setClosing(true)
    closeTimer.current = setTimeout(() => {
      setClosing(false)
      useBoardStore.setState({ ideasFor: null })
    }, exit)
  }
  const dismiss = (i: number): void => {
    const exit = panel.current && !reducedMotion() && !keyboardDriven() ? tokenMs(panel.current, '--dur-exit') : 0
    if (!exit) return setGone(new Set([...gone, i]))
    setLeaving(i)
    setTimeout(() => {
      setLeaving(null)
      setGone((g) => new Set([...g, i]))
    }, exit)
  }
  const use = async (idea: SceneIdea, el: HTMLElement | null): Promise<void> => {
    if (!sceneId) return
    const from = el?.getBoundingClientRect() ?? null
    try {
      const { card } = await api.getScene(sceneId)
      const id = sceneId
      applyIdea(id, idea, card, {
        onUndo: () => void api.markAiIdea(id, false).then(bumpMarks)
      })
      await api.markAiIdea(id, true)
      bumpMarks()
      useBoardStore.setState({ ideasFor: null, flyFrom: from && !keyboardDriven() && !reducedMotion() ? { sceneId: id, rect: from } : null })
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    }
  }

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      className={cn('board-drawer', closing && 'is-closing', instant && 'is-instant')}
      aria-label="What could come next"
      data-ideas-drawer
    >
      <span className="board-dr-glow" aria-hidden />
      <div className="board-dr-eyebrow">
        <Sparkles size={14} />
        <span>From the memory and the open threads</span>
      </div>
      <h2 className="board-dr-title">What could come next</h2>
      <button type="button" className="board-dr-close" aria-label="Close ideas" onClick={close}>
        <X size={16} />
      </button>
      <p className="board-dr-sub">
        For <em>{scene?.title.trim() || 'the next scene'}</em>
        {scene ? `, ${sceneWhere(outline, scene.id)}` : ''}. Using one fills its card; Undo empties it again.
      </p>
      <div className="board-dr-ideas" aria-busy={running || undefined}>
        {shown.map(({ idea, i }) => (
          <IdeaCard
            key={`${session?.taskId}-${i}`}
            idea={idea}
            n={i}
            leaving={leaving === i}
            live={!!running}
            onUse={(el) => void use(idea, el)}
            onDismiss={() => dismiss(i)}
            extra={entriesNamedIn(`${idea.title} ${idea.summary} ${idea.beats.join(' ')}`, index)
              .map((id) => people.find((p) => p.id === id))
              .filter((p): p is CodexCard => !!p && p.kind === 'character')
              .slice(0, 3)
              .map((p) => (
                <span key={p.id} title={p.name}>
                  <Portrait entry={p} size={20} />
                </span>
              ))}
          />
        ))}
        {running ? (
          <div className="board-dr-wait">
            <LampStatus
              size={24}
              text={
                session?.retrying ??
                (ideas.length ? `Writing idea ${Math.min(ideas.length, 3)} of 3…` : 'Reading the scenes before it, your plan and the open threads…')
              }
            />
          </div>
        ) : null}
        {running && ideas.length < 3 ? <WaitingCards count={3 - ideas.length} className="board-dr-waiting" /> : null}
        {!running && session?.problem && !ideas.length ? (
          <p className="board-dr-problem" role="alert">
            {session.problem.message}
          </p>
        ) : null}
        {!running && ideas.length > 0 && !shown.length ? (
          <div className="board-dr-empty">
            <span className="board-dr-empty-t">That’s every idea for now</span>
            <span className="board-dr-empty-s">Ask for three more, or plan the scene yourself.</span>
          </div>
        ) : null}
      </div>
      <IdeasFooter className="board-dr-foot" running={!!running} hasIdeas onMore={() => void askIdeas(sceneId)} onStop={() => stopIdeas(sceneId)}>
        {running ? null : (
          <span className="board-dr-saw">
            <BookOpenText size={14} />
            Only the idea you use goes on the card.
          </span>
        )}
      </IdeasFooter>
    </aside>
  )
}
