// The Plan hub's cards over the story line (2026-10-20):
// - NextCard, mid-story: YOU ARE HERE · CH 4, SC 2, "What happens next?", the last scene written in a line (the story
//   index's gist, else its summary: nothing is sent to the AI to show it), a box for Adam's own words, what to plan (only
//   the parts that make sense here), the plot threads waiting (each one ticked goes with the request), and Plan it.
// - StartCard, a new story: "Plan your story", from the idea (written in Your idea, above it in Build with AI: never a
//   second place to say it, so here it is quoted with the way back to it), how the cast and world stand with the way to
//   them, what to plan and how much (In stages or All at once, acts, chapters and scenes; "Let the AI choose" goes by the
//   idea's length).
// - DriftCard: the story has moved on from the plan, in plain words, with Update the plan (the cards written again, shown
//   first, kept or discarded) and Show me.

import { useId } from 'react'
import type { HubDrift, HubThread } from '@shared/contracts/planHub'
import type { OutlineSize } from '@shared/contracts/outline'
import type { StoryBrief } from '@shared/contracts/storyBuilder'
import type { ID } from '@shared/types'
import { ArrowRight, Check, Feather, RotateCcw, Sparkles, Square, Users } from '@/components/ui/icons'
import { Button, Notice } from '@/components/ui'
import { modKey } from '@/lib/api'
import { cn } from '@/lib/cn'
import { HubStatus } from './HubStatus'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { PlanSize } from '@/features/outline/PlanSize'
import type { PlanMode } from '@/features/outline/stages'
import { gistLine, threadChip, type HubMode, type HubScope, type HubScopeId, type Where } from './hubLogic'
import { discardUpdate, keepUpdate, startUpdate, stopUpdate, updatedCards, type PlanUpdate } from './hubStore'

/** The scope chips: "Plan  the next scene · the rest of Ch 4 · …", one pressed. */
function ScopeChips({ scopes, value, onChange, disabled }: { scopes: HubScope[]; value: HubScopeId | null; onChange: (id: HubScopeId) => void; disabled?: boolean }): React.JSX.Element {
  return (
    <div role="group" aria-label="What to plan" className="hub-chips" data-scopes>
      <span className="hub-chips-l" aria-hidden>
        Plan
      </span>
      {scopes.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={s.id === value}
          disabled={disabled}
          className={cn('hub-chip', s.id === value && 'is-on')}
          title={s.title}
          data-scope={s.id}
          onClick={() => onChange(s.id)}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}

/** Plan it, or, while a request arrives, what it is doing and Stop. */
function PlanButton({ running, status, onPlan, onStop, label = 'Plan it' }: { running: boolean; status: string; onPlan: () => void; onStop: () => void; label?: string }): React.JSX.Element {
  return (
    <div className="hub-go">
      {running ? (
        <>
          <HubStatus text={status} size={24} />
          <Button icon={<Square size={10} fill="currentColor" />} onClick={onStop} title="Stop. What has arrived stays, to keep or discard.">
            Stop
          </Button>
        </>
      ) : (
        <>
          <button type="button" className="hub-plan-btn" onClick={onPlan} data-plan-it title={`Or press ${modKey()}+Enter in the box`}>
            <Sparkles size={15} aria-hidden />
            {label}
          </button>
          <span className="hub-go-s">Suggestions appear in the story line below, to keep, change or discard.</span>
        </>
      )}
    </div>
  )
}

export interface NextCardProps {
  /** Mid-story: where the writing has got to, and the last scene's gist. Null: a story planned but not written yet. */
  where: Where | null
  lastGist: string
  /** Under the parts to plan: how much (a story planned but not written, planning more of it). */
  extra?: React.ReactNode
  words: string
  onWords: (w: string) => void
  scopes: HubScope[]
  scope: HubScopeId | null
  onScope: (id: HubScopeId) => void
  threads: HubThread[]
  ticked: ID[]
  onThread: (id: ID) => void
  running: boolean
  status: string
  onPlan: () => void
  onStop: () => void
}

export function NextCard(p: NextCardProps): React.JSX.Element {
  const box = useId()
  const where = p.where
  const last = where ? gistLine(p.lastGist) || (where.title ? `${where.label}, “${where.title}”.` : `${where.label}.`) : ''
  return (
    <section aria-labelledby={`${box}-h`} className="hub-card hub-next" data-next-card>
      <div className="hub-next-head">
        <p className="hub-kicker">{where ? `YOU ARE HERE · ${where.label.toUpperCase()}` : 'PLANNED, NOTHING WRITTEN YET'}</p>
        <h2 id={`${box}-h`} className="hub-h1">
          {where ? 'What happens next?' : 'What do you want to plan?'}
        </h2>
        {where ? (
          <p className="hub-last" data-last-written>
            Last written: {last}
          </p>
        ) : (
          <p className="hub-last">Pick a part to plan here, or carry any chapter on from the story line below: add scenes, plan its scenes, or fill in its empty cards.</p>
        )}
      </div>
      <label htmlFor={box} className="hub-label">
        Tell it in your own words, or leave it to the AI
      </label>
      <AutoTextarea
        id={box}
        value={p.words}
        minRows={3}
        maxRows={10}
        placeholder="For example: they cross at night, and someone on the far bank is waiting for them."
        className="hub-box"
        onChange={(e) => p.onWords(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            if (!p.running) p.onPlan()
          }
        }}
      />
      <ScopeChips scopes={p.scopes} value={p.scope} onChange={p.onScope} disabled={p.running} />
      {p.extra}
      {p.threads.length ? (
        <div role="group" aria-label="Threads waiting" className="hub-chips is-threads" data-threads-waiting>
          <span className="hub-chips-l">Threads waiting:</span>
          {p.threads.map((t) => {
            const on = p.ticked.includes(t.id)
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                className={cn('hub-thread', on && 'is-on')}
                onClick={() => p.onThread(t.id)}
                title={on ? 'It goes with what you ask. Click to leave it out.' : 'Bring this thread back in what is planned'}
                data-thread={t.name}
              >
                {on ? <Check size={11} aria-hidden /> : <span aria-hidden>+</span>} {threadChip(t)}
              </button>
            )
          })}
        </div>
      ) : null}
      <PlanButton running={p.running} status={p.status} onPlan={p.onPlan} onStop={p.onStop} />
    </section>
  )
}

