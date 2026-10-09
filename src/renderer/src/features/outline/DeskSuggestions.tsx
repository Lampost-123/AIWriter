// The outline helper's suggestions on the desk (UI overhaul, "the AI planning pages"): the same acts, chapters and scene
// cards, with the same Keep, Edit and Discard (helperStore), laid out as things on the desk. An act is a band with its
// numeral, a chapter a header strip, and the chapter's scenes index cards in a grid under it, each with its ruled lines
// and red margin rule, amber at its edge while it is the AI's to decide. Cards are dealt in as they arrive; the one
// being written has the lamp's caret and its words fade in. Keep stamps it Kept and a copy of the card flies to its
// place in the story's spine; Undo flies it back. Discard puts it away (140ms). Over the cards, the tray: what is on the
// desk, what Keep all that's left would add and where, and its buttons. A chapter's plan shows only its scene cards.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Chapter, ID } from '@shared/types'
import { numberWords } from '@shared/numberWords'
import { Check, Sparkles } from '@/components/ui/icons'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { deleteChapter } from '@/features/binder/actions'
import { keyboardDriven, reducedMotion } from '@/features/look/motion'
import { MarkLine } from '@/features/builder/parts'
import { FreshText } from '@/features/planning/FreshText'
import { WaitingCards } from '@/features/planning/LampThinking'
import { useDealDelay } from '@/features/planning/deal'
import { flyCard, landingOf, landingSoon } from '@/features/planning/fly'
import { discardSuggestion, keepSuggestions, type HelperRun } from './helperStore'
import { EditForm, focusNext, KEEP_TITLES, KIND_LABELS, type TreeProps } from './Suggestions'
import { countLine, countNodes, lastNodeKey, totalOf, type Counts, type TreeNode } from './tree'

export function DeskSuggestions({
  storyId,
  chapterId = null,
  run,
  tree,
  open,
  starter,
  landing
}: {
  storyId: ID
  chapterId?: ID | null
  run: HelperRun
  tree: TreeNode[]
  open: number
  starter: Chapter | null
  landing: string | null
}): React.JSX.Element {
  const running = run.status === 'running'
  // A chapter's plan lists the chapter's scene cards, not the chapter.
  const top = chapterId ? (tree[0]?.children ?? []) : tree
  const [editing, setEditing] = useState<string | null>(null)
  const keptCounts = countNodes(top, run.decisions, 'kept')
  const kept = totalOf(keptCounts)
  const openCounts = countNodes(top, run.decisions, 'open')
  const shown = top.filter((n) => run.decisions[n.key]?.status !== 'discarded')
  const decided = !running && open === 0 && top.length > 0
  const current = running ? lastNodeKey(tree) : null
  const starterTitle = starter?.title.trim() || 'Chapter 1'
  const props: TreeProps = { storyId, chapterId, run, current, editing, setEditing }
  // Acts, or chapters numbered from one.
  const scenesOnly = top.every((n) => n.kind === 'scene')

  return (
    <section aria-label="Suggestions" aria-busy={running} className="plan-suggestions">
      <div className="plan-tray">
        <h2 className="plan-tray-t">{chapterId ? 'Scene cards' : 'Suggestions'}</h2>
        <div className="plan-counts" aria-live="polite">
          <CountChips counts={openCounts} />
          {kept ? (
            <span className="plan-count is-kept">
              <Check size={12} aria-hidden />
              <b>{kept}</b> kept
            </span>
          ) : null}
        </div>
        <div className="plan-tray-end">
          {starter && !running ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void deleteChapter(starter.id, { stay: true })}
              title={`The story still starts with “${starterTitle}”, the empty chapter it was made with, ahead of what you kept. Undo brings it back.`}
            >
              Remove the empty “{starterTitle}”
            </Button>
          ) : null}
          {!running && open > 0 ? (
            <Button
              size="sm"
              icon={<Check size={13} />}
              onClick={() => void keepSuggestions(storyId, 'all', chapterId)}
              title={`Add every suggestion you haven't discarded to the ${chapterId ? 'chapter' : 'story'}`}
            >
              Keep all that’s left
            </Button>
          ) : null}
        </div>
        {!running && open > 0 ? (
          <p className="w-full text-[12.5px] leading-[18px] text-muted" data-plan-receipt>
            Keep all that’s left adds <b className="font-semibold text-fg">{countLine(openCounts).replace(/\bscenes?\b/, (w) => (w === 'scene' ? 'scene card' : 'scene cards'))}</b>{' '}
            {chapterId ? 'to this chapter' : 'to the story'}, each scene’s card filled in.{landing ? ` ${landing}` : ''}
          </p>
        ) : null}
      </div>

      {top.length === 0 ? (
        <WaitingCards count={3} label={chapterId ? 'The scene cards lie here as they arrive.' : 'The outline lies here as it arrives.'} />
      ) : scenesOnly ? (
        <div className="plan-scenes mt-4" data-suggestions>
          {shown.map((n) => (
            <DeskNode key={n.key} node={n} {...props} />
          ))}
        </div>
      ) : (
        <div className="plan-tree" data-suggestions>
          {shown.map((n, i) => (
            <DeskNode key={n.key} node={n} n={i} {...props} />
          ))}
        </div>
      )}

      {decided ? <DeskAllDecided run={run} tree={tree} storyId={storyId} kept={kept} chapter={!!chapterId} /> : null}
    </section>
  )
}

