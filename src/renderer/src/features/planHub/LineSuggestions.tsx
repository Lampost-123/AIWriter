// The AI's suggestions in the Plan hub's story line (2026-10-20): each act, chapter or scene card as one row where it
// would go ("◆ Ch 4 · Sc 3 Across the Linn", what happens in it, Keep, Change, Discard), its beats and card a click away,
// what is inside it indented under it. The same decisions as the outline helper had (features/outline/helperStore: Keep,
// Change, Discard and their Undo, doing one again, planning inside an act or chapter), drawn the hub's way. Kept, a row
// turns plain with a tick and Open; on the desk a copy of it flies to the story's spine. A batch has its head: what it
// is doing or what came, Keep all, What the AI saw. Earlier batches show the same rows under "Earlier suggestions".

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Chapter, ID, Outline } from '@shared/types'
import { Check, ChevronRight, PenLine, Square } from '@/components/ui/icons'
import { Button, Notice } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp, type View } from '@/lib/store'
import { deleteChapter } from '@/features/binder/actions'
import { keyboardDriven, reducedMotion } from '@/features/look/motion'
import { FreshText } from '@/features/planning/FreshText'
import { HubStatus } from './HubStatus'
import { keepInLine } from './hubStore'
import { chapterToWrite } from './hubLogic'
import { writeScene } from './SceneRow'
import { flyCard, landingOf, landingSoon } from '@/features/planning/fly'
import { ProblemNotice } from '@/features/builder/parts'
import {
  discardSuggestion,
  dismissProblem,
  earlierShown,
  keepSuggestions,
  putAwayEarlier,
  runBusy,
  stopOutline,
  treeOf,
  type HelperRun,
  type HelperSession
} from '@/features/outline/helperStore'
import { currentOf, EditForm, focusNext, KEEP_TITLES, KIND_LABELS, runIdOf, waitsFor, type TreeProps } from '@/features/outline/Suggestions'
import { KeepPlaceMenu, StageRow, WriteChapterButton } from '@/features/outline/StageParts'
import { RedoButton, RedoPanel } from '@/features/outline/PlanTalkParts'
import { CardLines, whenOf } from '@/features/outline/SuggestionParts'
import { countLine, countNodes, totalOf, wordsOf, type TreeNode } from '@/features/outline/tree'

