// Ask the world: the chat beside the page that can see the memory, cites the entries it used, and saves a
// useful answer to the memory as Adam's own note in one click. Shown in the right-hand panel in place of
// the scene panel's tabs while askOpen (layout/Inspector.tsx), or on its own when no scene is open
// (App.tsx). Answers are from the open story's point of view, as of the open scene; the chat changes
// nothing in the manuscript or the memory unless Adam saves a note. Owned by the Ask the world part.
//
// The chat overhaul's Phase 2 look: an answer is read into blocks (shared/answerBlocks.ts) and drawn as a steps row,
// a lead that answers (with a verdict for a fact check), option cards, fact rows, plain paragraphs and a folded "why",
// then the changes it proposes under a bar, the entries it used as chips, up to three follow-up questions and, on
// hover or focus, its actions. Comfortable or Compact from the ⋯ menu in the head. Built to work at about 320 px, so
// the same parts can sit in the desk layout's Scene drawer later.
import * as M from '@radix-ui/react-dropdown-menu'
import {
  BadgeCheck,
  BookOpenText,
  CaseSensitive,
  Check,
  CornerDownRight,
  History,
  Lightbulb,
  MessagesSquare,
  MoreHorizontal,
  PenLine,
  Send,
  Shrink,
  Square,
  SquarePen,
  TextQuote,
  X,
  type IconType
} from '@/components/ui/icons'
import { LitWindow } from '@/components/ui/LitWindow'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { NamedEntry } from '@shared/contracts/manuscript'
import { parseAnswer } from '@shared/answerBlocks'
import type { ID } from '@shared/types'
import { Button, IconButton, Notice } from '@/components/ui'
import { useFitHeight } from '@/components/ui/useFitHeight'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { isShortcut, withShortcut } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { settingsAction } from '@/features/builder/parts'
import { MicButton } from '@/features/dictation/MicButton'
import { insertIntoBox } from '@/features/dictation/insertText'
import { useSceneNames } from '@/features/editor/names/sceneNames'
import { PeekPanel } from '@/features/peek/PeekPanel'
import {
  ask,
  neverSent,
  newChat,
  openChat,
  quoteIn,
  refreshChats,
  removeQuote,
  sendBox,
  setDraft,
  setQuote,
  showStory,
  stopAnswer,
  useAsk,
  type AskPlace,
  type ShownTurn
} from './askStore'
import { citedTargets, nameIndex, type LinkTarget } from './citations'
import { EXAMPLES, NO_ANSWER, NO_CHANGES_CAME, answerNote, asOfHint, asOfText, chatWhen, speaksOfChanges } from './askWords'
import { withoutChoice } from './askChoice'
import { ActionBar } from './ActionBar'
import { AnswerBlocks } from './AnswerBlocks'
import { asksForIdeas, followUpsOf, QUICK_ACTIONS, readyWords, starterCards, type StarterCard } from './answerView'
import { setDensity, setToolsView, useAskPrefs, type Density } from './askPrefs'
import { Choice } from './Choice'
import { SceneEntries, SourcesRow } from './CiteChip'
import { instantMotion } from './inputMode'
import { Proposals } from './Proposals'
import { ToolCalls } from './ToolCalls'
import { runningPhrase } from './toolView'

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

  // The open scene's entries as of the scene (for the cards over cited names), and who is in it (the empty state).
  const sceneData = names.data?.sceneId === sceneId ? names.data : null
  const entries = useMemo(() => new Map<ID, NamedEntry>((sceneData?.entries ?? []).map((e) => [e.id, e])), [sceneData])
  const cast = useMemo(() => {
    if (!sceneData) return []
    const ids = [sceneData.cast.povId, ...sceneData.cast.presentIds].filter((x): x is ID => !!x)
    const people = [...new Set(ids)].map((id) => entries.get(id)).filter((e): e is NamedEntry => !!e && e.kind === 'character' && !!e.name.trim())
    // As the writer would ask: "Wren", not "Wren Halloway" (a short other name when there is one).
    return people.map((e) => e.aliases.find((a) => a.trim() && !/\s/.test(a.trim()))?.trim() ?? e.name.trim().split(/\s+/)[0])
  }, [sceneData, entries])
  const density = useAskPrefs((s) => s.density)

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
      <div className={cn('flex min-h-0 flex-1 flex-col', peeking && 'invisible')} inert={peeking} data-density={density}>
        <Header storyTitle={storyTitle} onClose={close} density={density} />
        <SceneEntries.Provider value={entries}>
          <Conversation place={place} onPick={(q) => fillBox(boxRef.current, q)} density={density} cast={cast} />
        </SceneEntries.Provider>
        <AskBox
          boxRef={boxRef}
          place={place}
          asOf={asOfText({
            sceneLabel: sceneData?.label ?? null,
            storyTitle,
            hasScene: !!sceneId
          })}
          asOfTitle={asOfHint({ hasScene: !!sceneId, storyTitle })}
          onFill={(q) => fillBox(boxRef.current, q)}
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