/** "2 acts · 3 chapters · 9 scene cards" still to decide, in amber (the AI's). */
function CountChips({ counts }: { counts: Counts }): React.JSX.Element | null {
  const parts: [number, string, string][] = [
    [counts.acts, 'act', 'acts'],
    [counts.chapters, 'chapter', 'chapters'],
    [counts.scenes, 'scene card', 'scene cards']
  ]
  const shown = parts.filter(([n]) => n > 0)
  if (!shown.length) return null
  return (
    <>
      {shown.map(([n, one, many]) => (
        <span key={one} className="plan-count is-ai">
          <b>{n}</b> {n === 1 ? one : many}
        </span>
      ))}
      <span className="self-center text-[12px] text-faint">to decide</span>
    </>
  )
}

function DeskNode({ node, n = 0, ...props }: TreeProps & { node: TreeNode; n?: number }): React.JSX.Element {
  const { run } = props
  const children = node.children.filter((c) => run.decisions[c.key]?.status !== 'discarded')
  const kept = run.decisions[node.key]?.status === 'kept'
  const title = (run.edits[node.key] ?? node).title || 'Untitled'
  const group = {
    role: 'group',
    'aria-label': `${KIND_LABELS[node.kind]}: ${title}`,
    'data-suggestion': node.kind,
    'data-key': node.key,
    'data-state': kept ? 'kept' : 'open'
  } as const
  const editing = props.editing === node.key
  if (node.kind === 'scene') {
    return <div {...group}>{editing ? <EditForm node={node} {...props} className="plan-edit" /> : <Card node={node} {...props} />}</div>
  }
  const kids = children.length ? (
    node.kind === 'act' ? (
      <div className="plan-act-kids">
        {children.map((c, i) => (
          <DeskNode key={c.key} node={c} n={i} {...props} />
        ))}
      </div>
    ) : (
      <div className="plan-scenes">
        {children.map((c) => (
          <DeskNode key={c.key} node={c} {...props} />
        ))}
      </div>
    )
  ) : null
  return (
    <div {...group} className={node.kind === 'act' ? 'plan-act' : 'plan-chap'}>
      {editing ? <EditForm node={node} {...props} className="plan-edit" /> : <Card node={node} n={n} {...props} />}
      {kids}
    </div>
  )
}