const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`

/** The nodes a batch shows: a batch of scenes for a chapter the story has shows only the scenes. */
export const shownNodes = (run: HelperRun, tree: TreeNode[]): TreeNode[] => (run.lead ? (tree[0]?.children ?? []) : tree)

/** One batch's rows. `labels`: what each is called in the story line, by key ("Ch 4 · Sc 3"). */
export function LineSuggestions({
  storyId,
  run,
  tree,
  labels,
  earlier = false,
  chapterId = null
}: {
  storyId: ID
  run: HelperRun
  tree: TreeNode[]
  labels: Map<string, string>
  earlier?: boolean
  /** A chapter's own session (Plan this chapter): its scene cards keep into that chapter. */
  chapterId?: ID | null
}): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)
  const props: TreeProps & { labels: Map<string, string> } = { storyId, chapterId, run, current: currentOf(run, tree), editing, setEditing, earlier, labels }
  const nodes = shownNodes(run, tree).filter((n) => run.decisions[n.key]?.status !== 'discarded')
  return (
    <div className="hub-sugs" data-suggestions>
      {nodes.map((n) => (
        <SugNode key={n.key} node={n} {...props} />
      ))}
    </div>
  )
}

type RowProps = TreeProps & { labels: Map<string, string> }

function SugNode({ node, ...props }: RowProps & { node: TreeNode }): React.JSX.Element {
  const { run } = props
  const children = node.children.filter((c) => run.decisions[c.key]?.status !== 'discarded')
  const kept = run.decisions[node.key]?.status === 'kept'
  const title = (run.edits[node.key] ?? node).title || 'Untitled'
  // Its beats and card, opened or not: kept here so they stay as they were after Change.
  const [open, setOpen] = useState(false)
  return (
    <div
      role="group"
      aria-label={`${KIND_LABELS[node.kind]}: ${title}`}
      data-suggestion={node.kind}
      data-key={node.key}
      data-state={kept ? 'kept' : 'open'}
      className="hub-sug-group"
    >
      {props.editing === node.key ? <EditForm node={node} {...props} className="hub-edit" /> : <SugRow node={node} open={open} setOpen={setOpen} {...props} />}
      {!props.earlier && !props.chapterId ? <RedoPanel storyId={props.storyId} node={node} /> : null}
      {!props.earlier && !run.lead ? <StageRow storyId={props.storyId} node={node} run={run} /> : null}
      {children.length ? (
        <div className="hub-sugs-in">
          {children.map((c) => (
            <SugNode key={c.key} node={c} {...props} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SugRow({
  node,
  storyId,
  chapterId,
  run,
  current,
  setEditing,
  earlier,
  labels,
  open,
  setOpen
}: RowProps & { node: TreeNode; open: boolean; setOpen: (fn: (open: boolean) => boolean) => void }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const decision = run.decisions[node.key]
  const kept = decision?.status === 'kept'
  const edit = run.edits[node.key]
  const words = wordsOf(node, edit)
  const when = whenOf(node.kind, words)
  const runId = runIdOf({ run, earlier })
  const running = waitsFor(run, node.key)
  const writing = running && node.key === current
  const title = words.title.trim()
  const label = labels.get(node.key) ?? KIND_LABELS[node.kind]
  const [leaving, setLeaving] = useState(false)
  const [back, setBack] = useState(false)
  const flying = useRef<DOMRect | null>(null)
  const was = useRef(decision?.status)
  const hasDetails = words.beats.length > 0 || !!when || !!words.card || words.setsUp.length > 0 || words.paysOff.length > 0

  // Kept by its own Keep, on the desk: a copy flies to its row in the story's spine; Undo flies it back.
  useLayoutEffect(() => {
    const before = was.current
    was.current = decision?.status
    const el = box.current
    if (!el) return
    if (decision?.status === 'kept' && before !== 'kept' && flying.current) {
      const from = flying.current
      flying.current = null
      void landingSoon(decision.id).then((to) => flyCard(el, from, to))
    } else if (!decision && before === 'kept') {
      setBack(true)
      void flyCard(el, el.getBoundingClientRect(), landingOf(null), true)
    }
  }, [decision])
  useEffect(() => {
    if (!back) return
    const t = setTimeout(() => setBack(false), 1200)
    return () => clearTimeout(t)
  }, [back])

  const focused = (): boolean => !!box.current?.contains(document.activeElement)
  const keep = (): void => {
    const from = focused() ? box.current : null
    flying.current = box.current?.getBoundingClientRect() ?? null
    void (chapterId ? keepSuggestions(storyId, [node.key], chapterId, { runId }) : keepInLine(storyId, [node.key], { runId })).then(() => focusNext(from))
  }
  const discard = (): void => {
    if (focused()) focusNext(box.current, true)
    if (reducedMotion() || keyboardDriven()) return discardSuggestion(storyId, node.key, chapterId ?? null, runId)
    setLeaving(true)
    setTimeout(() => discardSuggestion(storyId, node.key, chapterId ?? null, runId), 140)
  }
  const named = title ? `“${title}”` : `this ${node.kind}`

  return (
    <div
      ref={box}
      data-box
      className={cn('hub-sug', `is-${node.kind}`, kept && 'is-kept', writing && 'is-writing', leaving && 'is-leaving', back && 'is-back')}
    >
      <span className={cn('hub-sug-mark', kept && 'is-kept')} aria-hidden>
        {kept ? <Check size={13} /> : null}
      </span>
      <div className="hub-sug-body">
        <p className="hub-sug-head">
          {hasDetails && !running ? (
            <button
              type="button"
              className="hub-sug-toggle"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              title={open ? 'Fold away its beats and card' : 'Show its beats and card'}
            >
              <ChevronRight size={12} aria-hidden className={cn('hub-chev', open && 'is-open')} />
              <span className="sr-only">{open ? 'Hide the details of' : 'Show the details of'} {named}</span>
            </button>
          ) : (
            <span className="hub-sug-toggle-gap" aria-hidden />
          )}
          <span className="hub-sug-label">{label}</span>
          <strong className={cn('hub-sug-title', !title && 'text-faint')}>
            {title ? <FreshText text={title} live={running} /> : `Untitled ${node.kind}`}
            {writing && !words.text && !words.beats.length ? <span className="hub-caret" aria-hidden /> : null}
          </strong>
          {when ? (
            <span className="hub-sug-when" data-when>
              {when}
            </span>
          ) : null}
          {edit && !kept ? <span className="hub-sug-edited">Changed by you</span> : null}
        </p>
        {words.text ? (
          <p className="hub-sug-text">
            <FreshText text={words.text} live={running} />
            {writing && !words.beats.length ? <span className="hub-caret" aria-hidden /> : null}
          </p>
        ) : null}
        {open ? (
          <div className="hub-sug-more animate-fade-in">
            {words.beats.length ? (
              <ol className="hub-sug-beats">
                {words.beats.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ol>
            ) : null}
            <CardLines kind={node.kind} words={words} />
          </div>
        ) : null}
      </div>
      {kept ? (
        <div className="hub-sug-actions">
          <span className="hub-kept" title="Added to the story">
            <Check size={13} aria-hidden />
            Kept
          </span>
          {node.kind === 'scene' && decision?.status === 'kept' ? (
            <button type="button" className="hub-txt" onClick={() => useApp.getState().selectScene(decision.id, storyId)} title="Open this scene to write it">
              Open
            </button>
          ) : null}
          <WriteChapterButton node={node} run={run} />
        </div>
      ) : (
        // While the answer arrives the buttons keep their room, so nothing moves when they appear.
        <div className={cn('hub-sug-actions', running && 'invisible')} aria-hidden={running || undefined}>
          <button type="button" className="hub-keep" data-keep onClick={keep} title={run.fill ? 'Put this on the scene’s card, where the card is empty' : KEEP_TITLES[node.kind]} aria-label={`Keep ${named}`}>
            Keep
          </button>
          {node.kind !== 'scene' && (!run.place || run.place.at === 'end') ? (
            <KeepPlaceMenu storyId={storyId} node={node} run={run} runId={runId} title={title} className="-ml-1" />
          ) : null}
          <button type="button" className="hub-change" data-edit onClick={() => setEditing(node.key)} aria-label={`Change ${named}`}>
            Change
          </button>
          {!earlier && !chapterId ? <RedoButton storyId={storyId} node={node} className="hub-txt" /> : null}
          <button type="button" className="hub-txt" onClick={discard} title="Leave this out. Undo brings it back." aria-label={`Discard ${named}`}>
            Discard
          </button>
        </div>
      )}
    </div>
  )
}

/** "Planning the next scene…", what each kind of request is doing while it arrives. */
export function arrivingWords(run: HelperRun, tree: TreeNode[]): string {
  if (run.retrying) return run.retrying
  if (run.stage?.status === 'running') return run.stage.retrying ?? 'Planning inside it…'
  const arrived = totalOf(countNodes(shownNodes(run, tree), {}, 'all'))
  if (run.fill) return arrived ? `Planning the empty cards… ${arrived} of ${run.fill.length} so far` : 'Planning the empty cards…'
  if (arrived) return `Suggesting… ${countLine(countNodes(shownNodes(run, tree), {}, 'all'))} so far`
  if (run.lead) return run.place?.at === 'here' && run.size.chapters === 1 ? 'Planning what happens next…' : 'Planning its scenes…'
  if (run.place?.at === 'act') return 'Planning its chapters…'
  return 'Planning…'
}

/**
 * The head of the newest batch: while it arrives, the lamp with what it is doing and Stop; once it has come, how many are
 * left to decide, Keep all, and What the AI saw. What went wrong shows here too.
 */
export function BatchHead({
  storyId,
  session,
  run,
  tree,
  starter,
  backLabel,
  outline
}: {
  storyId: ID
  session: HelperSession
  run: HelperRun
  tree: TreeNode[]
  starter: Chapter | null
  backLabel: { view: View; label: string }
  /** The story as it is now: which chapter the scenes kept are in, for Write this chapter. */
  outline: Outline
}): React.JSX.Element {
  const busy = runBusy(run)
  const nodes = shownNodes(run, tree)
  const open = totalOf(countNodes(nodes, run.decisions, 'open'))
  const kept = totalOf(countNodes(nodes, run.decisions, 'kept'))
  const ended = !busy
  const nothing = ended && nodes.length === 0
  const generationId = run.stage?.generationId ?? run.generationId
  const whatTheAISaw = generationId
    ? () => useApp.getState().navigate({ kind: 'generation', generationId, back: { view: backLabel.view, label: backLabel.label, what: 'this plan' } })
    : null
  const starterTitle = starter?.title.trim() || 'Chapter 1'
  const firstKept = ended ? firstKeptScene(run, nodes) : null
  const write = firstKept ? chapterToWrite(outline, keptScenes(run, nodes)) : null
  return (
    <div className="hub-batch-head" data-batch-head>
      {busy ? (
        <div className="hub-batch-line">
          <HubStatus text={arrivingWords(run, tree)} size={22} />
          <Button
            size="sm"
            icon={<Square size={10} fill="currentColor" />}
            onClick={() => stopOutline(storyId)}
            aria-label="Stop planning"
            title="Stop. What has arrived stays, to keep or discard."
          >
            Stop
          </Button>
        </div>
      ) : (
        <div className="hub-batch-line">
          <p className="hub-batch-t" role="status">
            {nothing
              ? run.text.trim()
                ? 'The AI’s answer didn’t come as a plan, so there is nothing to keep.'
                : 'Nothing arrived before it stopped.'
              : open
                ? `${run.status === 'stopped' ? 'Stopped. ' : run.status === 'error' ? 'It stopped part way. ' : ''}${plural(open, 'suggestion')} to keep, change or discard${kept ? ` · ${kept} kept` : ''}`
                : kept
                  ? `All decided · ${kept} kept`
                  : 'All decided'}
          </p>
          {starter ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void deleteChapter(starter.id, { stay: true })}
              title={`The story still starts with “${starterTitle}”, the empty chapter it was made with, ahead of what you kept. Undo brings it back.`}
            >
              Remove the empty “{starterTitle}”
            </Button>
          ) : null}
          {/* All decided with a scene kept: no dead end. The AI writes the whole chapter they are in (its plan first, then
              every scene), or the first scene now, on the writing page (2026-10-20: "Start writing" only opened an empty page). */}
          {!open && firstKept && write ? (
            <Button
              size="sm"
              variant="primary"
              icon={<PenLine size={13} />}
              onClick={() => openWriteChapter(storyId, write.id)}
              title={`Write the whole of Ch ${write.no} with AI: its plan first, for you to read, then every scene`}
              data-write-kept-chapter={write.id}
            >
              {write.all ? 'Write this chapter' : `Write Ch ${write.no}`}
            </Button>
          ) : null}
          {!open && firstKept ? (
            <Button
              size="sm"
              variant={write ? 'secondary' : 'primary'}
              onClick={() => writeScene(storyId, firstKept)}
              title="Open the first scene kept on the writing page, and draft it from its card"
              data-write-first-scene
            >
              Write the first scene
            </Button>
          ) : null}
          {open > 0 ? (
            <Button size="sm" icon={<Check size={13} />} onClick={() => void keepInLine(storyId, 'all')} title="Add every suggestion here you haven’t discarded to the story">
              Keep all
            </Button>
          ) : null}
          {whatTheAISaw ? (
            <button type="button" className="hub-link" onClick={whatTheAISaw}>
              What the AI saw
            </button>
          ) : null}
        </div>
      )}
      {session.problem ? (
        <div className="mt-2">
          <ProblemNotice message={session.problem.message} code={session.problem.code} />
          <button type="button" className="hub-link mt-1" onClick={() => dismissProblem(storyId)}>
            Close
          </button>
        </div>
      ) : null}
      {ended && run.cutOff && !nothing ? (
        <div className="mt-2">
          <Notice>The answer reached its length limit, so the plan stops early. Keep what is here, or plan a smaller part.</Notice>
        </div>
      ) : null}
    </div>
  )
}

/** Every scene the batch kept, in its order. */
function keptScenes(run: HelperRun, nodes: TreeNode[]): ID[] {
  const out: ID[] = []
  const walk = (list: TreeNode[]): void =>
    list.forEach((n) => {
      const d = run.decisions[n.key]
      if (n.kind === 'scene' && d?.status === 'kept') out.push(d.id)
      walk(n.children)
    })
  walk(nodes)
  return out
}

/** Write this chapter, open in its row of the story line (the way back from Build with AI stays as it was). */
export function openWriteChapter(storyId: ID, chapterId: ID): void {
  const app = useApp.getState()
  const back = app.view.kind === 'planHub' ? app.view.back : undefined
  app.navigate({ kind: 'planHub', storyId, section: 'line', chapterId, open: 'write', ...(back ? { back } : {}) })
}

/** The first scene the batch kept, in its order (null for none). */
function firstKeptScene(run: HelperRun, nodes: TreeNode[]): ID | null {
  for (const n of nodes) {
    const d = run.decisions[n.key]
    if (n.kind === 'scene' && d?.status === 'kept') return d.id
    const inner = firstKeptScene(run, n.children)
    if (inner) return inner
  }
  return null
}

/** "Earlier suggestions": the batches Adam hadn't decided on when he asked again, folded away until he opens them. */
export function EarlierBatches({
  storyId,
  session,
  labelsOf
}: {
  storyId: ID
  session: HelperSession
  labelsOf: (run: HelperRun, tree: TreeNode[]) => Map<string, string>
}): React.JSX.Element | null {
  const batches = useMemo(() => earlierShown(session).map((run) => ({ run, tree: treeOf(run) })), [session])
  const [open, setOpen] = useState(false)
  if (!batches.length) return null
  const toDecide = batches.reduce((n, b) => n + totalOf(countNodes(shownNodes(b.run, b.tree), b.run.decisions, 'open')), 0)
  return (
    <section aria-label="Earlier suggestions" className="hub-earlier" data-earlier>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="hub-earlier-t">
        <ChevronRight size={13} aria-hidden className={cn('hub-chev', open && 'is-open')} />
        Earlier suggestions
        <span className="hub-earlier-n">{toDecide} still to decide</span>
      </button>
      {open ? (
        <div className="hub-earlier-list">
          {batches.map(({ run, tree }) => (
            <div key={run.taskId} role="group" aria-label={batchName(run)} data-earlier-batch className="hub-earlier-batch">
              <div className="hub-batch-line">
                <p className="hub-batch-t">{batchName(run)}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => putAwayEarlier(storyId, run.taskId)}
                  title="Discard everything still to decide in these. Undo brings them back."
                >
                  Put these away
                </Button>
              </div>
              <LineSuggestions storyId={storyId} run={run} tree={tree} labels={labelsOf(run, tree)} earlier />
            </div>
          ))}
        </div>
      ) : (
        <p className="hub-earlier-s">What you hadn’t decided on when you planned again. Nothing here goes into the story until you keep it.</p>
      )}
    </section>
  )
}

/** "Suggested at 2:41 pm". */
function batchName(run: HelperRun): string {
  if (!run.at) return 'Suggested earlier'
  return `Suggested at ${new Date(run.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

/** Where the suggestions will lie while the first is on its way: faint rows. */
export function WaitingRows(): React.JSX.Element {
  return (
    <div className="hub-waiting" aria-hidden>
      <span />
      <span />
    </div>
  )
}

