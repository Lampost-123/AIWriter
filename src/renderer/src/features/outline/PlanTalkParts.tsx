// The outline's talk and redo on screen (planTalk.ts): the talk panel beside the suggestions, the preview of a revised
// plan (what is new or changed marked), and, under a suggestion, doing it again with a note, then Use this or Keep mine.

import { useMemo } from 'react'
import { RotateCcw, Sparkles, Square } from '@/components/ui/icons'
import type { ID } from '@shared/types'
import { Button, Notice } from '@/components/ui'
import { cn } from '@/lib/cn'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { LampStatus } from '@/features/planning/LampThinking'
import { TalkPanel } from '@/features/planning/TalkPanel'
import { useTalks } from '@/features/planning/talkStore'
import { treeOf, useOutlineHelper, helperKey } from './helperStore'
import { useApp } from '@/lib/store'
import {
  applyPlanTalk,
  closeRedo,
  declinePlanTalk,
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
  useRedos
} from './planTalk'
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

export function PlanPreview({ storyId, text }: { storyId: ID; text: string }): React.JSX.Element {
  const worldId = useApp((s) => s.world?.id)
  const run = useOutlineHelper((s) => s.sessions[helperKey(worldId, storyId)]?.run ?? null)
  const tree = useMemo(() => previewTree(text), [text])
  const marks = useMemo(() => marksOf(tree, run ? treeOf(run) : []), [tree, run])
  const changed = marks.size
  return (
    <div>
      <p className="mb-2 text-[12.5px] text-muted">
        {changed ? `${changed} ${changed === 1 ? 'part is' : 'parts are'} new or changed, marked below.` : 'The same plan, worded a little differently.'} Apply
        puts this in place of the suggestions you haven’t decided on; Undo brings them back.
      </p>
      <div className="flex max-h-[340px] flex-col gap-1.5 overflow-y-auto pr-1">
        {tree.map((n) => (
          <MiniNode key={n.key} node={n} marks={marks} />
        ))}
      </div>
    </div>
  )
}

/** The talk panel for a story's suggestions. */
export function PlanTalk({ storyId, running, className }: { storyId: ID; running: boolean; className?: string }): React.JSX.Element {
  const scope = planScope(storyId)
  const preview = useTalks((s) => s.talks[scope]?.preview)
  return (
    <TalkPanel
      scope={scope}
      className={className}
      intro="Tell the AI what to change: “make chapter 3 a betrayal”, “cut the second act down”, “give Mara a bigger part”. It shows you the new plan first; nothing changes until you apply it."
      placeholder="What would you like changed?"
      quick={['Rework the rest to fit my changes', 'Add a twist in the middle', 'Raise the stakes', 'Tighten the pacing', 'Closer to the recipe']}
      disabled={running ? 'Wait for the plan to finish arriving.' : null}
      onSay={(m) => void talkPlan(storyId, m)}
      preview={typeof preview === 'string' ? <PlanPreview storyId={storyId} text={preview} /> : null}
      onApply={() => applyPlanTalk(storyId)}
      onDecline={() => declinePlanTalk(storyId)}
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
