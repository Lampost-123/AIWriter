// Ask the world: the chat beside the page that can see the memory, cites the entries it used, and saves a
// useful answer to the memory as Adam's own note in one click. Shown in the right-hand panel in place of
// the scene panel's tabs while askOpen (layout/Inspector.tsx), or on its own when no scene is open
// (App.tsx). Answers are from the open story's point of view, as of the open scene; the chat changes
// nothing in the manuscript or the memory unless Adam saves a note. Owned by the Ask the world part.
import * as M from '@radix-ui/react-dropdown-menu'
import { BookmarkPlus, Check, ChevronDown, History, MessagesSquare, Send, Square, SquarePen, X } from '@/components/ui/icons'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { SavedNote } from '@shared/contracts/ask'
import type { EntryKind, ID } from '@shared/types'
import { Button, IconButton, Notice, toast } from '@/components/ui'
import { useFitHeight } from '@/components/ui/useFitHeight'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { isShortcut, withShortcut } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { settingsAction, WritingStatus } from '@/features/builder/parts'
import { MicButton } from '@/features/dictation/MicButton'
import { insertIntoBox } from '@/features/dictation/insertText'
import { useSceneNames } from '@/features/editor/names/sceneNames'
import { PeekPanel } from '@/features/peek/PeekPanel'
import { kindWord } from '@/features/peek/entryView'
import {
  ask,
  markSaved,
  neverSent,
  newChat,
  openChat,
  refreshChats,
  setDraft,
  showStory,
  stopAnswer,
  useAsk,
  type AskPlace,
  type ShownTurn
} from './askStore'
import { answerLines, answerParagraphs, citedTargets, nameIndex, plainAnswer, type AnswerPart, type LinkTarget } from './citations'
import { EXAMPLES, NO_ANSWER, NO_CHANGES_CAME, answerNote, asOfHint, asOfText, chatWhen, savedMessage, speaksOfChanges } from './askWords'
import { Proposals } from './Proposals'

/** The last request for the box to take the keyboard that was carried out. */
let focusHandled = 0

/** Puts a question in the box, ready to change or ask, with the cursor at its end. */
function fillBox(box: HTMLTextAreaElement | null, question: string): void {
  setDraft(question)
  requestAnimationFrame(() => {
    if (!box?.isConnected) return
    box.focus({ preventScroll: true })
    box.setSelectionRange(question.length, question.length)
  })
}