/** One suggestion: a scene's index card, or the header of a chapter or an act. */
function Card({ node, n = 0, storyId, chapterId, run, current, setEditing }: TreeProps & { node: TreeNode; n?: number }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const deal = useDealDelay()
  const decision = run.decisions[node.key]
  const kept = decision?.status === 'kept'
  const edit = run.edits[node.key]
  const words = edit ?? node
  const when = (edit?.when ?? node.when).trim()
  const running = run.status === 'running'
  const writing = running && node.key === current
  const title = words.title.trim()
  const [leaving, setLeaving] = useState(false)
  const [back, setBack] = useState(false)
  // Kept by its own Keep: where the card was, so a copy of it flies to the story.
  const flying = useRef<DOMRect | null>(null)
  const was = useRef(decision?.status)

  // Kept by this card's Keep: a copy flies to its row in the spine. Undo (kept again open): it flies back.
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
    void keepSuggestions(storyId, [node.key], chapterId).then(() => focusNext(from))
  }
  const discard = (): void => {
    if (focused()) focusNext(box.current, true)
    if (reducedMotion() || keyboardDriven()) return discardSuggestion(storyId, node.key, chapterId)
    setLeaving(true)
    setTimeout(() => discardSuggestion(storyId, node.key, chapterId), 140)
  }

  const head = node.kind !== 'scene'
  const caps =
    node.kind === 'act' ? `Act ${numberWords(n + 1)}` : node.kind === 'chapter' ? 'Chapter' : KIND_LABELS[node.kind]
  const body = (
    <>
      <div className="plan-ic-kind">
        {kept ? null : <Sparkles size={11} aria-hidden />}
        <span>{caps}</span>
        {when ? (
          <span className="plan-ic-when" title="When it happens in the story" data-when>
            · {when}
          </span>
        ) : null}
        {edit && !kept ? (
          <span className="font-normal normal-case tracking-normal">
            <MarkLine mark="edited" />
          </span>
        ) : null}
      </div>
      <h3 className={cn('plan-ic-title', !title && 'text-faint')}>
        {title ? <FreshText text={title} live={running} /> : `Untitled ${node.kind}`}
        {writing && !words.text && !words.beats.length ? <span className="plan-caret" aria-hidden /> : null}
      </h3>
      {words.text ? (
        <p className="plan-ic-text">
          <FreshText text={words.text} live={running} />
          {writing && !words.beats.length ? <span className="plan-caret" aria-hidden /> : null}
        </p>
      ) : null}
      {words.beats.length ? (
        <ol className="plan-ic-beats mt-1">
          {words.beats.map((b, i) => (
            <li key={i} className="break-words pl-0.5">
              <FreshText text={b} live={running} />
              {writing && i === words.beats.length - 1 ? <span className="plan-caret" aria-hidden /> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {node.setsUp?.length || node.paysOff?.length ? (
        <p className="plan-ic-threads" data-threads>
          {node.setsUp?.length ? <span>Sets up: {node.setsUp.join('; ')}</span> : null}
          {node.setsUp?.length && node.paysOff?.length ? <span> · </span> : null}
          {node.paysOff?.length ? <span>Pays off: {node.paysOff.join('; ')}</span> : null}
        </p>
      ) : null}
    </>
  )
  const actions = kept ? (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="plan-kept" title="Added to the story">
        <Check size={13} aria-hidden />
        Kept
      </span>
      {node.kind === 'scene' && decision?.status === 'kept' ? (
        <button type="button" className="plan-txt" onClick={() => useApp.getState().selectScene(decision.id, storyId)} title="Open this scene to write it">
          Open
        </button>
      ) : null}
    </div>
  ) : (
    // While the answer arrives the buttons keep their room, so nothing moves when they appear.
    <div className={cn('flex shrink-0 items-center gap-1', running && 'invisible')} aria-hidden={running || undefined}>
      <button type="button" className="plan-keep" data-keep onClick={keep} title={KEEP_TITLES[node.kind]} aria-label={`Keep ${title ? `“${title}”` : `this ${node.kind}`}`}>
        <Check size={13} aria-hidden />
        Keep
      </button>
      <button type="button" className="plan-txt" data-edit onClick={() => setEditing(node.key)} aria-label={`Edit ${title ? `“${title}”` : `this ${node.kind}`}`}>
        Edit
      </button>
      <button type="button" className="plan-txt" onClick={discard} title="Leave this out. Undo brings it back." aria-label={`Discard ${title ? `“${title}”` : `this ${node.kind}`}`}>
        Discard
      </button>
    </div>
  )

  if (head) {
    return (
      <div
        ref={box}
        data-box
        style={deal}
        className={cn(
          node.kind === 'act' ? 'plan-act-head' : 'plan-chap-head',
          'plan-deal',
          kept && 'is-kept',
          writing && 'is-writing',
          leaving && 'is-leaving',
          back && 'is-back'
        )}
      >
        {node.kind === 'act' ? <span className="plan-numeral">{toRoman(n + 1)}</span> : null}
        <div className="plan-head-body">{body}</div>
        <div className="plan-head-actions">{actions}</div>
      </div>
    )
  }
  return (
    <div ref={box} data-box style={deal} className={cn('plan-icard plan-deal', kept && 'is-kept', writing && 'is-writing', leaving && 'is-leaving', back && 'is-back')}>
      {body}
      <div className="plan-ic-actions">{actions}</div>
    </div>
  )
}

const toRoman = (n: number): string => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][n - 1] ?? String(n)

/** Every suggestion is decided: what was kept is in the story, and one click starts writing it. */
function DeskAllDecided({ run, tree, storyId, kept, chapter }: { run: HelperRun; tree: TreeNode[]; storyId: ID; kept: number; chapter: boolean }): React.JSX.Element {
  const firstScene = (nodes: TreeNode[]): ID | null => {
    for (const n of nodes) {
      const d = run.decisions[n.key]
      if (n.kind === 'scene' && d?.status === 'kept') return d.id
      const inner = firstScene(n.children)
      if (inner) return inner
    }
    return null
  }
  const sceneId = firstScene(tree)
  if (!kept) {
    return (
      <p className="mt-6 text-[13px] text-muted animate-fade-in">
        {chapter
          ? 'You discarded every scene card. Interview again or suggest again for new ones.'
          : 'You discarded every suggestion. Change the premise or how much to suggest, then suggest again for new ones.'}
      </p>
    )
  }
  return (
    <div role="status" className="plan-all-done animate-fade-in">
      <Check size={17} className="shrink-0 text-success" aria-hidden />
      <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-fg">
        Everything is decided. What you kept is in the story’s spine{sceneId ? ', with each scene’s card filled in' : ''}.
      </p>
      {sceneId ? (
        <Button size="sm" variant="primary" onClick={() => useApp.getState().selectScene(sceneId, storyId)}>
          Start writing
        </Button>
      ) : null}
    </div>
  )
}
