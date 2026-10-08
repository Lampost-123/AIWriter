// The outline helper's suggestions as a tree: acts, the chapters in them, and their scene cards. Each
// one still waiting for a decision is amber, with Keep, Edit and Discard; a kept one turns plain with a
// tick. Keep on an act or chapter keeps what is inside it too, and keeping a scene keeps the chapter
// and act it needs. While the answer arrives, suggestions appear in order and the buttons keep their
// room; the one being written has the caret. A chapter's plan (`chapterId`) shows only that chapter's
// scene cards: the chapter itself is already in the story.
import { Check } from '@/components/ui/icons'
import { useLayoutEffect, useRef, useState } from 'react'
import type { Chapter, ID } from '@shared/types'
import { Button, Field, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { deleteChapter } from '@/features/binder/actions'
import { MarkLine, SuggestionButton } from '@/features/builder/parts'
import { Skeleton, useDelayed } from '@/features/generate/parts'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { discardSuggestion, keepSuggestions, saveEdit, type HelperRun } from './helperStore'
import { countNodes, lastNodeKey, totalOf, type NodeEdit, type NodeKind, type TreeNode } from './tree'

const KIND_LABELS: Record<NodeKind, string> = { act: 'Act', chapter: 'Chapter', scene: 'Scene' }
const TEXT_LABELS: Record<NodeKind, string> = { act: 'Purpose', chapter: 'Goal', scene: 'What happens' }
const TITLE_SIZES: Record<NodeKind, string> = { act: 'text-[18px]', chapter: 'text-[16px]', scene: 'text-[15px]' }

interface TreeProps {
  storyId: ID
  /** A chapter's plan: its session, and the chapter its scene cards go into. */
  chapterId?: ID | null
  run: HelperRun
  /** While the answer arrives: the suggestion being written now. */
  current: string | null
  editing: string | null
  setEditing: (key: string | null) => void
}

export function Suggestions({
  storyId,
  chapterId = null,
  run,
  tree,
  open,
  starter
}: {
  storyId: ID
  chapterId?: ID | null
  run: HelperRun
  tree: TreeNode[]
  /** How many suggestions are still waiting for a decision. */
  open: number
  /** The empty chapter the story was made with, still ahead of what was kept (see OutlineHelper). */
  starter: Chapter | null
}): React.JSX.Element {
  const running = run.status === 'running'
  // A chapter's plan lists the chapter's scene cards, not the chapter.
  const top = chapterId ? (tree[0]?.children ?? []) : tree
  const waiting = useDelayed(running && top.length === 0, 250)
  const [editing, setEditing] = useState<string | null>(null)
  const kept = totalOf(countNodes(top, run.decisions, 'kept'))
  const shown = top.filter((n) => run.decisions[n.key]?.status !== 'discarded')
  const decided = !running && open === 0 && top.length > 0
  const current = running ? lastNodeKey(tree) : null
  const starterTitle = starter?.title.trim() || 'Chapter 1'

  // Short, so it fits beside both buttons in a small window.
  const summary = running ? '' : open ? `${open} to decide${kept ? `, ${kept} kept` : ''}` : kept ? `${kept} kept` : ''

  return (
    <section aria-label="Suggestions" aria-busy={running} className="mt-5">
      {/* Stays at the top while the list scrolls, so "Keep all that's left" is always at hand, and so is
          removing the empty chapter the story was made with once something is kept after it. That one sits
          by the count, never where "Keep all that's left" was: a double click on that doesn't remove it. */}
      <div className="sticky top-0 z-10 -mx-3 flex h-11 items-center gap-3 bg-bg/95 px-3 backdrop-blur-sm">
        <h2 className="shrink-0 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Suggestions</h2>
        <span className="truncate text-[12px] tabular-nums text-faint">{summary}</span>
        {starter && !running ? (
          <Button
            size="sm"
            variant="ghost"
            className="-ml-1"
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
            className="ml-auto"
            onClick={() => void keepSuggestions(storyId, 'all', chapterId)}
            title={`Add every suggestion you haven't discarded to the ${chapterId ? 'chapter' : 'story'}`}
          >
            Keep all that’s left
          </Button>
        ) : null}
      </div>

      {top.length === 0 ? (
        <div aria-hidden className={cn('flex flex-col gap-3 transition-opacity duration-200', waiting ? 'opacity-100' : 'opacity-0')}>
          <Skeleton className="h-[74px] w-full rounded-lg" />
          <Skeleton className="ml-7 h-[62px] w-[calc(100%-1.75rem)] rounded-lg" />
          <Skeleton className="ml-14 h-[96px] w-[calc(100%-3.5rem)] rounded-lg" />
        </div>
      ) : (
        <div className="flex flex-col gap-3" data-suggestions>
          {shown.map((n) => (
            <NodeView
              key={n.key}
              node={n}
              storyId={storyId}
              chapterId={chapterId}
              run={run}
              current={current}
              editing={editing}
              setEditing={setEditing}
            />
          ))}
        </div>
      )}

      {decided ? <AllDecided run={run} tree={tree} storyId={storyId} kept={kept} chapter={!!chapterId} /> : null}
    </section>
  )
}

function NodeView({ node, ...props }: TreeProps & { node: TreeNode }): React.JSX.Element | null {
  const { run } = props
  const children = node.children.filter((c) => run.decisions[c.key]?.status !== 'discarded')
  return (
    <div
      role="group"
      aria-label={`${KIND_LABELS[node.kind]}: ${(run.edits[node.key] ?? node).title || 'Untitled'}`}
      data-suggestion={node.kind}
      data-key={node.key}
      data-state={run.decisions[node.key]?.status === 'kept' ? 'kept' : 'open'}
    >
      {props.editing === node.key ? <EditForm node={node} {...props} /> : <NodeBox node={node} {...props} />}
      {children.length ? (
        <div className="ml-3 mt-2 flex flex-col gap-2 border-l border-line pl-4">
          {children.map((c) => (
            <NodeView key={c.key} node={c} {...props} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function NodeBox({ node, storyId, chapterId, run, current, setEditing }: TreeProps & { node: TreeNode }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const decision = run.decisions[node.key]
  const kept = decision?.status === 'kept'
  const edit = run.edits[node.key]
  const words = edit ?? node
  const when = (edit?.when ?? node.when).trim()
  const running = run.status === 'running'
  // Only the suggestion arriving now has the caret, not the act and chapter it is in.
  const writing = running && node.key === current
  const title = words.title.trim()

  const focused = (): boolean => !!box.current?.contains(document.activeElement)
  const keep = (): void => {
    const from = focused() ? box.current : null
    void keepSuggestions(storyId, [node.key], chapterId).then(() => focusNext(from))
  }
  const discard = (): void => {
    if (focused()) focusNext(box.current, true)
    discardSuggestion(storyId, node.key, chapterId)
  }

  return (
    <div
      ref={box}
      data-box
      className={cn(
        'flex items-start gap-3 rounded-lg border px-3.5 py-2.5 transition-colors duration-150',
        kept ? 'border-line bg-surface' : 'border-ai/25 bg-ai-soft'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-h-[18px] items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
          {KIND_LABELS[node.kind]}
          {when ? (
            <span className="min-w-0 truncate font-normal normal-case tracking-normal" title="When it happens in the story" data-when>
              · {when}
            </span>
          ) : null}
          {edit && !kept ? (
            <span className="font-normal normal-case tracking-normal">
              <MarkLine mark="edited" />
            </span>
          ) : null}
        </div>
        <h3
          className={cn('mt-0.5 break-words font-serif font-semibold leading-snug text-fg', TITLE_SIZES[node.kind], !title && 'text-faint')}
        >
          {title || `Untitled ${node.kind}`}
          {writing && !words.text && !words.beats.length ? <Caret /> : null}
        </h3>
        {words.text ? (
          <p
            className={cn(
              'mt-1 whitespace-pre-wrap break-words leading-relaxed',
              node.kind === 'scene' ? 'text-[13.5px] text-fg' : 'text-[13px] text-muted'
            )}
          >
            {words.text}
            {writing && !words.beats.length ? <Caret /> : null}
          </p>
        ) : null}
        {words.beats.length ? (
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[12.5px] leading-relaxed text-muted marker:text-faint">
            {words.beats.map((b, i) => (
              <li key={i} className="break-words pl-0.5">
                {b}
                {writing && i === words.beats.length - 1 ? <Caret /> : null}
              </li>
            ))}
          </ol>
        ) : null}
        {/* The plot threads the scene sets up and pays off (2026-10-08): they go on its card when it is kept. */}
        {node.setsUp?.length || node.paysOff?.length ? (
          <p className="mt-1.5 break-words text-[12px] leading-relaxed text-faint" data-threads>
            {node.setsUp?.length ? <span>Sets up: {node.setsUp.join('; ')}</span> : null}
            {node.setsUp?.length && node.paysOff?.length ? <span> · </span> : null}
            {node.paysOff?.length ? <span>Pays off: {node.paysOff.join('; ')}</span> : null}
          </p>
        ) : null}
      </div>
      {kept ? (
        <div className="flex h-6 shrink-0 items-center gap-1.5">
          <span className="flex items-center gap-1 text-[12px] font-medium text-success" title="Added to the story">
            <Check size={13} aria-hidden />
            Kept
          </span>
          {node.kind === 'scene' && decision?.status === 'kept' ? (
            <SuggestionButton onClick={() => useApp.getState().selectScene(decision.id, storyId)} title="Open this scene to write it">
              Open
            </SuggestionButton>
          ) : null}
        </div>
      ) : (
        // While the answer arrives the buttons keep their room, so nothing moves when they appear.
        <div className={cn('flex shrink-0 items-center gap-0.5', running && 'invisible')} aria-hidden={running || undefined}>
          <SuggestionButton
            primary
            data-keep
            onClick={keep}
            title={KEEP_TITLES[node.kind]}
            aria-label={`Keep ${title ? `“${title}”` : `this ${node.kind}`}`}
          >
            Keep
          </SuggestionButton>
          <SuggestionButton
            data-edit
            onClick={() => setEditing(node.key)}
            aria-label={`Edit ${title ? `“${title}”` : `this ${node.kind}`}`}
          >
            Edit
          </SuggestionButton>
          <SuggestionButton
            onClick={discard}
            title="Leave this out. Undo brings it back."
            aria-label={`Discard ${title ? `“${title}”` : `this ${node.kind}`}`}
          >
            Discard
          </SuggestionButton>
        </div>
      )}
    </div>
  )
}

const KEEP_TITLES: Record<NodeKind, string> = {
  act: 'Add this act to the story, with the chapters and scenes in it',
  chapter: 'Add this chapter to the story, with its scenes (and its act, if that isn’t added yet)',
  scene: 'Add this scene to the story with its card filled in (and its chapter, if that isn’t added yet)'
}

/**
 * After Keep or Discard from the keyboard, it carries on at the next suggestion still waiting (or the one
 * before). `leaving`: the suggestion is about to go (Discard), so the next one is picked first.
 */
function focusNext(from: HTMLElement | null, leaving = false): void {
  if (!from) return
  const list = from.closest('[data-suggestions]')
  const group = from.closest('[data-key]')
  const pick = (): HTMLElement | null => {
    const buttons = [...(list?.querySelectorAll<HTMLElement>('[data-keep]') ?? [])].filter(
      (b) => b.closest('[data-key]')?.getAttribute('data-state') === 'open' && !(leaving && group?.contains(b))
    )
    const after = buttons.find((b) => !!(from.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING))
    return after ?? buttons.filter((b) => !!(from.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING)).pop() ?? null
  }
  if (leaving) {
    const next = pick()
    requestAnimationFrame(() => next?.isConnected && next.focus())
  } else requestAnimationFrame(() => pick()?.focus())
}

function EditForm({ node, storyId, chapterId, run, setEditing }: TreeProps & { node: TreeNode }): React.JSX.Element {
  const words = run.edits[node.key] ?? node
  const [title, setTitle] = useState(words.title)
  const [text, setText] = useState(words.text)
  const [beats, setBeats] = useState(words.beats.join('\n'))
  const [when, setWhen] = useState(run.edits[node.key]?.when ?? node.when)
  const form = useRef<HTMLDivElement>(null)
  const noun = node.kind

  // The keyboard goes back to the suggestion's Edit button when the form closes.
  const close = (): void => {
    const group = form.current?.closest<HTMLElement>('[data-key]')
    setEditing(null)
    requestAnimationFrame(() => group?.querySelector<HTMLElement>(':scope > [data-box] [data-edit]')?.focus())
  }
  const save = (): void => {
    const edit: NodeEdit = {
      title: title.trim() || words.title,
      text: text.trim(),
      beats: beats
        .split('\n')
        .map((b) => b.trim())
        .filter(Boolean)
    }
    if (node.kind === 'scene') edit.when = when.replace(/\s+/g, ' ').trim()
    saveEdit(storyId, node.key, edit, chapterId)
    close()
  }

  useLayoutEffect(() => {
    form.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  return (
    <div
      ref={form}
      role="form"
      aria-label={`Edit the ${noun}`}
      className="rounded-lg border border-accent/40 bg-surface px-3.5 py-3 shadow-soft"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          close()
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          save()
        }
      }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{KIND_LABELS[node.kind]}</div>
      <div className="mt-1.5 flex flex-col gap-3">
        <Field label="Title">
          {(id) => (
            <Input
              id={id}
              autoFocus
              value={title}
              className="font-serif text-[14.5px]"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  save()
                }
              }}
            />
          )}
        </Field>
        <Field label={TEXT_LABELS[node.kind]}>
          {(id) => <AutoTextarea id={id} value={text} minRows={2} maxRows={8} onChange={(e) => setText(e.target.value)} />}
        </Field>
        {node.kind === 'scene' ? (
          <Field label="Beats" hint="One a line, in order.">
            {(id) => <AutoTextarea id={id} value={beats} minRows={3} maxRows={12} onChange={(e) => setBeats(e.target.value)} />}
          </Field>
        ) : null}
        {node.kind === 'scene' ? (
          <Field
            label="When"
            hint="When it happens in the story, such as “Day 2, evening”. Left empty, it takes the day of the scene before."
          >
            {(id) => (
              <Input
                id={id}
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    save()
                  }
                }}
              />
            )}
          </Field>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={save}>
            Save changes
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Every suggestion is decided: what was kept is in the binder, and one click starts writing it. */
function AllDecided({
  run,
  tree,
  storyId,
  kept,
  chapter
}: {
  run: HelperRun
  tree: TreeNode[]
  storyId: ID
  kept: number
  chapter: boolean
}): React.JSX.Element {
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
      <p className="mt-4 text-[13px] text-muted animate-fade-in">
        {chapter
          ? 'You discarded every scene card. Interview again or suggest again for new ones.'
          : 'You discarded every suggestion. Change the premise or how much to suggest, then suggest again for new ones.'}
      </p>
    )
  }
  return (
    <div role="status" className="mt-5 rounded-lg border border-success/30 bg-success-soft px-4 py-3 animate-fade-in">
      <div className="flex items-center gap-3">
        <Check size={16} className="shrink-0 text-success" aria-hidden />
        <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-fg">
          Everything is decided. What you kept is in the binder{sceneId ? ', with each scene’s card filled in' : ''}.
        </p>
        {sceneId ? (
          <Button size="sm" onClick={() => useApp.getState().selectScene(sceneId, storyId)}>
            Start writing
          </Button>
        ) : null}
      </div>
    </div>
  )
}

const Caret = (): React.JSX.Element => <span aria-hidden className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-ai" />
