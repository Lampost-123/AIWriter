// The outline helper's parts for planning in stages and choosing where a Keep goes (2026-10-19), used by Build with
// AI's suggestion rows (planHub/LineSuggestions.tsx):
// - StageRow, under an act or chapter: "Plan its chapters" / "Plan its scenes" while it holds none, then how that is
//   going (Stop), and what went wrong, with Try again.
// - KeepPlaceMenu, beside Keep on an act or chapter: keep it somewhere else in the binder (after a chosen act or chapter,
//   first in an act, at the start or the end), the place the outline would put it named first.
// - WriteChapterButton, on a kept chapter whose scenes are kept: opens Write the whole chapter for it.
import * as M from '@radix-ui/react-dropdown-menu'
import { useMemo } from 'react'
import type { Act, Chapter, ID, Outline } from '@shared/types'
import { ChevronDown, PenLine, Sparkles, Square } from '@/components/ui/icons'
import { Button, Notice } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useOutline } from '@/features/binder/outlineStore'
import { WritingStatus } from '@/features/builder/parts'
import { openChapterWriter } from '@/features/chapterWriter/chapterWriterStore'
import { decisionsOf, dismissStage, keepSuggestions, planStage, runBusy, stopOutline, treeOf, useOutlineHelper, helperKey, type HelperRun } from './helperStore'
import { useApp } from '@/lib/store'
import { canPlanInside, chaptersFor } from './stages'
import { keepPlan, wordsOf, type KeepPlace, type TreeNode } from './tree'
import type { KeepItem } from '@shared/contracts/outline'

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** The plain-words name of what a stage plans under this node. */
export const stageWords = (kind: TreeNode['kind']): { ask: string; doing: string; part: string; parts: string } =>
  kind === 'act'
    ? { ask: 'Plan its chapters', doing: 'Planning its chapters', part: 'chapter', parts: 'chapters' }
    : { ask: 'Plan its scenes', doing: 'Planning its scenes', part: 'scene', parts: 'scenes' }

/**
 * Under an act or chapter of the story's own suggestions: the next step in planning it, or how that step is going. Draws
 * nothing for a scene, a chapter's plan or an earlier batch, or while there is nothing to say.
 */