export interface StartCardProps {
  mode: HubMode
  /** The idea, as written in Your idea. */
  idea: string
  /** Goes to Your idea (to write or change it). */
  onIdea: () => void
  brief: StoryBrief | null
  onCastAndWorld: () => void
  scopes: HubScope[]
  scope: HubScopeId | null
  onScope: (id: HubScopeId) => void
  size: OutlineSize
  sizeAuto: boolean
  planMode: PlanMode
  onPlanMode: (m: PlanMode) => void
  onSize: (patch: Partial<OutlineSize>) => void
  hasActs: boolean
  where: string | null
  desk: boolean
  running: boolean
  status: string
  onPlan: () => void
  onStop: () => void
  problem: string | null
}

/** The idea quoted on the card: its first sentences, up to about 220 characters. */
export const ideaQuote = (idea: string): string => {
  const t = idea.replace(/\s+/g, ' ').trim()
  if (t.length <= 220) return t
  const cut = t.slice(0, 220)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 180)).replace(/[\s,;:]+$/, '')}…`
}

/** How the cast and world stand, from the Story builder's brief: "Built", "12 planned, not built yet", "Not planned yet". */
function castWords(brief: StoryBrief | null): { words: string; done: boolean } {
  if (brief?.built) return { words: 'Built, in your codex.', done: true }
  const ticked = (brief?.codex ?? []).filter((c) => c.on).length
  if (brief?.codex) return { words: `${ticked} planned, not built yet.`, done: false }
  return { words: 'Not planned yet. The AI can plan every character and place your idea needs.', done: false }
}

export function StartCard(p: StartCardProps): React.JSX.Element {
  const box = useId()
  const cast = castWords(p.brief)
  const whole = p.scope === 'whole-story'
  const idea = p.idea.trim()
  return (
    <section aria-labelledby={`${box}-h`} className="hub-card hub-next is-start" data-start-card>
      <div className="hub-next-head">
        <p className="hub-kicker">{p.mode === 'start' ? 'A NEW STORY' : 'PLANNED, NOTHING WRITTEN YET'}</p>
        <h2 id={`${box}-h`} className="hub-h1">
          Plan your story
        </h2>
      </div>
      <div className="hub-cast" data-idea-status>
        <Feather size={14} aria-hidden className={idea ? 'text-success' : 'text-muted'} />
        <span className="min-w-0 flex-1">
          <span className="font-medium text-fg">From your idea: </span>
          {idea ? <span className="hub-idea-q">“{ideaQuote(idea)}”</span> : 'not written yet. A line or two on what the story is about is enough.'}
        </span>
        <button type="button" className="hub-link" onClick={p.onIdea}>
          {idea ? 'Change it' : 'Write your idea'}
          <ArrowRight size={12} aria-hidden />
        </button>
      </div>
      <div className="hub-cast" data-cast-status>
        <Users size={14} aria-hidden className={cast.done ? 'text-success' : 'text-muted'} />
        <span className="min-w-0 flex-1">
          <span className="font-medium text-fg">Cast and world: </span>
          {cast.words}
        </span>
        <button type="button" className="hub-link" onClick={p.onCastAndWorld}>
          {cast.done ? 'See them' : 'Plan the cast and world'}
          <ArrowRight size={12} aria-hidden />
        </button>
      </div>
      <ScopeChips scopes={p.scopes} value={p.scope} onChange={p.onScope} disabled={p.running} />
      {whole || p.scope === 'first-act' ? (
        <SizeChoice
          size={p.size}
          sizeAuto={p.sizeAuto}
          planMode={p.planMode}
          onPlanMode={p.onPlanMode}
          onSize={p.onSize}
          hasActs={p.hasActs}
          where={p.where}
          brief={p.brief}
        />
      ) : null}
      {p.problem ? <Notice>{p.problem}</Notice> : null}
      <PlanButton running={p.running} status={p.status} onPlan={p.onPlan} onStop={p.onStop} />
    </section>
  )
}

export function DriftCard({
  storyId,
  drift,
  update,
  onShow
}: {
  storyId: ID
  drift: HubDrift[]
  update: PlanUpdate | null
  onShow: () => void
}): React.JSX.Element {
  const head = useId()
  const shown = drift.slice(0, 2)
  const more = drift.length - shown.length
  const cards = update ? updatedCards(update) : []
  return (
    <section aria-labelledby={head} className="hub-card hub-drift" data-drift-card>
      <div className="hub-drift-row">
        <div className="min-w-0 flex-1">
          <h3 id={head} className="hub-h3">
            The story has moved on from the plan
          </h3>
          <div className="hub-drift-text">
            {shown.map((d) => (
              <p key={d.sceneId}>
                <span className="font-medium text-fg">
                  {d.label}
                  {d.title ? ` “${d.title}”` : ''}:
                </span>{' '}
                {d.text}
              </p>
            ))}
            {more > 0 ? <p className="text-faint">And {more === 1 ? 'one more planned scene' : `${more} more planned scenes`}.</p> : null}
          </div>
        </div>
        {!update ? (
          <div className="hub-drift-actions">
            <Button variant="primary" size="sm" onClick={() => void startUpdate(storyId, drift)} title="The AI writes these scene cards again so they fit. You see them first.">
              Update the plan
            </Button>
            <Button variant="ghost" size="sm" onClick={onShow} title="Show these scenes in the story line">
              Show me
            </Button>
          </div>
        ) : null}
      </div>
      {update ? (
        <div className="hub-update" data-plan-update>
          {update.status === 'running' && !cards.length ? (
            <div className="hub-go">
              <HubStatus text="Updating the plan…" size={22} />
              <Button size="sm" icon={<Square size={10} fill="currentColor" />} onClick={() => stopUpdate(storyId)}>
                Stop
              </Button>
            </div>
          ) : null}
          {update.status === 'error' ? (
            <Notice
              tone="danger"
              action={
                <span className="flex gap-1.5">
                  <Button size="sm" icon={<RotateCcw size={12} />} onClick={() => void startUpdate(storyId, drift)}>
                    Try again
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => discardUpdate(storyId)}>
                    Close
                  </Button>
                </span>
              }
            >
              {update.error}
            </Notice>
          ) : null}
          {cards.length ? (
            <>
              <p className="hub-update-t">The cards, before you keep them:</p>
              <ol className="hub-update-list">
                {update.sceneIds.map((id, i) => {
                  const was = update.before.find((b) => b.sceneId === id)
                  const now = cards[i]
                  if (!now) return null
                  return (
                    <li key={id} className="hub-update-item" data-update-scene={id}>
                      <p className="hub-sug-head">
                        <span className="hub-sug-label">{was?.label ?? ''}</span>
                        <strong className="hub-sug-title">{now.title || was?.title}</strong>
                        {now.when ? <span className="hub-sug-when">{now.when}</span> : null}
                      </p>
                      {was?.goal && was.goal !== now.summary ? <p className="hub-update-was">{was.goal}</p> : null}
                      {now.summary ? <p className="hub-sug-text">{now.summary}</p> : null}
                    </li>
                  )
                })}
              </ol>
              {update.status !== 'running' ? (
                <div className="hub-drift-actions mt-2">
                  <Button variant="primary" size="sm" icon={<Check size={13} />} onClick={() => void keepUpdate(storyId)} data-keep-update>
                    Keep these changes
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => discardUpdate(storyId)}>
                    Discard
                  </Button>
                </div>
              ) : (
                <HubStatus text="Updating the plan…" size={22} />
              )}
            </>
          ) : update.status === 'complete' || update.status === 'stopped' ? (
            <Notice
              action={
                <Button size="sm" variant="ghost" onClick={() => discardUpdate(storyId)}>
                  Close
                </Button>
              }
            >
              {update.status === 'stopped' ? 'Stopped before anything arrived. Nothing changed.' : 'The AI’s answer didn’t come as scene cards, so nothing changed. Please try again.'}
            </Notice>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/** How to plan and how much, with where its size came from: a new story's whole plan, or more of a planned one. */
export function SizeChoice(p: {
  size: OutlineSize
  sizeAuto: boolean
  planMode: PlanMode
  onPlanMode: (m: PlanMode) => void
  onSize: (patch: Partial<OutlineSize>) => void
  hasActs: boolean
  where: string | null
  brief: StoryBrief | null
}): React.JSX.Element {
  return (
    <div className="hub-size" data-size>
      <PlanSize mode={p.planMode} onMode={p.onPlanMode} size={p.size} onSize={p.onSize} hasActs={p.hasActs} where={p.where} desk={false} />
      {p.sizeAuto ? (
        <p className="hub-size-auto">
          {p.brief?.length ? 'Sized from the length in your idea. Change any of it here.' : 'Sized for a story with no length chosen yet. Set the length in your idea, or change it here.'}
        </p>
      ) : null}
    </div>
  )
}
