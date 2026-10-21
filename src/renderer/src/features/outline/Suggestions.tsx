// The parts of the outline helper's suggestions that Build with AI's rows use (planHub/LineSuggestions.tsx): which
// suggestion is being written, whose buttons wait, where the keyboard goes after Keep or Discard, and Edit, every part
// of a suggestion as it would go into the story (SuggestionParts.tsx). The suggestion screens that once lived here are
// gone (review #37, 2026-10-21).
import { useLayoutEffect, useRef, useState } from 'react'
import type { ID } from '@shared/types'
import { Button, Field, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { saveEdit, type HelperRun } from './helperStore'
import { emptySuggestedCard, type SuggestedCard } from './parse'
import { CardFields } from './SuggestionParts'
import { arrivingKey, isUnder } from './stages'
import { lastNodeKey, wordsOf, type NodeEdit, type NodeKind, type TreeNode } from './tree'

export const KIND_LABELS: Record<NodeKind, string> = { act: 'Act', chapter: 'Chapter', scene: 'Scene' }
const TEXT_LABELS: Record<NodeKind, string> = { act: 'Purpose', chapter: 'Goal', scene: 'What happens' }

export interface TreeProps {
  storyId: ID
  /** A chapter's plan: its session, and the chapter its scene cards go into. */
  chapterId?: ID | null
  run: HelperRun
  /** While the answer arrives: the suggestion being written now. */
  current: string | null
  editing: string | null
  setEditing: (key: string | null) => void
  /**
   * An earlier batch (under "Earlier suggestions"): its Keep, Edit and Discard work on it by its task id, and it can't be
   * done again (Redo works on the newest suggestions, as the talk does).
   */
  earlier?: boolean
}

/** The task id of the batch the suggestions are in, when it isn't the newest (for the store's calls). */
export const runIdOf = (p: Pick<TreeProps, 'run' | 'earlier'>): string | null => (p.earlier ? p.run.taskId : null)

/** The suggestion being written now: the outline's last, or the last of a stage arriving under its act or chapter. */
export function currentOf(run: HelperRun, tree: TreeNode[]): string | null {
  if (run.status === 'running') return lastNodeKey(tree)
  return run.stage?.status === 'running' ? arrivingKey(tree, run.stage.key) : null
}

/** Its buttons wait (keeping their room): the outline is arriving, or a stage under it, inside it or around it. */
export function waitsFor(run: HelperRun, key: string): boolean {
  if (run.status === 'running') return true
  const st = run.stage
  return st?.status === 'running' && (isUnder(key, st.key) || isUnder(st.key, key))
}

export const KEEP_TITLES: Record<NodeKind, string> = {
  act: 'Add this act to the story, with the chapters and scenes in it',
  chapter: 'Add this chapter to the story, with its scenes (and its act, if that isn’t added yet)',
  scene: 'Add this scene to the story with its card filled in (and its chapter, if that isn’t added yet)'
}

/**
 * After Keep or Discard from the keyboard, it carries on at the next suggestion still waiting (or the one
 * before). `leaving`: the suggestion is about to go (Discard), so the next one is picked first.
 */
export function focusNext(from: HTMLElement | null, leaving = false): void {
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

/**
 * Edit: every part of a suggestion, as it would go into the story (2026-10-19): its title and words, a scene's beats and
 * When, and its card (a chapter's point of view, characters, location, When and mood; where a scene differs from its
 * chapter) and a scene's plot threads, with the codex's people, places and threads to pick from.
 */
export function EditForm({ node, storyId, chapterId, run, setEditing, earlier, className }: TreeProps & { node: TreeNode; className?: string }): React.JSX.Element {
  const words = wordsOf(node, run.edits[node.key])
  const [title, setTitle] = useState(words.title)
  const [text, setText] = useState(words.text)
  const [beats, setBeats] = useState(words.beats.join('\n'))
  const [when, setWhen] = useState(words.when)
  const [card, setCard] = useState<SuggestedCard>(() => ({ ...emptySuggestedCard(), ...words.card }))
  const [setsUp, setSetsUp] = useState(words.setsUp)
  const [paysOff, setPaysOff] = useState(words.paysOff)
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
    if (node.kind === 'scene') {
      edit.when = when.replace(/\s+/g, ' ').trim()
      edit.setsUp = setsUp
      edit.paysOff = paysOff
    }
    if (node.kind !== 'act') {
      const one = (v: string): string => v.replace(/\s+/g, ' ').trim()
      edit.card = { pov: one(card.pov), characters: card.characters.map(one).filter(Boolean), location: one(card.location), when: node.kind === 'chapter' ? one(card.when) : '', mood: one(card.mood) }
    }
    saveEdit(storyId, node.key, edit, chapterId, runIdOf({ run, earlier }))
    close()
  }
  const enter = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      save()
    }
  }

  useLayoutEffect(() => {
    form.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  return (
    <div
      ref={form}
      role="form"
      aria-label={`Edit the ${noun}`}
      className={cn('rounded-lg border border-accent/40 bg-surface px-3.5 py-3 shadow-soft', className)}
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
          {(id) => <Input id={id} autoFocus value={title} className="font-serif text-[14.5px]" onChange={(e) => setTitle(e.target.value)} onKeyDown={enter} />}
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
            {(id) => <Input id={id} value={when} onChange={(e) => setWhen(e.target.value)} onKeyDown={enter} />}
          </Field>
        ) : null}
        {node.kind !== 'act' ? (
          <CardFields
            kind={node.kind}
            card={card}
            onCard={(patch) => setCard((c) => ({ ...c, ...patch }))}
            setsUp={setsUp}
            onSetsUp={setSetsUp}
            paysOff={paysOff}
            onPaysOff={setPaysOff}
            onEnter={save}
          />
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

