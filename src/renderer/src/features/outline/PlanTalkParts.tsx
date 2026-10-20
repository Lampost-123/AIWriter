// The outline's talk and redo on screen (planTalk.ts): the talk panel beside the suggestions, the preview of a revised
// plan (what is new or changed marked), and, under a suggestion, doing it again with a note, then Use this or Keep mine.

import { useMemo, useState } from 'react'
import { RotateCcw, Sparkles, Square } from '@/components/ui/icons'
import type { ID } from '@shared/types'
import { Button, Notice } from '@/components/ui'
import { cn } from '@/lib/cn'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { LampStatus } from '@/features/planning/LampThinking'
import { TalkPanel } from '@/features/planning/TalkPanel'
import { useTalks } from '@/features/planning/talkStore'
import { askInStory } from '@/features/ask/open'
import { treeOf, useOutlineHelper, helperKey } from './helperStore'
import { useApp } from '@/lib/store'
import {
  applyPlanTalk,
  closeRedo,
  declinePlanTalk,
  isPlanRevision,
  openRedo,
  planScope,
  previewTree,
  redoKey,
  redoNode,
  setRedoNote,
  startRedo,
  stopRedo,
  takeRedo,
  talkPlan,
  useRedos,
  type PlanRevision
} from './planTalk'
import type { PlanChange } from './outlineText'
import type { SuggestedAct, SuggestedChapter, SuggestedScene } from './parse'
import type { NodeKind, TreeNode } from './tree'

const KIND: Record<NodeKind, string> = { act: 'Act', chapter: 'Chapter', scene: 'Scene' }

