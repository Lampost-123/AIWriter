// Next scene ideas: on an empty scene card, three possible directions from the outline, open plot threads
// and the story so far; one click fills the card with the one Adam picks. Shown at the top of the scene
// card (features/inspector/SceneCardPanel.tsx). Owned by the Outline part.
//
// A quiet "Ideas for this scene" while the card is empty. Clicked, it asks what Adam has in mind, roughly, in his own
// words (optional: the three ideas are then three takes on it); asked (or from the palette), the three ideas stream
// in, each a short title, a line on what happens and its beats, with Use this (the shared card, IdeaCard.tsx). What he
// has in mind stays above them, and Three more ideas asks again with it as it stands. Stop keeps what has arrived; the list stays until one is used or
// it is closed, even if Adam starts filling the card.
import { Lightbulb, X } from '@/components/ui/icons'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ID, SceneCard } from '@shared/types'
import { Button, IconButton, Notice, Textarea } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { settingsAction, WritingStatus } from '@/features/builder/parts'
import { Skeleton, useDelayed } from '@/features/generate/parts'
import { useDesk } from '@/features/look/look'
import { LampStatus } from '@/features/planning/LampThinking'
import { flyCard, mayFly } from '@/features/planning/fly'
import { cardIsEmpty } from './ideasLogic'
import {
  applyIdea,
  askIdeas,
  clearReveal,
  closeIdeas,
  ideasKey,
  registerCard,
  setWish,
  stopIdeas,
  useSceneIdeas,
  type IdeasProblem,
  type IdeasSession
} from './ideasStore'
import { parseIdeas, type SceneIdea } from './parse'
import { IdeaCard, IdeasFooter } from './IdeaCard'

export function SceneIdeas({
  sceneId,
  card,
  onUse,
  lead,
  beside
}: {
  sceneId: ID
  card: SceneCard
  onUse: (patch: Partial<SceneCard>) => void
  /** Shown first in the row, before the quiet button (Plan this scene), so it keeps its place whatever the ideas show. */
  lead?: ReactNode
  /** Shown in the same row as the quiet button (the scene's "Interview me"), or above the ideas. */
  beside?: ReactNode
}): React.JSX.Element | null {
  const worldId = useApp((s) => s.world?.id)
  const session = useSceneIdeas((st) => st.sessions[ideasKey(worldId, sceneId)])
  const reveal = useSceneIdeas((st) => st.reveal)
  const root = useRef<HTMLDivElement>(null)
  // Clicked "Ideas for this scene": the box for what Adam has in mind shows before anything is asked.
  const [composing, setComposing] = useState(false)

  // The card on screen, so Undo after "Use this" changes what Adam sees, not only what is saved.
  useEffect(() => registerCard(sceneId, onUse), [sceneId, onUse])

  // The top of the ideas comes into view: asked from the palette, or when other ideas are asked for at
  // the foot of the list.
  const showTop = useCallback(() => {
    requestAnimationFrame(() => root.current?.scrollIntoView({ block: 'start' }))
  }, [])
  useEffect(() => {
    if (reveal !== sceneId) return
    clearReveal()
    showTop()
  }, [reveal, sceneId, showTop])

  // Whether the quiet button is offered is settled when the card opens (the form is made again for each
  // scene) and when the ideas are closed or used, not as Adam types: it doesn't vanish under him, moving
  // the field he is typing in, at his first word.
  const phase = !session ? 'none' : session.hidden ? 'used' : 'showing'
  const [offer, setOffer] = useState(() => ({ phase, show: cardIsEmpty(card) }))
  let show = offer.show
  if (offer.phase !== phase) {
    show = phase !== 'used' && cardIsEmpty(card)
    setOffer({ phase, show })
  }

  // The row of quiet actions: what leads it, then the others. Its order never changes as the ideas open and close.
  const row = (className: string): React.JSX.Element | null =>
    lead || beside ? (
      <div className={className}>
        {lead}
        {beside}
      </div>
    ) : null
  if (phase !== 'showing' && !show) return row('flex flex-wrap items-center gap-x-4 gap-y-1')
  const others = row('mb-2 flex flex-wrap items-center gap-x-4 gap-y-1')
  const ask = (): void => {
    setComposing(false)
    void askIdeas(sceneId)
    showTop()
  }
  return (
    <div ref={root} className="scroll-mt-4">
      {session && phase === 'showing' ? (
        <>
          {others}
          <Ideas sceneId={sceneId} s={session} card={card} onAsk={ask} />
        </>
      ) : composing ? (
        <>
          {others}
          <section aria-label="Ideas for this scene" className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
              <Lightbulb size={12} className="shrink-0 text-ai" aria-hidden />
              Ideas for this scene
            </h3>
            <Wish sceneId={sceneId} onAsk={ask} autoFocus />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="primary" onClick={ask}>
                Suggest ideas
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setComposing(false)}>
                Cancel
              </Button>
            </div>
          </section>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {lead}
          <button
            type="button"
            onClick={() => setComposing(true)}
            title="Three possible directions for this scene, from the outline, open plot threads and the story so far"
            className="-mx-1.5 inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 text-[12.5px] font-medium text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Lightbulb size={14} className="shrink-0 text-ai" aria-hidden />
            Ideas for this scene
          </button>
          {beside}
        </div>
      )}
    </div>
  )
}

