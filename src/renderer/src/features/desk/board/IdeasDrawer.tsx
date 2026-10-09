// The story board's ideas drawer (UI overhaul, D5.3): "What could come next", over the board's right edge. It is today's
// next scene ideas (features/outline/ideasStore.ts) for one planned scene: the board's amber button makes a planned
// scene at the end of the story when there is no empty one there (it stays, as an empty card, if no idea is used, as a
// scene added in the binder does), and a planned card's own Ideas asks for that one. The three ideas come in as index
// cards, each naming who is in it; Use this fills the scene's card (and names a plain-titled scene after the idea), the
// card flies from the drawer to its place on the board and wears "AI idea" until it has words; Undo in the toast
// empties it again. Dismiss puts one idea away; Three more ideas asks again. Slides in 240ms, out 140ms; at once from
// the keyboard or with less motion.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { CodexCard } from '@shared/contracts/entryViews'
import type { ID, Outline } from '@shared/types'
import { BookOpenText, Plus, Sparkles, X } from '@/components/ui/icons'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { buildNameIndex, entriesNamedIn } from '@/features/editor/names/nameMatch'
import { keyboardDriven, reducedMotion } from '@/features/look/motion'
import { applyIdea, askIdeas, ideasKey, setWish, stopIdeas, useSceneIdeas } from '@/features/outline/ideasStore'
import { parseIdeas, type SceneIdea } from '@/features/outline/parse'
import { Portrait } from '@/features/views/Portrait'
import { FreshText } from '@/features/planning/FreshText'
import { LampStatus, WaitingCards } from '@/features/planning/LampThinking'
import { useDealDelay } from '@/features/planning/deal'
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
    if (sceneId) panel.current?.focus({ preventScroll: true })
  }, [sceneId])

  if (!sceneId) return null
  const running = session?.status === 'running'
  const ideas = session ? parseIdeas(session.text, !running) : []
  const shown = ideas.map((idea, i) => ({ idea, i })).filter((x) => !gone.has(x.i))

  function close(): void {
    if (keyboardDriven() || reducedMotion()) {
      useBoardStore.setState({ ideasFor: null })
      return
    }
    setClosing(true)
    setTimeout(() => {
      setClosing(false)
      useBoardStore.setState({ ideasFor: null })
    }, 140)
  }
  const dismiss = (i: number): void => {
    if (reducedMotion() || keyboardDriven()) return setGone(new Set([...gone, i]))
    setLeaving(i)
    setTimeout(() => {
      setLeaving(null)
      setGone((g) => new Set([...g, i]))
    }, 160)
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
        {shown.map(({ idea, i }, n) => (
          <IdeaCard
            key={`${session?.taskId}-${i}`}
            idea={idea}
            n={i}
            delay={120 + n * 60}
            leaving={leaving === i}
            cast={entriesNamedIn(`${idea.title} ${idea.summary} ${idea.beats.join(' ')}`, index)
              .map((id) => people.find((p) => p.id === id))
              .filter((p): p is CodexCard => !!p && p.kind === 'character')
              .slice(0, 3)}
            live={!!running}
            onUse={(el) => void use(idea, el)}
            onDismiss={() => dismiss(i)}
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
      <div className="board-dr-foot">
        <button type="button" className="board-btn-sec" disabled={running} onClick={() => void askIdeas(sceneId)}>
          <Sparkles size={14} className="text-[var(--lamp)]" />
          <span>Three more ideas</span>
        </button>
        {running ? (
          <button type="button" className="board-dr-stop" onClick={() => stopIdeas(sceneId)}>
            Stop
          </button>
        ) : (
          <span className="board-dr-saw">
            <BookOpenText size={14} />
            Only the idea you use goes on the card.
          </span>
        )}
      </div>
    </aside>
  )
}

function IdeaCard({
  idea,
  n,
  delay,
  leaving,
  cast,
  live,
  onUse,
  onDismiss
}: {
  idea: SceneIdea
  n: number
  delay: number
  leaving: boolean
  cast: CodexCard[]
  /** The answer is still arriving: its words fade in. */
  live: boolean
  onUse: (el: HTMLElement | null) => void
  onDismiss: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLElement>(null)
  // Ideas that show together are dealt in one after another; one arriving while the AI writes lands at once.
  const deal = useDealDelay()
  const title = idea.title.trim() || `Idea ${n + 1}`
  return (
    <article ref={ref} className={cn('board-idea', leaving && 'is-leaving', !idea.complete && 'is-arriving')} style={{ '--d': live ? (deal as Record<string, string>)['--deal'] : `${delay}ms` } as CSSProperties} data-idea>
      <span className="board-c-rules" aria-hidden />
      <span className="board-c-margin" aria-hidden />
      <span className="board-i-kind">Idea {['one', 'two', 'three', 'four', 'five'][n] ?? n + 1}</span>
      <h3 className="board-i-title">
        <FreshText text={title} live={live} />
      </h3>
      <p className="board-i-hook">
        <FreshText text={idea.summary} live={live} />
      </p>
      {idea.beats.length ? (
        <p className="board-i-beats">
          {idea.beats.length} {idea.beats.length === 1 ? 'beat' : 'beats'}: {idea.beats[0]}
          {idea.beats.length > 1 ? '…' : ''}
        </p>
      ) : null}
      <div className="board-i-actions">
        <button type="button" className="board-btn-ai is-sm" disabled={!idea.complete} onClick={() => onUse(ref.current)} aria-label={`Use “${title}”`}>
          <Plus size={13} />
          <span>Use this</span>
        </button>
        <button type="button" className="board-txt-btn" onClick={onDismiss} aria-label={`Dismiss “${title}”`}>
          Dismiss
        </button>
        <span className="board-i-cast">
          {cast.map((p) => (
            <span key={p.id} title={p.name}>
              <Portrait entry={p} size={20} />
            </span>
          ))}
        </span>
      </div>
    </article>
  )
}
