// Next scene ideas: on an empty scene card, three possible directions from the outline, open plot threads
// and the story so far; one click fills the card with the one Adam picks. Shown at the top of the scene
// card (features/inspector/SceneCardPanel.tsx). Owned by the Outline part.
//
// A quiet "Ideas for this scene" while the card is empty; asked (or from the palette), the three ideas
// stream in, each a short title, a line on what happens and its beats, with Use this. Stop keeps what
// has arrived; the list stays until one is used or it is closed, even if Adam starts filling the card.
import { Lightbulb, Square, X } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import type { ID, SceneCard } from '@shared/types'
import { IconButton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { ProblemNotice, SuggestionButton, WritingStatus } from '@/features/builder/parts'
import { Skeleton, useDelayed } from '@/features/generate/parts'
import { cardIsEmpty } from './ideasLogic'
import {
  applyIdea,
  askIdeas,
  clearReveal,
  closeIdeas,
  ideasKey,
  registerCard,
  stopIdeas,
  useSceneIdeas,
  type IdeasSession
} from './ideasStore'
import { parseIdeas, type SceneIdea } from './parse'

export function SceneIdeas({
  sceneId,
  card,
  onUse
}: {
  sceneId: ID
  card: SceneCard
  onUse: (patch: Partial<SceneCard>) => void
}): React.JSX.Element | null {
  const worldId = useApp((s) => s.world?.id)
  const session = useSceneIdeas((st) => st.sessions[ideasKey(worldId, sceneId)])
  const reveal = useSceneIdeas((st) => st.reveal)
  const root = useRef<HTMLDivElement>(null)

  // The card on screen, so Undo after "Use this" changes what Adam sees, not only what is saved.
  useEffect(() => registerCard(sceneId, onUse), [sceneId, onUse])

  // Asked from the palette: the ideas come into view at the top of the card.
  useEffect(() => {
    if (reveal !== sceneId) return
    clearReveal()
    requestAnimationFrame(() => root.current?.scrollIntoView({ block: 'nearest' }))
  }, [reveal, sceneId])

  const showing = !!session && !session.hidden
  if (!showing && !cardIsEmpty(card)) return null
  return (
    <div ref={root} className="scroll-mt-4">
      {showing ? (
        <Ideas sceneId={sceneId} s={session} card={card} />
      ) : (
        <button
          type="button"
          onClick={() => void askIdeas(sceneId)}
          title="Three possible directions for this scene, from the outline, open plot threads and the story so far"
          className="-mx-1.5 inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12.5px] font-medium text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Lightbulb size={14} className="shrink-0 text-ai" aria-hidden />
          Ideas for this scene
        </button>
      )}
    </div>
  )
}

function Ideas({ sceneId, s, card }: { sceneId: ID; s: IdeasSession; card: SceneCard }): React.JSX.Element {
  const running = s.status === 'running'
  const ideas = useMemo(() => parseIdeas(s.text, s.status !== 'running'), [s.text, s.status])
  const waiting = useDelayed(running, 200)
  const sceneTitle = useOutlineStore((o) => o.outline?.scenes.find((x) => x.id === sceneId)?.title ?? null)
  // While the answer arrives, three places are kept for the three ideas, so the card below moves as little as it can.
  const slots = running ? 3 : ideas.length
  const nothing = !running && !ideas.length && !s.problem

  const whatTheAISaw = (): void => {
    if (!s.generationId) return
    useApp.getState().navigate({
      kind: 'generation',
      generationId: s.generationId,
      back: { view: { kind: 'write' }, label: sceneTitle ? `Back to “${sceneTitle}”` : 'Back to the scene', what: 'these ideas' }
    })
  }

  return (
    <section aria-label="Ideas for this scene" aria-busy={running} className="flex flex-col gap-2.5">
      <div className="flex h-6 items-center gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
          <Lightbulb size={12} className="shrink-0 text-ai" aria-hidden />
          <span className="truncate">Ideas for this scene</span>
        </h3>
        <div className="flex-1" />
        {running ? (
          <SuggestionButton onClick={() => stopIdeas(sceneId)} title="Stop. The ideas that have arrived stay." className="gap-1.5">
            <Square size={9} fill="currentColor" aria-hidden />
            Stop
          </SuggestionButton>
        ) : (
          <IconButton size="sm" label="Close the ideas" onClick={() => closeIdeas(sceneId)}>
            <X size={14} />
          </IconButton>
        )}
      </div>

      {running ? (
        <WritingStatus
          text={s.retrying ?? (ideas.length ? `Writing idea ${Math.min(ideas.length, 3)} of 3…` : 'Thinking of three directions…')}
          title={s.retrying ?? undefined}
        />
      ) : null}

      {s.problem ? <ProblemNotice message={s.problem.message} code={s.problem.code} onRetry={() => void askIdeas(sceneId)} /> : null}
      {nothing ? (
        <p className="text-[12.5px] leading-relaxed text-muted">
          {s.text.trim() ? 'The AI’s answer didn’t come as ideas for the scene.' : 'Nothing arrived before it stopped.'}{' '}
          <button type="button" onClick={() => void askIdeas(sceneId)} className="font-medium text-accent hover:underline">
            Try again
          </button>
        </p>
      ) : null}

      {Array.from({ length: slots }, (_, i) =>
        ideas[i] ? (
          <IdeaCard key={i} idea={ideas[i]} writing={running && !ideas[i].complete} onUse={() => applyIdea(sceneId, ideas[i], card)} />
        ) : (
          <Skeleton
            key={i}
            className={cn('h-[118px] w-full rounded-lg transition-opacity duration-200', waiting ? 'opacity-100' : 'opacity-0')}
          />
        )
      )}

      {!running && (ideas.length || s.generationId) ? (
        <div className="flex items-center gap-3 text-[12px]">
          {ideas.length ? (
            <button
              type="button"
              onClick={() => void askIdeas(sceneId)}
              className="rounded font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Other ideas
            </button>
          ) : null}
          {s.generationId ? (
            <button
              type="button"
              onClick={whatTheAISaw}
              className="rounded font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              What the AI saw
            </button>
          ) : null}
          {s.cutOff ? <span className="ml-auto text-faint">The answer reached its length limit.</span> : null}
        </div>
      ) : null}
    </section>
  )
}

function IdeaCard({ idea, writing, onUse }: { idea: SceneIdea; writing: boolean; onUse: () => void }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-ai/25 bg-ai-soft px-3 py-2.5" data-idea>
      <p className="break-words font-serif text-[14px] font-semibold leading-snug text-fg">
        {idea.title}
        {writing && !idea.summary && !idea.beats.length ? <Caret /> : null}
      </p>
      {idea.summary ? (
        <p className="mt-1 break-words text-[13px] leading-relaxed text-fg">
          {idea.summary}
          {writing && !idea.beats.length ? <Caret /> : null}
        </p>
      ) : null}
      {idea.beats.length ? (
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-[12.5px] leading-relaxed text-muted marker:text-faint">
          {idea.beats.map((b, i) => (
            <li key={i} className="break-words pl-0.5">
              {b}
              {writing && i === idea.beats.length - 1 ? <Caret /> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {/* Its room is kept while it is written, so nothing moves when the button appears. */}
      <div className={cn('mt-2 flex', writing && 'invisible')} aria-hidden={writing || undefined}>
        <SuggestionButton
          primary
          onClick={onUse}
          aria-label={`Use “${idea.title}” for this scene`}
          title="Fill the scene card with this idea"
        >
          Use this
        </SuggestionButton>
      </div>
    </div>
  )
}

const Caret = (): React.JSX.Element => <span aria-hidden className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-ai" />