function Ideas({ sceneId, s, card, onAsk }: { sceneId: ID; s: IdeasSession; card: SceneCard; onAsk: () => void }): React.JSX.Element {
  const running = s.status === 'running'
  const ideas = useMemo(() => parseIdeas(s.text, s.status !== 'running'), [s.text, s.status])
  const waiting = useDelayed(running, 200)
  const sceneTitle = useOutlineStore((o) => o.outline?.scenes.find((x) => x.id === sceneId)?.title ?? null)
  // While the answer arrives, three places are kept for the three ideas, so the card below moves as little as it can.
  const slots = running ? 3 : ideas.length
  const nothing = !running && !ideas.length && !s.problem
  // On a card Adam has started, Use this adds to what he wrote rather than replacing it.
  const adds = !!card.goal.trim() || card.beats.some((b) => b.trim())
  const desk = useDesk()
  const list = useRef<HTMLElement>(null)
  // The desk: a copy of the idea used flies down into the card's What happens, which it fills.
  const use = (idea: SceneIdea, el: HTMLElement | null): void => {
    const from = el?.getBoundingClientRect() ?? null
    const ghost = el && from && mayFly() ? (el.cloneNode(true) as HTMLElement) : null
    const panel = list.current?.parentElement?.parentElement ?? null
    applyIdea(sceneId, idea, card)
    if (!ghost || !from || !panel) return
    requestAnimationFrame(() => {
      const target = [...panel.querySelectorAll<HTMLElement>('section h3')].find((h) => h.textContent?.trim() === 'What happens')?.closest('section')
      const to = target?.getBoundingClientRect()
      if (to) void flyCard(ghost, from, new DOMRect(to.left, to.top, to.width, Math.min(to.height, 120)))
    })
  }

  // A problem, or a word on why nothing new came, is brought into view if Adam has scrolled away from it.
  const said = useRef<HTMLDivElement>(null)
  const saying = s.problem?.message ?? s.note ?? (nothing ? s.text : null)
  useEffect(() => {
    if (saying !== null) requestAnimationFrame(() => said.current?.scrollIntoView({ block: 'nearest' }))
  }, [saying])

  const whatTheAISaw = (): void => {
    if (!s.generationId) return
    useApp.getState().navigate({
      kind: 'generation',
      generationId: s.generationId,
      back: { view: { kind: 'write' }, label: sceneTitle ? `Back to “${sceneTitle}”` : 'Back to the scene', what: 'these ideas' }
    })
  }

  return (
    <section ref={list} aria-label="Ideas for this scene" aria-busy={running} className="flex flex-col gap-2.5">
      <div className="flex h-6 items-center gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
          <Lightbulb size={12} className="shrink-0 text-ai" aria-hidden />
          <span className="truncate">Ideas for this scene</span>
        </h3>
        <div className="flex-1" />
        {running ? null : (
          <IconButton size="sm" label="Close the ideas" onClick={() => closeIdeas(sceneId)}>
            <X size={14} />
          </IconButton>
        )}
      </div>

      {running ? <WishLine sceneId={sceneId} /> : <Wish sceneId={sceneId} onAsk={onAsk} />}

      {running ? (
        desk ? (
          <LampStatus
            text={s.retrying ?? (ideas.length ? `Writing idea ${Math.min(ideas.length, 3)} of 3…` : 'Thinking of three directions…')}
            title={s.retrying ?? undefined}
            size={24}
          />
        ) : (
          <WritingStatus
            text={s.retrying ?? (ideas.length ? `Writing idea ${Math.min(ideas.length, 3)} of 3…` : 'Thinking of three directions…')}
            title={s.retrying ?? undefined}
          />
        )
      ) : null}

      {saying !== null ? (
        <div ref={said} className="scroll-mt-4">
          {s.problem ? (
            <Problem problem={s.problem} onRetry={onAsk} />
          ) : s.note ? (
            <p className="text-[12.5px] leading-relaxed text-muted">{s.note}</p>
          ) : (
            <p className="text-[12.5px] leading-relaxed text-muted">
              {s.text.trim() ? 'The AI’s answer didn’t come as ideas for the scene.' : 'Nothing arrived before it stopped.'}{' '}
              <button type="button" onClick={onAsk} className="font-medium text-accent hover:underline">
                Try again
              </button>
            </p>
          )}
        </div>
      ) : null}

      {Array.from({ length: slots }, (_, i) =>
        ideas[i] ? (
          <IdeaCard
            key={i}
            idea={ideas[i]}
            n={i}
            live={running}
            beats="list"
            useTitle={adds ? 'Add this idea to the scene card, after what is already on it' : 'Fill the scene card with this idea'}
            onUse={(el) => use(ideas[i], el)}
          />
        ) : desk ? (
          <span key={i} aria-hidden className={cn('plan-waiting-card plan-idea-wait transition-opacity duration-200', waiting ? 'opacity-100' : 'opacity-0')}>
            <i />
            <i />
            <i />
          </span>
        ) : (
          <Skeleton
            key={i}
            className={cn('h-[118px] w-full rounded-lg transition-opacity duration-200', waiting ? 'opacity-100' : 'opacity-0')}
          />
        )
      )}

      {running || ideas.length || s.generationId ? (
        <IdeasFooter running={running} hasIdeas={ideas.length > 0} onMore={onAsk} onStop={() => stopIdeas(sceneId)} className="text-[12px]">
          {!running && s.generationId ? (
            <button
              type="button"
              onClick={whatTheAISaw}
              className="rounded font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              What the AI saw
            </button>
          ) : null}
          {!running && s.cutOff ? <span className="ml-auto text-faint">The answer reached its length limit.</span> : null}
        </IdeasFooter>
      ) : null}
    </section>
  )
}