export function AskPanel({ sceneId, onClose }: { sceneId: ID | null; onClose: () => void }): React.JSX.Element {
  const worldId = useApp((s) => s.world?.id ?? null)
  const openStoryId = useApp((s) => s.storyId)
  const names = useSceneNames(sceneId)
  // The open scene's story (normally the open story), so the chats shown are the ones its answers go in.
  const storyId = (sceneId && names.data?.sceneId === sceneId ? names.data.storyId : null) ?? openStoryId
  const storyTitle = useApp((s) => s.stories.find((x) => x.id === storyId)?.title ?? null)
  const storyKey = useAsk((s) => s.storyKey)
  const peekId = useApp((s) => s.peekEntryId)
  const peeking = !!peekId && !!sceneId
  const panelOpen = useApp((s) => !!s.settings?.layout.inspectorOpen)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLElement>(null)
  const place: AskPlace = { worldId, storyId, sceneId }
  useToastsBeside(rootRef, panelOpen)

  // The story's chats, its most recent open (again after a backup is restored: storyKey goes back to null).
  useEffect(() => {
    void showStory({ worldId, storyId })
  }, [worldId, storyId, storyKey])

  // The box takes the keyboard when asked to (Ask opened from the top bar or the palette, a new chat),
  // once per ask, and after an entry shown here goes.
  const focusRequest = useAsk((s) => s.focusRequest)
  useEffect(() => {
    if (focusRequest === focusHandled) return
    focusHandled = focusRequest
    const b = boxRef.current
    if (!b || useApp.getState().peekEntryId) return
    b.focus({ preventScroll: true })
    // After Ask about this, the keyboard waits below the quote, for the question.
    b.setSelectionRange(b.value.length, b.value.length)
  }, [focusRequest])
  const wasPeeking = useRef(peeking)
  useEffect(() => {
    if (wasPeeking.current && !peeking) {
      const active = document.activeElement
      if (!active || active === document.body || rootRef.current?.contains(active)) boxRef.current?.focus({ preventScroll: true })
    }
    wasPeeking.current = peeking
  }, [peeking])

  const close = (): void => {
    const a = useApp.getState()
    // Closing goes back to the scene panel's tabs, not to an entry shown from here.
    if (a.peekEntryId) a.peekEntry(null)
    onClose()
  }

  return (
    <section
      ref={rootRef}
      aria-label="Ask the world"
      className="relative flex h-full min-h-0 flex-col bg-surface"
      onKeyDown={(e) => {
        // Esc stops an answer being written (as it stops a draft); menus opened from here keep their own Esc,
        // and so does an entry shown here (Esc there goes back to the chat, and the answer goes on).
        if (!isShortcut(e, 'stopAnswer') || e.defaultPrevented || e.nativeEvent.isComposing) return
        if (!e.currentTarget.contains(e.target as Node)) return
        if (!useAsk.getState().running) return
        e.preventDefault()
        e.stopPropagation()
        stopAnswer()
      }}
    >
      {/* An entry shown from an answer covers the chat, which stays as it was underneath (its scroll too). */}
      {peeking ? (
        <div className="absolute inset-0 z-10 flex flex-col bg-surface">
          <PeekPanel sceneId={sceneId} entryId={peekId} backLabel="Ask the world" onBack={() => useApp.getState().peekEntry(null)} />
        </div>
      ) : null}
      <div className={cn('flex min-h-0 flex-1 flex-col', peeking && 'invisible')} inert={peeking}>
        <Header storyTitle={storyTitle} onClose={close} />
        <Conversation place={place} onPick={(q) => fillBox(boxRef.current, q)} />
        <AskBox
          boxRef={boxRef}
          place={place}
          asOf={asOfText({
            sceneLabel: names.data?.sceneId === sceneId ? (names.data?.label ?? null) : null,
            storyTitle,
            hasScene: !!sceneId
          })}
          asOfTitle={asOfHint({ hasScene: !!sceneId, storyTitle })}
        />
      </div>
    </section>
  )
}

/**
 * While the panel shows, toasts (a saved note's Undo) show beside it rather than over the newest words and
 * the box, which are at its bottom (see Toaster).
 */
function useToastsBeside(ref: RefObject<HTMLElement | null>, shown: boolean): void {
  useEffect(() => {
    const el = ref.current
    if (!el || !shown) return
    const root = document.documentElement
    const place = (): void => root.style.setProperty('--toast-right', `${el.offsetWidth}px`)
    place()
    const watch = new ResizeObserver(place)
    watch.observe(el)
    return () => {
      watch.disconnect()
      root.style.removeProperty('--toast-right')
    }
  }, [ref, shown])
}

// ---------- Header ----------

const menuItem = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] outline-none data-[highlighted]:bg-surface-2'

function Header({ storyTitle, onClose }: { storyTitle: string | null; onClose: () => void }): React.JSX.Element {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line pl-4 pr-2">
      <MessagesSquare size={15} className="mr-1 shrink-0 text-muted" aria-hidden />
      <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-fg">Ask the world</h2>
      <ChatsMenu storyTitle={storyTitle} />
      <IconButton label="New chat" size="sm" onClick={newChat}>
        <SquarePen size={14} />
      </IconButton>
      <IconButton label="Close Ask the world" size="sm" onClick={onClose}>
        <X size={14} />
      </IconButton>
    </div>
  )
}