/** One act, chapter or scene in a preview, with what it holds. `mark`: new or changed against the plan as it was. */
function MiniNode({ node, marks, depth = 0 }: { node: TreeNode; marks: Map<string, 'new' | 'changed'>; depth?: number }): React.JSX.Element {
  const mark = marks.get(node.key)
  return (
    <div className={cn(depth > 0 && 'ml-3 border-l border-line pl-3')}>
      <div className={cn('rounded-md px-2 py-1.5', mark ? 'bg-ai-soft' : '')}>
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
          {KIND[node.kind]}
          {node.when ? <span className="font-normal normal-case tracking-normal">· {node.when}</span> : null}
          {mark ? <span className="rounded bg-ai/15 px-1 font-semibold normal-case tracking-normal text-ai">{mark === 'new' ? 'New' : 'Changed'}</span> : null}
        </div>
        <p className="font-serif text-[13.5px] font-semibold leading-snug text-fg">{node.title || `Untitled ${node.kind}`}</p>
        {node.text ? <p className="text-[12.5px] leading-relaxed text-muted">{node.text}</p> : null}
        {node.beats.length ? (
          <ol className="mt-0.5 list-decimal pl-5 text-[12px] leading-relaxed text-muted marker:text-faint">
            {node.beats.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ol>
        ) : null}
      </div>
      {node.children.length ? (
        <div className="mt-1 flex flex-col gap-1">
          {node.children.map((c) => (
            <MiniNode key={c.key} node={c} marks={marks} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

const sig = (n: TreeNode): string => [n.title, n.text, n.when, ...n.beats].join('\u0001').toLowerCase()

/** What is new or changed in a revised plan, against the plan as it was (by title, then by words). */
function marksOf(next: TreeNode[], before: TreeNode[]): Map<string, 'new' | 'changed'> {
  const old = new Map<string, TreeNode>()
  const walkOld = (nodes: TreeNode[]): void =>
    nodes.forEach((n) => {
      old.set(`${n.kind}:${n.title.trim().toLowerCase()}`, n)
      walkOld(n.children)
    })
  walkOld(before)
  const out = new Map<string, 'new' | 'changed'>()
  const walk = (nodes: TreeNode[]): void =>
    nodes.forEach((n) => {
      const was = old.get(`${n.kind}:${n.title.trim().toLowerCase()}`)
      if (!was) out.set(n.key, 'new')
      else if (sig(was) !== sig(n)) out.set(n.key, 'changed')
      walk(n.children)
    })
  walk(next)
  return out
}

/** The whole revised plan, what is new or changed marked. */
function WholePlan({ storyId, text, intro }: { storyId: ID; text: string; intro: boolean }): React.JSX.Element {
  const worldId = useApp((s) => s.world?.id)
  const run = useOutlineHelper((s) => s.sessions[helperKey(worldId, storyId)]?.run ?? null)
  const tree = useMemo(() => previewTree(text), [text])
  const marks = useMemo(() => marksOf(tree, run ? treeOf(run) : []), [tree, run])
  const changed = marks.size
  return (
    <div>
      {intro ? (
        <p className="mb-2 text-[12.5px] text-muted">
          {changed ? `${changed} ${changed === 1 ? 'part is' : 'parts are'} new or changed, marked below.` : 'The same plan, worded a little differently.'}{' '}
          Made, it takes the place of the suggestions you haven’t decided on; Undo brings them back.
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        {tree.map((n) => (
          <MiniNode key={n.key} node={n} marks={marks} />
        ))}
      </div>
    </div>
  )
}

const flat = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()

/** A part's own lines, by name, for showing what changed in it. */
function linesOf(kind: NodeKind, n: PlanChange['after']): Record<string, string> {
  if (!n) return {}
  if (kind === 'scene') {
    const s = n as SuggestedScene
    return {
      When: flat(s.when),
      Summary: flat(s.summary),
      Location: flat(s.card?.location),
      Characters: (s.card?.characters ?? []).join(', '),
      'Point of view': flat(s.card?.pov),
      Mood: flat(s.card?.mood)
    }
  }
  if (kind === 'chapter') {
    const c = n as SuggestedChapter
    return { Goal: flat(c.goal), Location: flat(c.card?.location), Characters: (c.card?.characters ?? []).join(', '), When: flat(c.card?.when), Mood: flat(c.card?.mood) }
  }
  return { Purpose: flat((n as SuggestedAct).purpose) }
}

/** One part a talk changed: new (all of it), taken out, or changed (only what differs, the old struck through). */
function ChangeCard({ change }: { change: PlanChange }): React.JSX.Element {
  const { kind, mark, before, after } = change
  const title = (after ?? before)?.title ?? ''
  const renamed = mark === 'changed' && before && after && flat(before.title) !== flat(after.title)
  const was = linesOf(kind, before)
  const now = linesOf(kind, after)
  const lines = Object.keys(now).filter((k) => (mark === 'new' ? now[k] : now[k] !== was[k]))
  const beatsBefore = kind === 'scene' && before ? (before as SuggestedScene).beats : []
  const beatsAfter = kind === 'scene' && after ? (after as SuggestedScene).beats : []
  const beatsChanged = kind === 'scene' && (mark === 'new' || beatsBefore.join('\u0001') !== beatsAfter.join('\u0001'))
  return (
    <div className={cn('rounded-lg border px-3 py-2', mark === 'removed' ? 'border-line bg-surface' : 'border-ai/30 bg-ai-soft/60')}>
      <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
        {KIND[kind]}
        <span
          className={cn(
            'rounded px-1 font-semibold normal-case tracking-normal',
            mark === 'removed' ? 'bg-danger/10 text-danger' : 'bg-ai/15 text-ai'
          )}
        >
          {mark === 'new' ? 'New' : mark === 'removed' ? 'Taken out' : 'Changed'}
        </span>
        {change.where ? <span className="truncate font-normal normal-case tracking-normal">in {change.where}</span> : null}
      </div>
      {renamed ? <p className="text-[12px] text-faint line-through decoration-faint/60">{before!.title}</p> : null}
      <p className={cn('font-serif text-[13.5px] font-semibold leading-snug', mark === 'removed' ? 'text-faint line-through decoration-faint/60' : 'text-fg')}>
        {title || `Untitled ${kind}`}
      </p>
      {mark !== 'removed' && lines.length ? (
        <dl className="mt-1 flex flex-col gap-1">
          {lines.map((k) => (
            <div key={k} className="text-[12.5px] leading-relaxed">
              <dt className="inline font-medium text-muted">{k}: </dt>
              {mark === 'changed' && was[k] ? <dd className="inline text-faint line-through decoration-faint/60">{was[k]}</dd> : null}
              {mark === 'changed' && was[k] ? ' ' : null}
              <dd className="inline text-fg">{now[k] || <span className="italic text-faint">none</span>}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {mark !== 'removed' && beatsChanged && beatsAfter.length ? (
        <ol className="mt-1 list-decimal pl-5 text-[12px] leading-relaxed text-muted marker:text-faint">
          {beatsAfter.map((b, i) => (
            <li key={i} className={cn(!beatsBefore.includes(b) && mark === 'changed' && 'text-fg')}>
              {b}
            </li>
          ))}
        </ol>
      ) : null}
      {mark === 'new' && kind === 'chapter' && after ? (
        <p className="mt-1 text-[12px] text-faint">
          {(after as SuggestedChapter).scenes.length} {(after as SuggestedChapter).scenes.length === 1 ? 'scene' : 'scenes'}:{' '}
          {(after as SuggestedChapter).scenes.map((s) => s.title).join(', ')}
        </p>
      ) : null}
      {mark === 'new' && kind === 'act' && after ? (
        <p className="mt-1 text-[12px] text-faint">Chapters: {(after as SuggestedAct).chapters.map((c) => c.title).join(', ')}</p>
      ) : null}
    </div>
  )
}

/** A talk's revision: only what changed, with the whole plan a click away; a whole plan sent again, marked. */
export function PlanPreview({ storyId, revision }: { storyId: ID; revision: PlanRevision }): React.JSX.Element {
  const [whole, setWhole] = useState(false)
  if (!revision.changes) return <WholePlan storyId={storyId} text={revision.text} intro />
  const n = revision.changes.length
  return (
    <div>
      <p className="mb-2 text-[12.5px] text-muted">
        {n ? `${n} ${n === 1 ? 'part changes' : 'parts change'}; everything else stays as it is.` : 'Nothing in the plan changes.'} Once it is made, Undo
        brings the old version back.
      </p>
      {revision.lost ? (
        <p className="mb-2 text-[12px] text-danger">
          {revision.lost === 1 ? 'One change named a part' : `${revision.lost} changes named parts`} that isn’t in the plan, so{' '}
          {revision.lost === 1 ? 'it was' : 'they were'} left out.
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        {revision.changes.map((c, i) => (
          <ChangeCard key={i} change={c} />
        ))}
      </div>
      <button
        type="button"
        className="mt-2 text-[12px] font-medium text-accent hover:underline"
        aria-expanded={whole}
        onClick={() => setWhole((w) => !w)}
      >
        {whole ? 'Hide the whole plan' : 'Show the whole plan'}
      </button>
      {whole ? (
        <div className="mt-2">
          <WholePlan storyId={storyId} text={revision.text} intro={false} />
        </div>
      ) : null}
    </div>
  )
}

/**
 * The talk panel for a story's suggestions. The Plan hub (2026-10-20) gives it its own words (`intro`, `quick`) and calls
 * its button "Make this change"; the change is still shown first, and only that button makes it.
 */
export function PlanTalk({
  storyId,
  running,
  className,
  intro,
  quick,
  applyLabel,
  about,
  looking,
  handOff = false
}: {
  storyId: ID
  running: boolean
  className?: string
  intro?: string
  quick?: string[]
  applyLabel?: string
  /** What it is about now, after its title (Build with AI's section in view). */
  about?: string
  /** What Adam is looking at, for the AI (Build with AI's section in view, when it isn't the story line). */
  looking?: string
  /**
   * No suggestions are waiting and the story is being written (the Plan hub): a request to change the story's own
   * chapters or scenes is offered to Ask ("Make this change in the story"), as this talk changes suggestions only.
   */
  handOff?: boolean
}): React.JSX.Element {
  const scope = planScope(storyId)
  const preview = useTalks((s) => s.talks[scope]?.preview)
  return (
    <TalkPanel
      scope={scope}
      className={className}
      intro={
        intro ??
        'Tell the AI what to change: “make chapter 3 a betrayal”, “move the health check to the kitchen”, “give Mara a bigger part”. It changes only what your request reaches, everywhere it shows up, and shows you the change first.'
      }
      placeholder="What would you like changed?"
      quick={quick ?? ['Rework the rest to fit my changes', 'Add a twist in the middle', 'Raise the stakes', 'Tighten the pacing', 'Closer to the recipe']}
      disabled={running ? 'Wait for the plan to finish arriving.' : null}
      about={about}
      onSay={(m) => void talkPlan(storyId, m, looking, { handOff, applyLabel })}
      preview={isPlanRevision(preview) ? <PlanPreview storyId={storyId} revision={preview} /> : null}
      onApply={() => applyPlanTalk(storyId)}
      onDecline={() => declinePlanTalk(storyId)}
      canApplyStraightAway
      applyLabel={applyLabel}
      where="The plan below"
      onHandOff={(request) => void askInStory(request)}
    />
  )
}

/** "Redo" on a suggestion still waiting for a decision. */
export function RedoButton({ storyId, node, className }: { storyId: ID; node: TreeNode; className?: string }): React.JSX.Element {
  const k = redoKey(storyId, node.key)
  const open = useRedos((s) => !!s.redos[k])
  return (
    <button
      type="button"
      className={cn(className ?? 'rounded px-2 py-1 text-[12.5px] text-muted transition-colors duration-150 hover:bg-ai/10 hover:text-fg')}
      aria-expanded={open}
      onClick={() => (open ? closeRedo(storyId, node.key) : openRedo(storyId, node.key, node.kind))}
      title={`Have the AI write this ${node.kind} again, as you say`}
      data-redo
    >
      Redo
    </button>
  )
}

/** Under a suggestion being done again: a note, then the new version with Use this and Keep mine. */
export function RedoPanel({ storyId, node }: { storyId: ID; node: TreeNode }): React.JSX.Element | null {
  const r = useRedos((s) => s.redos[redoKey(storyId, node.key)])
  const fresh = useMemo(() => (r ? redoNode(r) : null), [r])
  if (!r) return null
  const running = r.status === 'running'
  return (
    <div className="mt-2 rounded-lg border border-ai/40 bg-surface p-3 animate-fade-in" data-redo-panel>
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">Do this {node.kind} again</p>
      {r.status === 'idle' || r.status === 'error' ? (
        <>
          <AutoTextarea
            aria-label="What should be different"
            value={r.note}
            minRows={1}
            maxRows={5}
            autoFocus
            placeholder="What should be different? Leave empty for a fresh take."
            className="mt-1.5 text-[13px]"
            onChange={(e) => setRedoNote(storyId, node.key, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void startRedo(storyId, node.key)
              } else if (e.key === 'Escape') closeRedo(storyId, node.key)
            }}
          />
          {r.error ? (
            <div className="mt-2">
              <Notice tone="danger">{r.error}</Notice>
            </div>
          ) : null}
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => closeRedo(storyId, node.key)}>
              Cancel
            </Button>
            <Button size="sm" variant="ai" icon={<RotateCcw size={13} />} onClick={() => void startRedo(storyId, node.key)}>
              Write it again
            </Button>
          </div>
        </>
      ) : (
        <>
          {r.note ? <p className="mt-1 text-[12.5px] italic text-muted">“{r.note}”</p> : null}
          <div className="mt-2">
            {fresh ? <MiniNode node={fresh} marks={new Map()} /> : running ? <LampStatus text={`Writing the ${node.kind} again…`} /> : null}
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            {running ? (
              <Button size="sm" icon={<Square size={10} fill="currentColor" />} onClick={() => stopRedo(storyId, node.key)}>
                Stop
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => closeRedo(storyId, node.key)}>
                  Keep mine
                </Button>
                <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => void startRedo(storyId, node.key)}>
                  Again
                </Button>
                <Button size="sm" variant="primary" icon={<Sparkles size={13} />} disabled={!fresh} onClick={() => takeRedo(storyId, node.key)}>
                  Use this
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