function Header({ storyTitle, onClose, density }: { storyTitle: string | null; onClose: () => void; density: Density }): React.JSX.Element {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line pl-4 pr-2">
      <MessagesSquare size={15} className="mr-1 shrink-0 text-muted" aria-hidden />
      <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-fg">Ask the world</h2>
      <ChatsMenu storyTitle={storyTitle} />
      <IconButton label="New chat" size="sm" onClick={newChat}>
        <SquarePen size={14} />
      </IconButton>
      <PanelMenu density={density} />
      <IconButton label="Close Ask the world" size="sm" onClick={onClose}>
        <X size={14} />
      </IconButton>
    </div>
  )
}

/** The panel's ⋯ menu: how dense the conversation is, and whether tool calls show folded (both remembered on this computer). */
function PanelMenu({ density }: { density: Density }): React.JSX.Element {
  const toolsView = useAskPrefs((s) => s.toolsView)
  return (
    <M.Root>
      <M.Trigger asChild>
        <IconButton label="Ask panel options" size="sm">
          <MoreHorizontal size={14} />
        </IconButton>
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 w-[240px] max-w-[calc(100vw-16px)] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
        >
          <M.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Density</M.Label>
          <M.RadioGroup value={density} onValueChange={(v) => setDensity(v === 'compact' ? 'compact' : 'comfortable')}>
            {(
              [
                ['comfortable', 'Comfortable', 'Roomy, the lead in the story’s type'],
                ['compact', 'Compact', 'Tighter, one line for each idea’s why']
              ] as const
            ).map(([value, label, hint]) => (
              <M.RadioItem key={value} value={value} className={cn(menuItem, 'items-start')}>
                <span className="mt-0.5 w-4 shrink-0">
                  <M.ItemIndicator>
                    <Check size={14} className="text-accent" />
                  </M.ItemIndicator>
                </span>
                <span className="min-w-0">
                  <span className="block">{label}</span>
                  <span className="block text-[12px] text-faint">{hint}</span>
                </span>
              </M.RadioItem>
            ))}
          </M.RadioGroup>
          <M.Separator className="my-1 h-px bg-line" />
          <M.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Show tool calls</M.Label>
          <M.RadioGroup value={toolsView} onValueChange={(v) => setToolsView(v === 'open' ? 'open' : 'folded')}>
            {(
              [
                ['folded', 'Folded', 'One line over each answer; open it to see each call'],
                ['open', 'Always open', 'Every call the chat made, listed over its answer']
              ] as const
            ).map(([value, label, hint]) => (
              <M.RadioItem key={value} value={value} className={cn(menuItem, 'items-start')} data-tools-view={value}>
                <span className="mt-0.5 w-4 shrink-0">
                  <M.ItemIndicator>
                    <Check size={14} className="text-accent" />
                  </M.ItemIndicator>
                </span>
                <span className="min-w-0">
                  <span className="block">{label}</span>
                  <span className="block text-[12px] text-faint">{hint}</span>
                </span>
              </M.RadioItem>
            ))}
          </M.RadioGroup>
        </M.Content>
      </M.Portal>
    </M.Root>
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

/**
 * The one line a screen reader hears about answers (the conversation itself is a log with live updates off):
 * "Answering…" when one starts, then "Answer ready: 3 options, 2 changes", "Stopped" or "Failed".
 */
function useAnnouncement(last: ShownTurn | undefined): string {
  const [said, setSaid] = useState('')
  const seen = useRef<{ key: string; status: string } | null>(null)
  const key = last ? (last.taskId ?? last.generationId) : ''
  const status = last?.status ?? ''
  useEffect(() => {
    if (!last) return
    const before = seen.current
    seen.current = { key, status }
    if (status === 'streaming') {
      if (before?.key !== key || before.status !== 'streaming') setSaid('Answering…')
      return
    }
    // Only an answer seen being written is announced (not an old chat opened).
    if (before?.key === key && before.status === 'streaming') {
      const answer = withoutChoice(last.answer, last.choice)
      setSaid(readyWords(status, parseAnswer(answer, { ideas: asksForIdeas(last.question) }), last.proposals))
    }
    // The rest of the turn is read when it is announced; only its key and status say when.
  }, [key, status])
  return said
}

function Conversation({
  place,
  onPick,
  density,
  cast
}: {
  place: AskPlace
  onPick: (question: string) => void
  density: Density
  /** The open scene's people, point of view first, for the empty state's questions. */
  cast: string[]
}): React.JSX.Element {
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
  const announcement = useAnnouncement(lastAsked)

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
      <p role="status" className="sr-only" data-ask-status>
        {announcement}
      </p>
      <div ref={content} role="log" aria-live="off" aria-label="Ask the world conversation">
        {loadError ? (
          <div className="mb-3">
            <AskProblem
              message={`Couldn’t read your chats. ${loadError}`}
              onRetry={() => void showStory({ worldId: place.worldId, storyId: place.storyId }, true)}
            />
          </div>
        ) : null}
        {loading ? null : shown.length === 0 ? (
          <EmptyState onPick={onPick} cast={cast} density={density} />
        ) : (
          <ol aria-label="Conversation" className={cn('flex flex-col', density === 'compact' ? 'gap-2.5' : 'gap-4')}>
            {shown.map((t, i) => (
              <TurnView
                key={t.taskId ?? t.generationId}
                turn={t}
                index={index}
                place={place}
                density={density}
                running={running?.taskId === t.taskId && !!t.taskId ? running : null}
                busy={!!running || loading}
                canRetry={t === lastAsked && !running}
                // A question with options is answered by the question after it; it can be picked from while it is the last.
                answeredBy={shown[i + 1]?.question}
                canPick={t === lastAsked && !running && !loading && t.status !== 'streaming'}
                isLast={t === lastAsked}
                onPick={onPick}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

/** Each kind of question's icon (the starter cards and the quick actions over the box), and its own ink. */
export const STARTER_ICONS: Record<StarterCard['kind'], IconType> = { brainstorm: Lightbulb, check: BadgeCheck, tighten: Shrink, spelling: CaseSensitive }
const STARTER_INK: Record<StarterCard['kind'], string> = {
  brainstorm: 'bg-ai-soft text-ai',
  check: 'bg-success-soft text-success',
  tighten: 'bg-accent-soft text-accent',
  spelling: 'bg-k-gloss-soft text-k-gloss'
}
const STARTER_TEXT: Record<StarterCard['kind'], string> = { brainstorm: 'text-ai', check: 'text-success', tighten: 'text-accent', spelling: 'text-k-gloss' }

/**
 * With nothing asked yet: the app's lit window over still water (the New look, Comfortable only), one line on what Ask
 * does, and a card for each kind of question, naming the open scene's people where it has them. A card fills the box,
 * to change or ask as it is.
 */
function EmptyState({ onPick, cast, density }: { onPick: (question: string) => void; cast: string[]; density: Density }): React.JSX.Element {
  const cards = starterCards(cast, EXAMPLES)
  const compact = density === 'compact'
  return (
    <div className="px-1 pt-1" data-empty>
      {compact ? null : (
        <div className="mb-3 hidden h-[84px] overflow-hidden rounded-xl border border-line look-new:block" data-empty-art>
          <LitWindow />
        </div>
      )}
      <p className="text-[13px] leading-relaxed text-muted">Ask about your world, brainstorm, or ask for an edit. Nothing changes until you say so.</p>
      <p className={cn('mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint', compact ? 'mt-3' : 'mt-4')}>Try asking</p>
      <div className="flex flex-col gap-1.5">
        {cards.map((c) => {
          const Icon = STARTER_ICONS[c.kind]
          return (
            <button
              key={c.kind}
              type="button"
              onClick={() => onPick(c.question)}
              data-starter={c.kind}
              className={cn(
                'flex w-full min-w-0 items-start gap-2.5 rounded-lg border border-line bg-surface px-3 text-left transition-[background-color,border-color] duration-150 hover:border-line-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus look-new:bg-raise look-new:shadow-e1',
                compact ? 'py-1.5' : 'py-2'
              )}
            >
              <span className={cn('mt-0.5 flex shrink-0 items-center justify-center rounded-md', compact ? 'size-5' : 'size-6', STARTER_INK[c.kind])}>
                <Icon size={compact ? 11 : 13} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[11.5px] font-semibold uppercase tracking-wide text-faint">{c.label}</span>
                <span className="block break-words text-[13px] leading-snug text-fg">{c.question}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TurnView({
  turn,
  index,
  place,
  running,
  canRetry,
  answeredBy,
  canPick,
  density,
  busy,
  isLast,
  onPick
}: {
  turn: ShownTurn
  index: Map<string, LinkTarget>
  place: AskPlace
  /** The answer being written, when it is this one. */
  running: { stopping: boolean; retrying: string | null } | null
  /** The last question asked: Try again shows when it failed. */
  canRetry: boolean
  /** The question asked after this one, if any (it answers a question with options). */
  answeredBy: string | undefined
  /** A question with options under this answer can be picked from now. */
  canPick: boolean
  density: Density
  /** An answer is being written (here or in another turn), or the chat is loading: the cards' buttons wait. */
  busy: boolean
  /** The chat's last question: Retry shows under it. */
  isLast: boolean
  /** Fills the box with a question (a follow-up chip). */
  onPick: (question: string) => void
}): React.JSX.Element {
  const answerRef = useRef<HTMLDivElement>(null)
  const streaming = turn.status === 'streaming'
  // Blocks that arrive while the answer is written fade in; an old chat's show at once (and so does all of it when
  // Adam works from the keyboard).
  const [fades] = useState(() => streaming && !instantMotion())
  // With the chat's question shown as buttons, its numbered options (also at the end of the text) don't show twice.
  const answer = useMemo(() => withoutChoice(turn.answer, turn.choice), [turn.answer, turn.choice])
  const hasAnswer = !!answer.trim()
  const blocks = useMemo(() => parseAnswer(answer, { streaming, ideas: asksForIdeas(turn.question) }), [answer, streaming, turn.question])
  const sources = useMemo(() => citedTargets(answer, index), [answer, index])
  const followUps = streaming ? [] : followUpsOf(blocks)
  const recorded = !turn.problem && !turn.generationId.startsWith('pending:')
  // What went wrong shows while this is the last question asked (with Try again); after that, quietly.
  const notice = !!turn.problem || (turn.status === 'error' && canRetry)
  const unanswered = recorded && turn.status === 'error' && !hasAnswer && !notice
  // How the answer ended (always shown) and what it cost (in the ⋯ menu).
  const note = answerNote(turn)
  const cost = !streaming && turn.cost != null ? (note.pop() ?? null) : null
  const endNote = note[0] ?? (unanswered ? NO_ANSWER : null)
  const retry = (): void => void ask(turn.question, place, turn.sentWith)
  const tools = turn.tools ?? []
  const runningCall = [...tools].reverse().find((c) => c.status === 'running')
  const live = streaming
    ? running?.stopping
      ? 'Stopping…'
      : running?.retrying
        ? 'Retrying…'
        : runningCall
          ? `${runningPhrase(runningCall)}…`
          : 'Answering…'
    : null
  const ms = turn.startedAt && turn.endedAt ? turn.endedAt - turn.startedAt : null
  const compact = density === 'compact'

  return (
    <li
      className={cn(
        // A faint rule between one question and its answer and the next, fading at both ends.
        'group/turn relative flex flex-col first:pt-0 first:before:hidden',
        'before:pointer-events-none before:absolute before:inset-x-8 before:top-0 before:h-px before:bg-[linear-gradient(to_right,transparent,var(--line-strong),transparent)] before:opacity-70',
        compact ? 'pt-2.5' : 'pt-4'
      )}
      data-turn-status={turn.status}
    >
      <div className="flex justify-end">
        <p
          className={cn(
            'max-w-[88%] select-text whitespace-pre-wrap break-words rounded-lg rounded-br-sm bg-accent-soft text-[13px] leading-relaxed text-fg',
            compact ? 'px-2.5 py-1.5' : 'px-3 py-2'
          )}
        >
          {turn.question}
        </p>
      </div>

      {/* The AI's mark and its tool calls: one row from the start, so nothing under it moves. */}
      <div className={compact ? 'mt-1.5' : 'mt-2.5'}>
        <ToolCalls tools={tools} live={live} ms={ms} compact={compact} />
      </div>

      {hasAnswer ? (
        <div ref={answerRef} data-answer className="select-text">
          <AnswerBlocks
            blocks={blocks}
            index={index}
            density={density}
            live={fades && streaming}
            turn={{ generationId: turn.generationId, question: turn.question, place, canAct: !streaming && !busy, firstCited: sources[0] ?? null }}
          />
        </div>
      ) : null}

      {turn.choice ? (
        <Choice generationId={turn.generationId} choice={turn.choice} place={place} answeredBy={answeredBy} canPick={canPick} />
      ) : null}
      {/* The changes it proposes, inside the turn, under their bar. */}
      {turn.proposals?.length ? <Proposals generationId={turn.generationId} proposals={turn.proposals} streaming={streaming} /> : null}
      {!streaming && turn.status === 'complete' && !turn.proposals?.length && !turn.choice && speaksOfChanges(answer) ? (
        <div className="mt-2 px-1 text-[12.5px] leading-relaxed text-muted" data-no-changes>
          {NO_CHANGES_CAME}
        </div>
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

      {/* Once the answer has ended: the entries it used, up to three follow-ups, and its actions. */}
      {!streaming && sources.length ? <SourcesRow targets={sources} className={compact ? 'mt-2' : 'mt-3'} /> : null}
      {followUps.length ? <FollowUps questions={followUps} onPick={onPick} className={compact ? 'mt-2' : 'mt-2.5'} /> : null}
      {!streaming && (hasAnswer || recorded) ? (
        <ActionBar
          turn={answer === turn.answer ? turn : { ...turn, answer }}
          answerRef={answerRef}
          index={index}
          place={place}
          hasAnswer={hasAnswer}
          recorded={recorded}
          endNote={endNote}
          cost={cost}
          onRetry={isLast && !busy && !notice ? retry : undefined}
        />
      ) : null}
    </li>
  )
}

/** Up to three questions the answer suggests asking next; one fills the box, to change or ask as it is. */
function FollowUps({ questions, onPick, className }: { questions: string[]; onPick: (question: string) => void; className?: string }): React.JSX.Element {
  return (
    <div data-follow-ups role="group" aria-label="Ask next" className={cn('flex flex-wrap gap-1.5 px-1', className)}>
      {questions.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => onPick(q)}
          title="Put this question in the box"
          className="group/next flex max-w-full animate-fade-in items-center gap-1.5 rounded-full border border-line py-1 pl-2 pr-2.5 text-left text-[12.5px] leading-snug text-muted transition-[background-color,border-color,color] duration-150 hover:border-line-strong hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        >
          <CornerDownRight size={12} aria-hidden className="shrink-0 text-faint transition-colors duration-150 group-hover/next:text-accent" />
          <span className="min-w-0 truncate">{q}</span>
        </button>
      ))}
    </div>
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

// ---------- The box ----------

const chip =
  'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11.5px] leading-none whitespace-nowrap transition-[background-color,border-color,color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus'

/**
 * The row over the box, always the same height so the box never jumps: quick actions while the box is empty (each
 * fills it with the start of a question), the quoted words while a question quotes them (× takes them out), and a
 * reminder of the keys while Adam types.
 */
function ContextRow({ draft, onFill }: { draft: string; onFill: (text: string) => void }): React.JSX.Element {
  const quote = quoteIn(draft, useAsk((s) => s.quote))
  return (
    // A narrow panel scrolls the chips sideways (no scroll bar) rather than cutting one off.
    <div
      className={cn(
        'flex h-8 min-w-0 items-center gap-1 overflow-x-auto px-2 pt-1.5 [scrollbar-width:none]',
        // The quick actions fade at the right edge, so one that runs past it reads as more to scroll to.
        !quote && !draft.trim() && '[mask-image:linear-gradient(to_right,black_88%,transparent)]'
      )}
      data-context-row
    >
      {quote ? (
        <span className={cn(chip, 'min-w-0 max-w-full border-accent/40 bg-accent-soft pr-0.5 text-fg')} data-quote-chip title={quote.text}>
          <TextQuote size={12} aria-hidden className="shrink-0 text-accent" />
          <span className="min-w-0 truncate">{quote.mode === 'edit' ? 'Editing' : 'About'} “{quote.text}”</span>
          <button
            type="button"
            onClick={removeQuote}
            aria-label="Take the quoted words out of the question"
            title="Take the quoted words out"
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
          >
            <X size={11} />
          </button>
        </span>
      ) : !draft.trim() ? (
        QUICK_ACTIONS.map((q) => {
          const Icon = STARTER_ICONS[q.kind]
          return (
            <button
              key={q.label}
              type="button"
              onClick={() => onFill(q.fill)}
              title={`Start a question: “${q.fill.trim()}…”`}
              className={cn(chip, 'group/quick shrink-0 border-line text-muted hover:border-line-strong hover:bg-surface-2 hover:text-fg')}
            >
              <Icon size={11} aria-hidden className={cn('shrink-0', STARTER_TEXT[q.kind])} />
              {q.label}
            </button>
          )
        })
      ) : (
        <span className="truncate px-1 text-[11.5px] text-faint">Enter to ask · Shift+Enter for a new line</span>
      )}
    </div>
  )
}

function AskBox({
  boxRef,
  place,
  asOf,
  asOfTitle,
  onFill
}: {
  boxRef: RefObject<HTMLTextAreaElement | null>
  place: AskPlace
  asOf: string
  asOfTitle: string
  /** Puts words in the box (a quick action), with the keyboard at their end. */
  onFill: (text: string) => void
}): React.JSX.Element {
  const draft = useAsk((s) => s.draft)
  const running = useAsk((s) => !!s.running)
  const loading = useAsk((s) => s.loading)
  // Edit this: the question asks for a change to the words it quotes (sent with mode 'edit'), while it still quotes them.
  const quote = quoteIn(draft, useAsk((s) => s.quote))
  const editing = quote?.mode === 'edit'
  useFitHeight(boxRef, draft, 2, 8)

  const send = (): void => void sendBox(place)

  return (
    <form
      className="shrink-0 border-t border-line px-3 pb-3 pt-2.5"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <div className="rounded-lg border border-line bg-page transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 hover:border-line-strong focus-within:hover:border-accent">
        <ContextRow draft={draft} onFill={onFill} />
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
          {editing && quote ? (
            // In the place of "as of", so nothing in the box moves.
            <span className="flex min-w-0 flex-1 animate-fade-in items-center gap-1 px-1 text-[11.5px] text-accent" data-edit-mode>
              <PenLine size={12} className="shrink-0" aria-hidden />
              <span className="min-w-0 truncate" title="Say what to change in the quoted words. The chat proposes the change for you to apply.">
                Say what to change
              </span>
              <button
                type="button"
                onClick={() => setQuote({ ...quote, mode: null })}
                title="Ask about the quoted words instead of asking for a change"
                className="shrink-0 rounded-sm px-1 text-faint underline-offset-2 hover:text-fg hover:underline"
              >
                Just ask
              </button>
            </span>
          ) : (
            // The scene the answers are from, as a chip: its tooltip says what that means.
            <span className="flex min-w-0 flex-1 px-0.5">
              <span className={cn(chip, 'min-w-0 cursor-default border-line text-faint')} title={asOfTitle} data-as-of>
                <BookOpenText size={11} aria-hidden className="shrink-0" />
                <span className="min-w-0 truncate">{asOf}</span>
              </span>
            </span>
          )}
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
              {editing ? 'Edit' : 'Ask'}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
