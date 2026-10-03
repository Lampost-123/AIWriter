// Writing by hand: the scene's word count in the top bar, and what clicking it shows. The counts for the words
// selected, the scene, its chapter and the story (with pages and reading time at 250 words each), then today:
// words typed, AI words kept, the daily target and the streak. Chapter and story come from the outline's saved
// counts, with the open scene as it is now.
import * as P from '@radix-ui/react-popover'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { countWords } from '@shared/defaults'
import { useOutline } from '@/features/binder/outlineStore'
import { PopoverPanel } from '@/features/generate/parts'
import { dayOf, sizeNote, streakNote, streakOf, wordsLabel } from './goalLogic'
import { useGoals } from './goalStore'

/** Words selected in the page now (0 with nothing selected), kept current while the panel is open. */
function useSelectedWords(open: boolean): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!open) return
    const editor = editorBridge()?.editor
    if (!editor) return setN(0)
    const read = (): void => {
      const { from, to, empty } = editor.state.selection
      setN(empty ? 0 : countWords(editor.state.doc.textBetween(from, to, ' ', ' ')))
    }
    read()
    editor.on('selectionUpdate', read)
    return () => {
      editor.off('selectionUpdate', read)
    }
  }, [open])
  return n
}

function CountRow({ label, words }: { label: string; words: number }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-right">
        <span className="text-[13px] font-medium tabular-nums text-fg">{wordsLabel(words)}</span>
        <span className="block text-[11.5px] text-faint">{sizeNote(words)}</span>
      </span>
    </div>
  )
}

function Today(): React.JSX.Element {
  const daily = useApp((s) => s.settings?.goals?.daily ?? null)
  const navigate = useApp((s) => s.navigate)
  const days = useGoals((s) => s.days) ?? []
  const today = useGoals((s) => s.today)
  const day = dayOf(days, today)
  const typed = Math.max(0, day.typed)
  const streak = streakNote(streakOf(days, daily, today))
  const share = daily ? Math.min(1, typed / daily) : 0
  return (
    <div>
      <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">Today</h3>
      <div className="mt-1.5 flex items-baseline justify-between gap-4">
        <span className="text-[13px] text-muted">Typed</span>
        <span className="text-[13px] font-medium tabular-nums text-fg">
          {daily ? `${typed.toLocaleString()} of ${wordsLabel(daily)}` : wordsLabel(typed)}
        </span>
      </div>
      {daily ? (
        <div
          role="progressbar"
          aria-label="Today’s target"
          aria-valuemin={0}
          aria-valuemax={daily}
          aria-valuenow={Math.min(typed, daily)}
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"
        >
          <div
            className={cn('h-full rounded-full transition-[width] duration-200', share >= 1 ? 'bg-success' : 'bg-accent')}
            style={{ width: `${Math.round(share * 100)}%` }}
          />
        </div>
      ) : null}
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <span className="text-[13px] text-muted">AI words kept</span>
        <span className="text-[13px] font-medium tabular-nums text-ai">{wordsLabel(day.ai)}</span>
      </div>
      {streak ? (
        <p className={cn('mt-2 text-[12.5px]', streakOf(days, daily, today)?.todayMet ? 'text-success' : 'text-muted')}>{streak}</p>
      ) : (
        <button
          type="button"
          onClick={() => navigate({ kind: 'settings', tab: 'editor' })}
          className="mt-2 rounded text-[12.5px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          Set a daily target
        </button>
      )}
    </div>
  )
}

const openers = new Set<() => void>()

/** Opens the word counts (the command palette's "Word counts and today's writing"). */
export function openWordCounts(): void {
  for (const open of openers) open()
}

/** The scene's word count in the top bar; click for the counts and today's writing. */
export function WordCountButton(): React.JSX.Element {
  const words = useApp((s) => s.sceneWords)
  const sceneId = useApp((s) => s.sceneId)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const show = (): void => setOpen(true)
    openers.add(show)
    return () => void openers.delete(show)
  }, [])
  const { outline } = useOutline()
  const selected = useSelectedWords(open)
  const scenes = outline?.scenes ?? []
  const here = scenes.find((s) => s.id === sceneId)
  const live = (id: string, saved: number): number => (id === sceneId ? words : saved)
  const chapter = here ? scenes.filter((s) => s.chapterId === here.chapterId).reduce((n, s) => n + live(s.id, s.wordCount), 0) : null
  const story = outline ? scenes.reduce((n, s) => n + live(s.id, s.wordCount), 0) + (here || !sceneId ? 0 : words) : null

  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Trigger
        title="Word counts and today’s writing"
        // A click leaves the caret (and any selection) in the page.
        onMouseDown={(e) => e.preventDefault()}
        className="-ml-1 mr-2 shrink-0 whitespace-nowrap rounded px-1 text-[12px] tabular-nums text-faint outline-none transition-colors duration-150 hover:text-muted focus-visible:ring-2 focus-visible:ring-accent/40 data-[state=open]:text-fg"
      >
        {words.toLocaleString()} words
      </P.Trigger>
      <PopoverPanel
        className="w-[300px]"
        // The caret (and any selection) stays in the page while the counts show.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div aria-label="Word counts" role="group">
          {selected > 0 ? <CountRow label="Selection" words={selected} /> : null}
          {sceneId ? <CountRow label="Scene" words={words} /> : null}
          {chapter !== null ? <CountRow label="Chapter" words={chapter} /> : null}
          {story !== null ? <CountRow label="Story" words={story} /> : null}
        </div>
        <div className="my-3 h-px bg-line" />
        <Today />
      </PopoverPanel>
    </P.Root>
  )
}
