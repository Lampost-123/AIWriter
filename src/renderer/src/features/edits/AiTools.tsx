// The AI tools in the bar over selected words (features/editor/selection/SelectionLayer.tsx): one
// "Rewrite" button that opens a small menu with a box to say how, the quick tools (Expand, Condense, More
// vivid, Change tone, Fix voice when the words have dialogue, Alternatives) and Continue after the
// words. Each starts a tracked change in the page (session.ts). Owned by the AI edits part.
import * as P from '@radix-ui/react-popover'
import type { Editor } from '@tiptap/core'
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Drama,
  FoldVertical,
  Layers,
  MessageSquareQuote,
  Palette,
  PenLine,
  UnfoldVertical,
  WandSparkles
} from '@/components/ui/icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import { hasDialogue } from '@shared/contracts/edits'
import type { EditTool } from '@shared/types'
import { IconButton, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { editorBridge } from '@/lib/editorBridge'
import { markWords, startTool, waitingSuggestion } from './session'

/** The tones offered with a click; any other can be typed. */
const TONES = ['Tense', 'Warm', 'Cold', 'Playful', 'Dark', 'Gentle', 'Formal', 'Casual']

export function AiTools({
  editor,
  from,
  to,
  text,
  onOpenChange
}: {
  editor: Editor
  /** The selected words, as the bar has them. */
  from: number
  to: number
  text: string
  /** The menu opened or closed (the bar stays while it's open). */
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<'main' | 'tone'>('main')
  const [instruction, setInstruction] = useState('')
  const [tone, setTone] = useState('')
  /** Continue's optional "what happens next" (Adam, 2026-10-08): said last to the writer when filled. */
  const [next, setNext] = useState('')
  /** Why the tools can't start now (a change waiting, a draft writing), or null. */
  const [blocked, setBlocked] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const toneRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const dialogue = useMemo(() => hasDialogue(text), [text])
  const openRef = useRef(false)
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange

  // The bar went while the menu was open (another scene, another page): the words are no longer marked.
  useEffect(
    () => () => {
      if (!openRef.current) return
      markWords(null)
      onOpenChangeRef.current(false)
    },
    []
  )

  const change = (next: boolean): void => {
    openRef.current = next
    setOpen(next)
    onOpenChange(next)
    if (next) {
      setPage('main')
      setBlocked(
        waitingSuggestion()
          ? 'Accept or reject the AI’s waiting change first.'
          : editorBridge()?.busy()
            ? 'A draft is being written into this scene. Wait for it to finish first.'
            : null
      )
      markWords({ from, to })
    } else markWords(null)
  }

  /**
   * Runs a tool on the selected words (the menu closes first, and the page has the keyboard again).
   * Continue carries on after their last word.
   */
  const run = (tool: EditTool, direction?: string): void => {
    change(false)
    void startTool(tool, { direction })
  }

  /** Up and down move through the menu, as in any menu. */
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = [...(contentRef.current?.querySelectorAll<HTMLElement>('input, [data-tool]:not(:disabled)') ?? [])]
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLElement)
    e.preventDefault()
    items[i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus()
  }

  const off = !!blocked
  return (
    <P.Root open={open} onOpenChange={change}>
      <P.Trigger asChild>
        <button
          type="button"
          aria-expanded={open}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-fg transition-colors duration-150 hover:bg-surface-2',
            open && 'bg-surface-2'
          )}
        >
          <WandSparkles size={14} className="text-ai" aria-hidden />
          Rewrite
        </button>
      </P.Trigger>
      <P.Portal>
        <P.Content
          ref={contentRef}
          data-ai-tools=""
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            if (!off) inputRef.current?.focus()
            else contentRef.current?.focus()
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            if (!editor.isDestroyed) editor.view.focus()
          }}
          // Esc goes back from the tones, then closes the menu (the words stay selected).
          onEscapeKeyDown={(e) => {
            if (page === 'tone') {
              e.preventDefault()
              setPage('main')
              requestAnimationFrame(() => inputRef.current?.focus())
            }
          }}
          // A press in the menu belongs to the menu, never to the page below.
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
          tabIndex={-1}
          className="z-50 w-[316px] rounded-xl border border-line bg-surface p-1.5 font-sans shadow-pop focus:outline-none data-[state=open]:animate-pop-in"
        >
          {blocked ? (
            <p className="mx-1 mb-1.5 mt-0.5 rounded-md bg-ai-soft px-2.5 py-2 text-[12.5px] leading-relaxed text-fg">{blocked}</p>
          ) : null}
          {page === 'main' ? (
            <>
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (instruction.trim() && !off) run('rewrite', instruction.trim())
                }}
              >
                <Input
                  ref={inputRef}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Say how to rewrite it…"
                  aria-label="How to rewrite the selected words"
                  disabled={off}
                  maxLength={2000}
                  className="h-8 flex-1"
                />
                <IconButton type="submit" label="Rewrite" disabled={off || !instruction.trim()} className="text-ai hover:text-ai">
                  <ArrowRight size={15} />
                </IconButton>
              </form>
              <div className="mx-1 my-1.5 h-px bg-line" />
              <Tool
                icon={<UnfoldVertical size={15} />}
                label="Expand"
                hint="More detail, same moment"
                disabled={off}
                onClick={() => run('expand')}
              />
              <Tool
                icon={<FoldVertical size={15} />}
                label="Condense"
                hint="Fewer words, same meaning"
                disabled={off}
                onClick={() => run('condense')}
              />
              <Tool
                icon={<Palette size={15} />}
                label="More vivid"
                hint="Sharper senses and verbs"
                disabled={off}
                onClick={() => run('vivid')}
              />
              <Tool
                icon={<Drama size={15} />}
                label="Change tone"
                disabled={off}
                more
                onClick={() => {
                  setPage('tone')
                  requestAnimationFrame(() => toneRef.current?.focus())
                }}
              />
              {dialogue ? (
                <Tool
                  icon={<MessageSquareQuote size={15} />}
                  label="Fix voice"
                  hint="Match each speaker’s voice"
                  disabled={off}
                  onClick={() => run('voice')}
                />
              ) : null}
              <Tool
                icon={<Layers size={15} />}
                label="Alternatives"
                hint="Three versions to pick from"
                disabled={off}
                onClick={() => run('alternatives')}
              />
              <div className="mx-1 my-1.5 h-px bg-line" />
              <form
                className="px-1 pb-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!off) run('continue', next.trim())
                }}
              >
                <Input
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  placeholder="What happens next? (optional)"
                  aria-label="What happens next, for Continue (optional)"
                  disabled={off}
                  maxLength={2000}
                  className="h-7 text-[12.5px]"
                />
              </form>
              <Tool icon={<PenLine size={15} />} label="Continue after these words" disabled={off} onClick={() => run('continue', next.trim())} />
            </>
          ) : (
            <>
              <div className="flex items-center gap-1 pb-1">
                <IconButton
                  label="Back to the tools"
                  size="sm"
                  onClick={() => {
                    setPage('main')
                    requestAnimationFrame(() => inputRef.current?.focus())
                  }}
                >
                  <ChevronLeft size={15} />
                </IconButton>
                <span className="text-[12.5px] font-semibold text-fg">Change tone</span>
              </div>
              <div className="flex flex-wrap gap-1.5 px-1 pb-2">
                {TONES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    data-tool=""
                    disabled={off}
                    onClick={() => run('tone', t)}
                    className="h-7 rounded-full border border-line bg-surface px-3 text-[12.5px] text-fg transition-colors duration-150 hover:border-ai/50 hover:bg-ai-soft focus-visible:border-ai focus-visible:outline-none disabled:opacity-50"
                  >
                    {t}
                  </button>
                ))}
              </div>
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (tone.trim() && !off) run('tone', tone.trim())
                }}
              >
                <Input
                  ref={toneRef}
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  placeholder="Or describe a tone…"
                  aria-label="The tone you want"
                  disabled={off}
                  maxLength={200}
                  className="h-8 flex-1"
                />
                <IconButton type="submit" label="Change tone" disabled={off || !tone.trim()} className="text-ai hover:text-ai">
                  <ArrowRight size={15} />
                </IconButton>
              </form>
            </>
          )}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}

/** One tool in the menu: its name, and a few words about it. */
function Tool({
  icon,
  label,
  hint,
  more,
  disabled,
  onClick
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  more?: boolean
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-tool=""
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-fg transition-colors duration-150',
        'hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50'
      )}
    >
      <span className="shrink-0 text-muted">{icon}</span>
      <span className="shrink-0 font-medium">{label}</span>
      {hint ? <span className="min-w-0 flex-1 truncate text-right text-[12px] text-faint">{hint}</span> : <span className="flex-1" />}
      {more ? <ChevronRight size={14} className="shrink-0 text-faint" aria-hidden /> : null}
    </button>
  )
}