export function StageRow({ storyId, node, run, desk = false }: { storyId: ID; node: TreeNode; run: HelperRun; desk?: boolean }): React.JSX.Element | null {
  const worldId = useApp((s) => s.world?.id)
  const session = useOutlineHelper((st) => st.sessions[helperKey(worldId, storyId)])
  if (node.kind === 'scene' || !session || run.lead) return null
  const st = run.stage?.key === node.key ? run.stage : null
  const words = stageWords(node.kind)
  const decisions = decisionsOf(session, run)
  const arrived = node.children.length - (st?.before ?? 0)

  if (st?.status === 'running') {
    return (
      <div className={cn('flex min-h-7 items-center gap-3', desk ? 'mt-2 px-1' : 'mt-1.5 pl-1')} data-stage={node.key}>
        <WritingStatus text={`${st.retrying ?? words.doing}…${arrived > 0 ? ` ${plural(arrived, words.part)} so far` : ''}`} />
        <button
          type="button"
          onClick={() => stopOutline(storyId)}
          className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded px-2 text-[12.5px] font-medium text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg"
          title="Stop. What has arrived stays, to keep or discard."
        >
          <Square size={9} fill="currentColor" aria-hidden />
          Stop
        </button>
      </div>
    )
  }

  const problem = st
    ? st.status === 'error'
      ? st.error
      : !st.merged
        ? st.text.trim()
          ? `The AI’s answer didn’t come as ${words.parts}, so there is nothing to keep. Please try again.`
          : `Nothing arrived before it stopped.`
        : st.cutOff
          ? `The answer reached its length limit, so its last ${words.part} may be missing. Keep what is here, or plan it again.`
          : null
    : null
  if (problem) {
    return (
      <div className={desk ? 'mt-2 px-1' : 'mt-2'} data-stage={node.key} role={st?.status === 'error' ? 'alert' : undefined}>
        <Notice
          tone={st?.status === 'error' ? 'danger' : 'neutral'}
          action={
            <div className="flex shrink-0 gap-1.5">
              {canPlanInside(node, decisions) ? (
                <Button size="sm" onClick={() => void planStage(storyId, node.key)}>
                  Try again
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => dismissStage(storyId)}>
                Close
              </Button>
            </div>
          }
        >
          {problem}
        </Notice>
      </div>
    )
  }

  if (!canPlanInside(node, decisions) || decisions[node.key]?.status === 'discarded') return null
  const busy = runBusy(run)
  const about = node.kind === 'act' ? chaptersFor(node, run.edits[node.key]) : null
  const title = wordsOf(node, run.edits[node.key]).title.trim()
  return (
    <div className={cn('flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1', desk ? 'mt-2 px-1' : 'mt-1.5 pl-1')} data-stage={node.key}>
      <button
        type="button"
        data-plan-stage
        disabled={busy}
        onClick={() => void planStage(storyId, node.key)}
        aria-label={`${words.ask}${title ? `: “${title}”` : ''}`}
        title={
          node.kind === 'act'
            ? `Suggest this act’s chapters, about ${plural(about ?? 3, 'chapter')}, each with its goal and card. Their scenes come after.`
            : 'Suggest this chapter’s scenes: as many as it needs, each a scene card.'
        }
        className="-mx-1.5 inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12.5px] font-medium text-ai transition-colors duration-150 hover:bg-ai-soft disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Sparkles size={13} className="shrink-0" aria-hidden />
        {words.ask}
      </button>
      {about ? <span className="text-[12px] text-faint">About {plural(about, 'chapter')}</span> : null}
    </div>
  )
}

// ---------- Where a Keep goes ----------

interface PlaceChoice {
  place: KeepPlace
  label: string
  /** How the toast says it: "after “The Docks”". */
  words: string
}

const q = (s: string, fallback: string): string => `“${s.trim() || fallback}”`

/** The story's acts and chapters as the binder has them: chapters with no act first, then each act's. */
function groupsOf(outline: Outline): { act: Act | null; chapters: Chapter[] }[] {
  const loose = outline.chapters.filter((c) => !c.actId)
  const out: { act: Act | null; chapters: Chapter[] }[] = loose.length ? [{ act: null, chapters: loose }] : []
  for (const a of outline.acts ?? []) out.push({ act: a, chapters: outline.chapters.filter((c) => c.actId === a.id) })
  return out
}

/** Where the outline puts it, in words, from what Keep would send (its act or chapter, after or before a kept one). */
export function naturalWords(items: KeepItem[], key: string, outline: Outline | null): string {
  const main = items.find((i) => i.key === key)
  if (!main || !outline) return 'where the outline puts it'
  const actTitle = (id: ID | null | undefined): string => q(outline.acts?.find((a) => a.id === id)?.title ?? '', 'Untitled act')
  const chapterTitle = (id: ID | null | undefined): string => q(outline.chapters.find((c) => c.id === id)?.title ?? '', 'Untitled chapter')
  if (main.kind === 'act') {
    if (main.after?.id) return `after ${actTitle(main.after.id)}`
    if (main.before?.id) return `before ${actTitle(main.before.id)}`
    return 'at the end of the story'
  }
  if (main.after?.id) return `after ${chapterTitle(main.after.id)}`
  if (main.before?.id) return `before ${chapterTitle(main.before.id)}`
  if (main.parent?.key) return `in a new act, ${q(items.find((i) => i.key === main.parent?.key)?.title ?? '', 'Untitled act')}`
  if (main.parent?.id) return `at the end of ${actTitle(main.parent.id)}`
  return 'at the end of the story'
}

/** The places Adam can keep an act or chapter, besides where the outline puts it. */
export function placeChoices(kind: 'act' | 'chapter', outline: Outline | null): PlaceChoice[] {
  if (!outline) return [{ place: { at: 'end' }, label: 'At the end of the story', words: 'at the end of the story' }]
  const out: PlaceChoice[] = []
  if (kind === 'act') {
    const acts = outline.acts ?? []
    if (acts.length) out.push({ place: { at: 'first', actId: null, beforeId: acts[0].id }, label: 'At the start of the story', words: 'at the start of the story' })
    for (const a of acts.slice(0, -1)) out.push({ place: { at: 'after', id: a.id }, label: `After ${q(a.title, 'Untitled act')}`, words: `after ${q(a.title, 'Untitled act')}` })
  } else {
    const groups = groupsOf(outline)
    const acted = (outline.acts ?? []).length > 0
    const last = outline.chapters[outline.chapters.length - 1]?.id
    for (const g of groups) {
      const where = g.act ? q(g.act.title, 'Untitled act') : ''
      const first = g.act ? `First in ${where}` : acted ? 'First, before any act' : 'At the start of the story'
      out.push({ place: { at: 'first', actId: g.act?.id ?? null, beforeId: g.chapters[0]?.id ?? null }, label: first, words: first.charAt(0).toLowerCase() + first.slice(1) })
      // After the story's last chapter is the end of the story, offered once below.
      for (const c of g.chapters.filter((x) => x.id !== last))
        out.push({ place: { at: 'after', id: c.id, actId: g.act?.id ?? null }, label: `After ${q(c.title, 'Untitled chapter')}`, words: `after ${q(c.title, 'Untitled chapter')}` })
    }
  }
  out.push({ place: { at: 'end' }, label: 'At the end of the story', words: 'at the end of the story' })
  return out
}

/**
 * Beside Keep on an act or chapter: a small menu to keep it somewhere else in the binder. Choosing a place keeps it
 * there at once (Undo in the toast, as for any Keep).
 */
export function KeepPlaceMenu({
  storyId,
  node,
  run,
  runId,
  title,
  className
}: {
  storyId: ID
  node: TreeNode
  run: HelperRun
  runId: ID | null
  title: string
  className?: string
}): React.JSX.Element | null {
  const { outline } = useOutline()
  const shape = outline?.story.id === storyId ? outline : null
  const worldId = useApp((s) => s.world?.id)
  const session = useOutlineHelper((st) => st.sessions[helperKey(worldId, storyId)])
  const kind = node.kind === 'act' ? 'act' : 'chapter'
  const choices = useMemo(() => placeChoices(kind, shape), [kind, shape])
  if (node.kind === 'scene' || !session) return null
  const natural = (): string => {
    const items = keepPlan(treeOf(run), decisionsOf(session, run), run.edits, [node.key])
    return naturalWords(items, node.key, shape)
  }
  const named = title ? `“${title}”` : `this ${node.kind}`
  const item = 'flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-[13px] text-fg outline-none data-[highlighted]:bg-surface-2'
  return (
    <M.Root modal={false}>
      <M.Trigger asChild>
        <button
          type="button"
          data-keep-place
          aria-label={`Choose where to keep ${named}`}
          title="Keep it somewhere else in the binder"
          className={cn(
            'inline-flex h-6 w-5 shrink-0 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            className
          )}
        >
          <ChevronDown size={12} aria-hidden />
        </button>
      </M.Trigger>
      <M.Portal>
        <M.Content
          aria-label={`Where to keep ${named}`}
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 max-h-[min(60vh,420px)] min-w-[220px] max-w-[320px] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
        >
          <M.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Keep it…</M.Label>
          <M.Item className={item} onSelect={() => void keepSuggestions(storyId, [node.key], null, { runId })}>
            <span className="min-w-0 flex-1">
              <span className="block">Where the outline puts it</span>
              <span className="block truncate text-[12px] text-faint">{natural()}</span>
            </span>
          </M.Item>
          <M.Separator className="my-1 h-px bg-line" />
          {choices.map((c, i) => (
            <M.Item
              key={i}
              className={item}
              data-place={c.label}
              onSelect={() => void keepSuggestions(storyId, [node.key], null, { runId, place: c.place, placeWords: c.words })}
            >
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
            </M.Item>
          ))}
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}

/** On a kept chapter whose scenes are kept: Write the whole chapter, for it (no dead end after planning its scenes). */
export function WriteChapterButton({ node, run, className }: { node: TreeNode; run: HelperRun; className?: string }): React.JSX.Element | null {
  const d = run.decisions[node.key]
  if (node.kind !== 'chapter' || d?.status !== 'kept') return null
  if (!node.children.some((c) => run.decisions[c.key]?.status === 'kept')) return null
  return (
    <button
      type="button"
      data-write-chapter
      onClick={() => openChapterWriter(d.id)}
      title="Write the whole chapter with AI, from its scene cards"
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[12.5px] font-medium text-accent transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        className
      )}
    >
      <PenLine size={12} aria-hidden />
      Write this chapter
    </button>
  )
}
