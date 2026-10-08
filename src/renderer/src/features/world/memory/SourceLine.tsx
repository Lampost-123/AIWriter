import { Check, PenLine, Sparkles } from '@/components/ui/icons'
import { useEffect, useRef, useState } from 'react'
import type { ID, MemoryStatus } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { checkAgainFailed } from '@/features/memory/logic'
import { showWords } from '@/features/memory/openScene'
import type { SourceNote } from '../memoryLogic'
import type { ScenePlace } from '../useSceneLabels'

/** Opens a scene in the writing view. */
export const openScene = (sceneId: ID, storyId?: ID | null): void => useApp.getState().selectScene(sceneId, storyId ?? undefined)

/** Words a fact was read from, to show in their scene (Jump to source, World Memory Overhaul B2). */
export interface WordsAt {
  quote: string
  paragraphId: string | null
}

/**
 * A scene's place as a quiet link that opens it ("Book 1, Ch 12, Sc 3"). Nothing while it isn't known. With `words`,
 * it opens the scene at those words, selected.
 */
export function PlaceLink({
  sceneId,
  place,
  label,
  storyId,
  words,
  className
}: {
  sceneId: ID
  place?: ScenePlace
  /** Overrides the place's label (a change's own "where"). */
  label?: string
  /** The scene's story, when known without the place. */
  storyId?: ID | null
  words?: WordsAt | null
  className?: string
}): React.JSX.Element | null {
  const text = label ?? place?.label
  if (!text) return null
  return (
    <button
      type="button"
      title={words ? 'Show these words in the scene' : 'Open this scene'}
      onClick={() => (words ? showWords(sceneId, words.quote, words.paragraphId) : openScene(sceneId, storyId ?? place?.storyId))}
      className={cn(
        'rounded-sm font-medium text-muted underline-offset-2 transition-colors duration-150 hover:text-accent hover:underline',
        className
      )}
    >
      {text}
    </button>
  )
}

/** The quoted words a fact came from, as a quiet link that shows them in the scene. */
export function QuoteLink({ sceneId, words, className }: { sceneId: ID; words: WordsAt; className?: string }): React.JSX.Element {
  return (
    <button
      type="button"
      title="Show these words in the scene"
      onClick={() => showWords(sceneId, words.quote, words.paragraphId)}
      className={cn(
        'min-w-0 truncate rounded-sm text-left font-serif italic text-muted underline-offset-2 transition-colors duration-150 hover:text-accent hover:underline',
        className
      )}
    >
      “{words.quote}”
    </button>
  )
}

/**
 * "(since edited)", for words a fact was read from that have been edited since: a link that shows where they were
 * (their paragraph, when the words themselves are gone), and "Check again now", which asks the memory to read that
 * scene again now (one read; World Memory Overhaul B2).
 */
export function EditedSince({ sceneId, words, className }: { sceneId: ID; words: WordsAt; className?: string }): React.JSX.Element {
  const [asked, setAsked] = useState(false)
  // The memory's status when it was asked: a read that fails leaves the words "since edited", and the button comes back
  // (it said "Checking…" for good otherwise).
  const status = useApp((s) => s.memoryStatus)
  const askedWith = useRef<MemoryStatus | null>(null)
  useEffect(() => {
    if (!asked) return
    const failed = checkAgainFailed(askedWith.current, status)
    if (!failed) return
    setAsked(false)
    // Its own words already say what went wrong ("The memory couldn't read …") and what to do.
    toast(failed)
  }, [asked, status])
  const checkAgain = async (): Promise<void> => {
    askedWith.current = useApp.getState().memoryStatus
    setAsked(true)
    try {
      await api.checkMemoryAgain(sceneId)
      toast('Checking again. The memory is reading that scene now.')
    } catch (e) {
      setAsked(false)
      toast(`The memory couldn't check again. ${plainReason(e)}`)
    }
  }
  const link = 'shrink-0 rounded-sm underline-offset-2 transition-colors duration-150 hover:text-accent hover:underline'
  return (
    <span className={cn('inline-flex shrink-0 items-baseline gap-1.5 font-sans not-italic', className)}>
      <button
        type="button"
        className={link}
        title="These words were edited after the memory read them. Show where they were."
        onClick={() => showWords(sceneId, words.quote, words.paragraphId)}
      >
        (since edited)
      </button>
      {asked ? (
        <span className="shrink-0 text-faint">Checking…</span>
      ) : (
        <button
          type="button"
          className={cn(link, 'font-medium text-accent')}
          title="Ask the memory to read that scene again now and see what the words say"
          onClick={() => void checkAgain()}
        >
          Check again now
        </button>
      )}
    </span>
  )
}

/**
 * A source note, or: its words are still loading (the line is kept free), it was read from the story
 * but has no words to show, or Adam has changed it since the page opened (the line stays, saying so).
 */
export type LineNote = SourceNote | { kind: 'loading' } | { kind: 'story' } | { kind: 'edited' }

/**
 * Where a fact came from, quietly, inline (it sits inside a field's hint): the words it was read from
 * and their scene (each a link to those words in the scene), "Those words were removed", "Drafted by AI",
 * or for Adam's own, "You wrote this" when `showAdam`. Renders nothing when there is nothing to say.
 */
export function SourceLine({
  note,
  places,
  showAdam = false,
  className
}: {
  note: LineNote | null
  places: Map<ID, ScenePlace> | null
  showAdam?: boolean
  className?: string
}): React.JSX.Element | null {
  if (!note || (note.kind === 'adam' && !showAdam)) return null
  const base = cn('inline-flex min-h-[18px] min-w-0 max-w-full items-baseline gap-1.5 text-[12px] text-faint', className)
  if (note.kind === 'loading') return <span className={base} aria-hidden />
  if (note.kind === 'story') return <span className={base}>Read from your story</span>
  if (note.kind === 'adam') {
    return (
      <span className={base}>
        <PenLine size={11} className="shrink-0 self-center" aria-hidden />
        You wrote this
      </span>
    )
  }
  if (note.kind === 'edited') {
    return (
      <span className={base}>
        <Check size={11} className="shrink-0 self-center" aria-hidden />
        Changed by you
      </span>
    )
  }
  if (note.kind === 'ai') {
    return (
      <span className={base}>
        <Sparkles size={11} className="shrink-0 self-center text-ai" aria-hidden />
        Drafted by AI
      </span>
    )
  }
  if (note.kind === 'gone') {
    const place = note.sceneId ? places?.get(note.sceneId) : undefined
    return (
      <span className={base}>
        <span>Those words were removed{place ? ' from' : ''}</span>
        {place && note.sceneId ? <PlaceLink sceneId={note.sceneId} place={place} /> : null}
      </span>
    )
  }
  const place = places?.get(note.sceneId)
  const words = { quote: note.quote, paragraphId: note.paragraphId }
  return (
    <span className={base}>
      <QuoteLink sceneId={note.sceneId} words={words} />
      {place ? (
        <>
          <span aria-hidden>·</span>
          <PlaceLink sceneId={note.sceneId} place={place} words={words} className="shrink-0" />
        </>
      ) : null}
      {note.changed ? <EditedSince sceneId={note.sceneId} words={words} /> : null}
      {note.more ? <span className="shrink-0">and {note.more} more</span> : null}
    </span>
  )
}