/** The story's earlier chats, the most recent first; choosing one opens it. */
function ChatsMenu({ storyTitle }: { storyTitle: string | null }): React.JSX.Element {
  const chats = useAsk((s) => s.chats)
  const chatId = useAsk((s) => s.chatId)
  return (
    <M.Root onOpenChange={(open) => open && void refreshChats()}>
      <M.Trigger asChild>
        <IconButton label="Earlier chats" size="sm">
          <History size={14} />
        </IconButton>
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 flex w-[300px] max-w-[calc(100vw-16px)] flex-col rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
        >
          <M.Label className="truncate px-2 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
            {storyTitle ? `Chats in ${storyTitle}` : 'Chats'}
          </M.Label>
          <div className="max-h-[min(320px,calc(var(--radix-dropdown-menu-content-available-height)-80px))] overflow-y-auto">
            {chats.length ? (
              chats.map((c) => (
                <M.Item key={c.chatId} onSelect={() => void openChat(c.chatId)} className={menuItem} title={c.title}>
                  <span className="w-4 shrink-0">{c.chatId === chatId ? <Check size={14} className="text-accent" /> : null}</span>
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="shrink-0 text-[12px] tabular-nums text-faint">{chatWhen(c.updatedAt)}</span>
                </M.Item>
              ))
            ) : (
              <p className="px-2 py-1.5 text-[13px] text-faint">No chats yet{storyTitle ? ' in this story' : ''}.</p>
            )}
          </div>
          <M.Separator className="my-1 h-px bg-line" />
          <M.Item onSelect={newChat} className={menuItem}>
            <SquarePen size={14} className="text-muted" /> New chat
          </M.Item>
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}

// ---------- The conversation ----------

/** Every page in the world by name, for the links in answers; kept between openings of the panel. */
let cachedIndex: { key: string; index: Map<string, LinkTarget> } | null = null

function useLinkIndex(): Map<string, LinkTarget> {
  const key = useApp((s) => `${s.world?.id ?? ''}:${s.entriesRev}`)
  const [index, setIndex] = useState(() =>
    cachedIndex?.key === key ? cachedIndex.index : (cachedIndex?.index ?? new Map<string, LinkTarget>())
  )
  useEffect(() => {
    if (cachedIndex?.key === key) {
      setIndex(cachedIndex.index)
      return
    }
    let live = true
    api
      .listEntries()
      .then((all) => {
        const next = nameIndex(all.map((e) => ({ id: e.id, kind: e.kind, name: e.name, aliases: e.aliases })))
        cachedIndex = { key, index: next }
        if (live) setIndex(next)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [key])
  return index
}

function Conversation({ place, onPick }: { place: AskPlace; onPick: (question: string) => void }): React.JSX.Element {
  const turns = useAsk((s) => s.turns)
  const chatId = useAsk((s) => s.chatId)
  const loading = useAsk((s) => s.loading)
  const loadError = useAsk((s) => s.loadError)
  const running = useAsk((s) => s.running)
  const index = useLinkIndex()
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  // Follows the newest words while Adam is at the bottom; scrolling up to read stops that until he is back.
  const stick = useRef(true)
  // Where following last put the scroll. Only a scroll up from there is Adam's: the browser also moves it
  // down a little to keep the words in view in place as they settle.
  const pinnedAt = useRef(0)
  const follow = (): void => {
    const el = scroller.current
    if (!el || !stick.current) return
    el.scrollTop = el.scrollHeight
    pinnedAt.current = el.scrollTop
  }

  // A question that never reached the AI is kept only while it is the last (with Try again). One the AI
  // was asked stays, answered or not: it is in the chat's record.
  const shown = turns.filter((t, i) => !(neverSent(t) && i < turns.length - 1))
  const lastAsked = turns[turns.length - 1]

  useLayoutEffect(() => {
    stick.current = true
  }, [chatId, turns.length])
  useLayoutEffect(follow, [turns, running, loading])
  // And while the words settle (the page's font arriving, names becoming links) or the panel or box changes size.
  useEffect(() => {
    const watch = new ResizeObserver(follow)
    if (scroller.current) watch.observe(scroller.current)
    if (content.current) watch.observe(content.current)
    return () => watch.disconnect()
    // follow reads only refs, so the first one serves for good.
  }, [])

  return (
    <div
      ref={scroller}
      onScroll={() => {
        const el = scroller.current
        if (!el) return
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) stick.current = true
        else if (el.scrollTop < pinnedAt.current) stick.current = false
      }}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-3"
    >
      <div ref={content}>
        {loadError ? (
          <div className="mb-3">
            <AskProblem
              message={`Couldn’t read your chats. ${loadError}`}
              onRetry={() => void showStory({ worldId: place.worldId, storyId: place.storyId }, true)}
            />
          </div>
        ) : null}
        {loading ? null : shown.length === 0 ? (
          <Starters onPick={onPick} />
        ) : (
          <ol aria-label="Conversation" className="flex flex-col gap-5">
            {shown.map((t) => (
              <TurnView
                key={t.taskId ?? t.generationId}
                turn={t}
                index={index}
                place={place}
                running={running?.taskId === t.taskId && !!t.taskId ? running : null}
                canRetry={t === lastAsked && !running}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

/** With nothing asked yet: what Ask does, and the spec's examples, which fill the box. */
function Starters({ onPick }: { onPick: (question: string) => void }): React.JSX.Element {
  return (
    <div className="animate-fade-in px-1 pt-1">
      <p className="text-[13px] leading-relaxed text-muted">
        Ask anything about your world: what someone would do, names that fit, what you’ve already said. Answers come from the memory and
        name what they used. Nothing changes unless you save it.
      </p>
      <p className="mb-2 mt-4 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Try asking</p>
      <div className="flex flex-col items-start gap-1.5">
        {EXAMPLES.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="max-w-full rounded-lg border border-line px-3 py-1.5 text-left text-[12.5px] leading-snug text-muted transition-colors duration-150 hover:border-line-strong hover:bg-surface-2 hover:text-fg"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Shows a page an answer cites: beside the page (in this panel) with a scene open, else on its own page. */
function openEntry(id: ID, kind: EntryKind): void {
  const a = useApp.getState()
  if (a.sceneId && a.view.kind === 'write') a.peekEntry(id)
  else a.navigate({ kind: 'entries', entryKind: kind, entryId: id })
}

function TurnView({
  turn,
  index,
  place,
  running,
  canRetry
}: {
  turn: ShownTurn
  index: Map<string, LinkTarget>
  place: AskPlace
  /** The answer being written, when it is this one. */
  running: { stopping: boolean; retrying: string | null } | null
  /** The last question asked: Try again shows when it failed. */
  canRetry: boolean
}): React.JSX.Element {
  const answerRef = useRef<HTMLDivElement>(null)
  const streaming = turn.status === 'streaming'
  const hasAnswer = !!turn.answer.trim()
  const paragraphs = useMemo(() => answerParagraphs(turn.answer, index), [turn.answer, index])
  const recorded = !turn.problem && !turn.generationId.startsWith('pending:')
  // What went wrong shows while this is the last question asked (with Try again); after that, quietly.
  const notice = !!turn.problem || (turn.status === 'error' && canRetry)
  const unanswered = recorded && turn.status === 'error' && !hasAnswer && !notice
  const note = answerNote(turn)
  const retry = (): void => void ask(turn.question, place)

  return (
    <li className="flex flex-col">
      <div className="flex justify-end">
        <p className="max-w-[88%] select-text whitespace-pre-wrap break-words rounded-lg bg-accent-soft px-3 py-2 text-[13px] leading-relaxed text-fg">
          {turn.question}
        </p>
      </div>

      {hasAnswer ? (
        <div
          ref={answerRef}
          data-answer
          className="mt-2.5 select-text rounded-lg border border-line bg-page px-3 py-2.5 font-serif text-[14.5px] leading-[1.65] text-fg"
        >
          {paragraphs.map((p, i) => (
            <AnswerParagraph key={i} parts={p} className={i > 0 ? 'mt-2.5' : undefined} />
          ))}
        </div>
      ) : null}

      {/* The editor chat: what it looked at on the way (quietly), and the changes it proposes. */}
      {turn.steps?.length && !streaming ? (
        <p className="mt-1.5 px-1 text-[12px] leading-relaxed text-faint" data-steps>
          {turn.steps.length === 1 ? turn.steps[0] : `${turn.steps.length} steps: ${turn.steps.join(' · ')}`}
        </p>
      ) : null}
      {turn.proposals?.length ? <Proposals generationId={turn.generationId} proposals={turn.proposals} streaming={streaming} /> : null}
      {!streaming && turn.status === 'complete' && !turn.proposals?.length && speaksOfChanges(turn.answer) ? (
        <p className="mt-1.5 px-1 text-[12.5px] leading-relaxed text-muted" data-no-changes>
          {NO_CHANGES_CAME}
        </p>
      ) : null}

      {streaming ? (
        <div className="mt-1.5 flex h-7 items-center px-1">
          <WritingStatus
            text={
              running?.stopping
                ? 'Stopping…'
                : running?.retrying
                  ? 'Retrying…'
                  : turn.steps?.length
                    ? `${turn.steps[turn.steps.length - 1]}…`
                    : 'Answering…'
            }
            title={running?.retrying ?? undefined}
          />
        </div>
      ) : hasAnswer ? (
        <SaveControl turn={turn} answerRef={answerRef} index={index} place={place} />
      ) : null}

      {notice ? (
        <div className="mt-2">
          <AskProblem
            message={turn.problem?.message ?? turn.error ?? 'Something went wrong while answering. Try again.'}
            code={turn.problem?.code}
            onRetry={canRetry ? retry : undefined}
          />
        </div>
      ) : null}

      {recorded ? (
        // "What the AI saw" first, so it stays put when how the answer ended and its cost come after it.
        <div
          className={cn(
            'flex min-h-5 flex-wrap items-center gap-x-1.5 px-1 text-[12px] leading-5 text-faint',
            // Under a notice, or right under the question when nothing came back.
            (notice || (!hasAnswer && !streaming)) && 'mt-1'
          )}
        >
          {unanswered ? <LinePart dot>{NO_ANSWER}</LinePart> : null}
          <LinePart dot={note.length > 0}>
            <button
              type="button"
              onClick={() => useApp.getState().navigate({ kind: 'generation', generationId: turn.generationId })}
              className="rounded-sm hover:text-fg hover:underline"
            >
              What the AI saw
            </button>
          </LinePart>
          {note.map((n, i) => (
            <LinePart key={n} dot={i < note.length - 1} className="tabular-nums">
              {n}
            </LinePart>
          ))}
        </div>
      ) : null}
    </li>
  )
}

/** One part of the quiet line under an answer, with the dot that parts it from the next (so a line that wraps never starts with one). */
function LinePart({ dot, className, children }: { dot: boolean; className?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <span className={cn('flex items-center gap-x-1.5 whitespace-nowrap', className)}>
      {children}
      {dot ? <span aria-hidden>·</span> : null}
    </span>
  )
}

/**
 * A problem in plain words with what to do next (Open Settings when the fix is there, Try again), the
 * buttons under the words so it reads well in the narrowest panel.
 */
function AskProblem({ message, code, onRetry }: { message: string; code?: string; onRetry?: () => void }): React.JSX.Element {
  const settings = settingsAction(message, code)
  return (
    <div role="alert">
      <Notice tone="danger">
        {message}
        {settings || onRetry ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {settings ? (
              <Button size="sm" onClick={settings.run}>
                {settings.label}
              </Button>
            ) : null}
            {onRetry ? (
              <Button size="sm" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
      </Notice>
    </div>
  )
}

/**
 * A paragraph of an answer, a line at a time. A list item's words hang beside its mark ("-", "2."), so a
 * list still reads as one when its items wrap in a narrow panel.
 */
function AnswerParagraph({ parts, className }: { parts: AnswerPart[]; className?: string }): React.JSX.Element {
  const lines = answerLines(parts)
  // The numbers of a numbered list share one width, so the items' words line up.
  const digits = Math.max(1, ...lines.map((l) => l.mark?.match(/\d+/)?.[0].length ?? 0))
  return (
    <div className={cn('whitespace-pre-wrap break-words', className)}>
      {lines.map((line, i) => {
        if (!line.mark) return <div key={i}>{answerWords(line.parts)}</div>
        const hang = /\d/.test(line.mark) ? `${0.6 * digits + 0.75}em` : '1em'
        return (
          <div key={i} style={{ paddingLeft: `calc(${hang} + ${1.2 * line.depth}em)`, textIndent: `-${hang}` }}>
            <span className="inline-block" style={{ width: hang, textIndent: 0 }}>
              {line.mark}
            </span>
            {answerWords(line.parts)}
          </div>
        )
      })}
    </div>
  )
}

/** A line's words: cited names as links, and italics in italics. */
function answerWords(parts: AnswerPart[]): React.ReactNode[] {
  return parts.map((part, i) => {
    const words = part.target ? (
      <Cite key={i} target={part.target}>
        {part.text}
      </Cite>
    ) : (
      part.text
    )
    return part.em ? <em key={i}>{words}</em> : words
  })
}

/** A name the answer cites: a quiet dotted underline, like names on the page; clicking shows that page. */
function Cite({ target, children }: { target: LinkTarget; children: React.ReactNode }): React.JSX.Element {
  const open = (name: HTMLElement): void => {
    // The chat hides while the entry shows, so the keyboard moves to the entry (its Back button, where Esc
    // works too) rather than being lost.
    name.blur()
    openEntry(target.id, target.kind)
  }
  return (
    <span
      role="button"
      tabIndex={0}
      data-entry-id={target.id}
      title={`Show ${target.name}`}
      onClick={(e) => open(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        open(e.currentTarget)
      }}
      className="cursor-pointer rounded-sm underline decoration-faint/70 decoration-dotted decoration-[1.5px] underline-offset-[0.24em] hover:text-accent hover:decoration-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
    >
      {children}
    </span>
  )
}

// ---------- Saving to the memory ----------

/** The words selected inside `el`, or ''. */
function selectedIn(el: HTMLElement | null): string {
  const sel = document.getSelection()
  if (!el || !sel || sel.isCollapsed || !sel.rangeCount) return ''
  const r = sel.getRangeAt(0)
  if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return ''
  return sel.toString().trim()
}

/** The words selected inside an element, kept up to date. */
function useSelectionIn(ref: RefObject<HTMLElement | null>): string {
  const [text, setText] = useState('')
  useEffect(() => {
    const update = (): void => setText(selectedIn(ref.current))
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [ref])
  return text
}

/**
 * "Save to Mara Venn": the answer (or the words selected in it) goes into the memory as Adam's own note,
 * on the first page it cites; the arrow beside it offers the others, or a new page in Lore. With
 * nothing cited it becomes a new page in Lore.
 */
function SaveControl({
  turn,
  answerRef,
  index,
  place
}: {
  turn: ShownTurn
  answerRef: RefObject<HTMLDivElement | null>
  index: Map<string, LinkTarget>
  place: AskPlace
}): React.JSX.Element {
  const cited = useMemo(() => citedTargets(turn.answer, index), [turn.answer, index])
  const selection = useSelectionIn(answerRef)
  const saved = useAsk((s) => s.saved[turn.generationId])
  const [busy, setBusy] = useState(false)
  // The words selected when the pointer went down on a button (a click can clear the selection first).
  const held = useRef('')
  const hold = (): void => {
    held.current = selectedIn(answerRef.current)
  }
  const first = cited[0] ?? null

  const save = async (target: LinkTarget | null): Promise<void> => {
    const words = held.current || selectedIn(answerRef.current) || plainAnswer(turn.answer)
    held.current = ''
    if (busy) return
    setBusy(true)
    try {
      const note = await api.saveAskNote({
        text: words,
        entryId: target?.id ?? null,
        question: turn.question,
        storyId: place.storyId,
        sceneId: place.sceneId,
        // Kept with the answer's record, so it shows "Saved" after a restart too.
        generationId: turn.generationId
      })
      markSaved(turn.generationId, note)
      toast(savedMessage(note), {
        tone: 'success',
        action: { label: 'Undo', run: () => void undo(turn.generationId, note) },
        secondary: { label: 'Open', run: () => openEntry(note.entryId, note.kind) }
      })
    } catch (e) {
      toast(`Couldn’t save that. ${(e as Error).message}`, { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const label = selection
    ? first
      ? `Save selection to ${first.name}`
      : 'Save selection to Lore'
    : first
      ? `Save to ${first.name}`
      : 'Save to Lore'
  const hint = `${selection ? 'Adds the words you selected' : 'Adds this answer'} to ${first ? `the memory for ${first.name}` : 'a new page in Lore'}, as your own note. Nothing else changes.`

  return (
    <div className="mt-1.5 flex h-7 min-w-0 items-center">
      {saved && !selection ? (
        <span className="flex min-w-0 items-center gap-1.5 px-1.5 text-[12.5px] text-faint">
          <Check size={12} className="shrink-0 text-success" aria-hidden />
          <span className="truncate">Saved to {saved.created ? 'Lore' : saved.name}</span>
        </span>
      ) : (
        <button
          type="button"
          disabled={busy}
          title={hint}
          onPointerDown={hold}
          // Keeps the selection while the button is pressed.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void save(first)}
          className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[12.5px] font-medium text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg disabled:opacity-50"
        >
          <BookmarkPlus size={13} className="shrink-0" aria-hidden />
          <span className="truncate">{label}</span>
        </button>
      )}
      {cited.length ? (
        <M.Root
          onOpenChange={(open) => {
            // Closed without choosing: the words held for it are let go.
            if (!open) queueMicrotask(() => (held.current = ''))
          }}
        >
          <M.Trigger
            disabled={busy}
            aria-label="Save somewhere else"
            title="Save somewhere else"
            onPointerDown={hold}
            onKeyDown={hold}
            className="inline-flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg data-[state=open]:bg-surface-2 data-[state=open]:text-fg"
          >
            <ChevronDown size={13} />
          </M.Trigger>
          <M.Portal>
            <M.Content
              align="start"
              sideOffset={4}
              collisionPadding={8}
              // The selection stays where it was: the keyboard goes back to the answer's buttons.
              onCloseAutoFocus={(e) => e.preventDefault()}
              className="z-50 w-[260px] max-w-[calc(100vw-16px)] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
            >
              <M.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
                {held.current || selection ? 'Save the selection to' : 'Save to'}
              </M.Label>
              {cited.map((t) => (
                <M.Item key={t.id} onSelect={() => void save(t)} className={menuItem}>
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="shrink-0 text-[12px] text-faint">{kindWord(t.kind)}</span>
                </M.Item>
              ))}
              <M.Separator className="my-1 h-px bg-line" />
              <M.Item onSelect={() => void save(null)} className={menuItem}>
                A new page in Lore
              </M.Item>
            </M.Content>
          </M.Portal>
        </M.Root>
      ) : null}
    </div>
  )
}

/** The toast's Undo: the note comes out again. */
async function undo(generationId: ID, note: SavedNote): Promise<void> {
  try {
    await api.undoAskNote(note.undo, generationId)
    if (useAsk.getState().saved[generationId] === note) markSaved(generationId, null)
  } catch (e) {
    toast(`Couldn’t undo that. ${(e as Error).message}`, { tone: 'danger' })
  }
}

// ---------- The box ----------

function AskBox({
  boxRef,
  place,
  asOf,
  asOfTitle
}: {
  boxRef: RefObject<HTMLTextAreaElement | null>
  place: AskPlace
  asOf: string
  asOfTitle: string
}): React.JSX.Element {
  const draft = useAsk((s) => s.draft)
  const running = useAsk((s) => !!s.running)
  const loading = useAsk((s) => s.loading)
  useFitHeight(boxRef, draft, 2, 8)

  const send = (): void => {
    const q = draft.trim()
    if (!q || running || loading) return
    setDraft('')
    void ask(q, place)
  }

  return (
    <form
      className="shrink-0 border-t border-line px-3 pb-3 pt-2.5"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <div className="rounded-lg border border-line bg-page transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 hover:border-line-strong focus-within:hover:border-accent">
        <textarea
          ref={boxRef}
          data-ask-box
          rows={2}
          value={draft}
          aria-label="Ask about your world"
          placeholder="Ask, brainstorm, or ask for an edit…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          className="block w-full resize-none bg-transparent px-3 pb-1 pt-2 text-[13.5px] leading-[1.55] text-fg placeholder:text-faint focus:outline-none"
        />
        <div className="flex h-9 items-center gap-1 px-1.5 pb-1">
          <MicButton
            onText={(spoken) => {
              const el = boxRef.current
              if (el) insertIntoBox(el, spoken, setDraft)
            }}
          />
          <span className="min-w-0 flex-1 truncate px-1 text-[11.5px] text-faint" title={asOfTitle}>
            {asOf}
          </span>
          {running ? (
            <Button
              type="button"
              size="sm"
              icon={<Square size={10} fill="currentColor" />}
              onClick={stopAnswer}
              title={`${withShortcut('Stop the answer', 'stopAnswer')}. What has arrived is kept.`}
            >
              Stop
            </Button>
          ) : (
            <Button type="submit" size="sm" variant="primary" icon={<Send size={13} />} disabled={!draft.trim() || loading}>
              Ask
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