/** What went wrong and its next step. The card is narrow, so the buttons go under the words, not beside them. */
function Problem({ problem, onRetry }: { problem: IdeasProblem; onRetry: () => void }): React.JSX.Element {
  const settings = settingsAction(problem.message, problem.code)
  return (
    <div role="alert">
      <Notice tone="danger">
        {problem.message}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {settings ? (
            <Button size="sm" onClick={settings.run}>
              {settings.label}
            </Button>
          ) : null}
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </Notice>
    </div>
  )
}

/** The box for what Adam has in mind for the scene, roughly; Ctrl+Enter asks for ideas with it. */
function Wish({ sceneId, onAsk, autoFocus }: { sceneId: ID; onAsk: () => void; autoFocus?: boolean }): React.JSX.Element {
  const worldId = useApp((s) => s.world?.id)
  const wish = useSceneIdeas((st) => st.wishes[ideasKey(worldId, sceneId)] ?? '')
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-muted">What do you have in mind? (optional)</span>
      <Textarea
        value={wish}
        autoFocus={autoFocus}
        minRows={2}
        maxRows={8}
        placeholder="Roughly what you want to happen, in your own words. The ideas will be three takes on it."
        onChange={(e) => setWish(sceneId, e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            onAsk()
          }
        }}
        className="text-[13px]"
      />
    </label>
  )
}

/** While the ideas are written: what they were asked to follow, if anything. */
function WishLine({ sceneId }: { sceneId: ID }): React.JSX.Element | null {
  const worldId = useApp((s) => s.world?.id)
  const wish = useSceneIdeas((st) => st.wishes[ideasKey(worldId, sceneId)]?.trim() ?? '')
  if (!wish) return null
  return <p className="line-clamp-3 break-words text-[12.5px] italic leading-relaxed text-muted">Going by: {wish}</p>
}

