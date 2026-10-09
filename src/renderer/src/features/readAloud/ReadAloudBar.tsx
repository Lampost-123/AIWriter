// The player bar above the page while reading: Back one line, Play or Pause (the big coloured button), Next line and
// Stop; who is speaking and how ("Mara · quiet and wary"), with the chapter and scene it is reading ("Chapter 3 · The
// Ferry", which brings the line being read into view) and the paragraph it is in; the speed; whether Emotion and
// tone is on; Close; and a thin line along its foot showing how far through the scene reading is. Rendered by
// SceneView between the scene header and the page. Owned by the Read aloud part.
//
// It lies over the top edge of the page rather than pushing the page down, so the words never move when it
// comes and goes; it fades in and out, and keeps one height while it plays. While it shows, the page keeps the cursor
// and the sentence being read clear of it (highlight.ts, follow.ts). It also hands the page to the reading
// (control.ts) and listens for Ctrl+Shift+Space, which stops reading from anywhere. In a narrow page the labels
// shorten (the speed's arrow and Emotion and tone's words go first); the buttons always keep their room. The speaker's
// name, when they are a character in the world, opens their read-aloud voice (voiceReveal.ts).
import * as M from '@radix-ui/react-dropdown-menu'
import * as P from '@radix-ui/react-popover'
import type { Editor } from '@tiptap/core'
import { Check, ChevronDown, CircleAlert, Drama, Pause, Play, RotateCcw, SkipBack, SkipForward, Square, X } from '@/components/ui/icons'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ID } from '@shared/types'
import { Button, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { isShortcut, withShortcut } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { api } from '@/lib/api'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { PopoverPanel } from '@/features/generate/parts'
import { SceneMuteButton } from '@/features/sounds/SceneMuteButton'
import { Switch } from '@/features/world/parts/Switch'
import {
  attachPage,
  closeReading,
  listenAgain,
  openHowItReads,
  openSpeechSettings,
  pauseReading,
  redoLine,
  resumeReading,
  saveSpeech,
  sceneShown,
  setSpeed,
  showReading,
  skipLine,
  SPEEDS,
  speedText,
  stepBack,
  stepNext,
  stopReading,
  useReading,
  type ReadingBar
} from './control'
import { openEntryVoice } from './voiceReveal'
import { setBarRoom } from './highlight'
import { useNewLook } from '@/features/look/look'
import { playingPlace } from './playing'
import { onOff, SOUNDS_OFF, SOUNDS_ON, TONE_OFF, TONE_ON, toneTooltip } from './tone'
import { stopSample } from './useSample'
import './readAloud.css'

/** The bar is a player (its buttons, speed and Emotion and tone) unless it is saying what went wrong, or that it is done. */
const isPlayer = (bar: ReadingBar): boolean => bar.phase !== 'problem' && bar.phase !== 'finished'

export function ReadAloudBar({
  editor,
  sceneId,
  scrollerRef
}: {
  editor: Editor
  sceneId: ID | null
  scrollerRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element | null {
  const bar = useReading((s) => s.bar)
  const readingScene = useReading((s) => s.sceneId)

  useEffect(() => attachPage(editor, () => scrollerRef.current), [editor, scrollerRef])
  useEffect(() => sceneShown(sceneId), [sceneId])

  // Ctrl+Shift+Space stops reading (and any sample) from anywhere in the window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isShortcut(e, 'stopReading')) return
      const { reading, bar: shown } = useReading.getState()
      if (!reading && shown?.phase !== 'starting') {
        stopSample()
        return
      }
      e.preventDefault()
      stopReading()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The bar fades out with what it last said, rather than vanishing.
  const [shown, setShown] = useState<ReadingBar | null>(bar)
  const [leaving, setLeaving] = useState(false)
  const last = useRef(bar)
  useEffect(() => {
    if (bar) {
      last.current = bar
      setShown(bar)
      setLeaving(false)
      return
    }
    if (!last.current) return
    setLeaving(true)
    const t = setTimeout(() => {
      last.current = null
      setShown(null)
      setLeaving(false)
    }, 160)
    return () => clearTimeout(t)
  }, [bar])

  // While it shows, the room it takes over the top of the page: the cursor is scrolled clear of it, and so is
  // anything brought into view (the page's own scroll padding).
  // The New look: the bar floats at the foot of the page instead (16px clear of its edge), so the room is kept there.
  const box = useRef<HTMLDivElement>(null)
  const open = !!shown
  const atFoot = useNewLook()
  useLayoutEffect(() => {
    const el = box.current
    const page = scrollerRef.current
    if (!open || !el) return
    // On the desk the AI dock also floats at the foot of the sheet: it is lifted clear of the bar (--read-aloud-lift,
    // read by SceneView), and the room kept for the line being read takes in the dock too.
    const sheet = el.closest<HTMLElement>('.scene-sheet')
    const dock = atFoot ? sheet?.querySelector<HTMLElement>('[data-desk-dock]') : null
    const room = (): void => {
      const bar = el.offsetHeight
      sheet?.style.setProperty('--read-aloud-lift', `${atFoot ? bar + 12 : 0}px`)
      const px = bar + (atFoot ? 16 : 0) + (dock ? dock.offsetHeight + 12 : 0)
      setBarRoom(px, atFoot ? 'bottom' : 'top')
      if (page) page.style[atFoot ? 'scrollPaddingBottom' : 'scrollPaddingTop'] = `${px}px`
    }
    room()
    const ro = new ResizeObserver(room)
    ro.observe(el)
    if (dock) ro.observe(dock)
    return () => {
      ro.disconnect()
      sheet?.style.removeProperty('--read-aloud-lift')
      setBarRoom(0)
      if (page) {
        page.style.scrollPaddingTop = ''
        page.style.scrollPaddingBottom = ''
      }
    }
  }, [open, scrollerRef, atFoot])

  if (!shown) return null
  const player = isPlayer(shown)
  return (
    <div className="relative z-20 h-0 shrink-0 look-new:static">
      <div
        ref={box}
        role="region"
        aria-label="Reading aloud"
        className={cn(
          'aw-bar @container absolute inset-x-0 top-0 font-sans',
          'look-new:inset-x-4 look-new:top-auto look-new:bottom-4 look-new:z-20',
          'transition-opacity duration-150',
          leaving ? 'pointer-events-none opacity-0' : 'animate-fade-in'
        )}
      >
        <div className="flex min-h-12 items-center gap-2 pb-[3px] pl-2 pr-1.5 @min-[560px]:gap-3 @min-[560px]:pl-3">
          {player ? <Transport bar={shown} /> : null}
          {/* Thin rules part the buttons, the words and the settings, when the bar has room for them. */}
          {player ? <Rule /> : null}
          <Words bar={shown} />
          {player ? <Rule /> : null}
          {player ? (
            <div className="flex shrink-0 items-center gap-1.5">
              {/* Sound effects: mute the scene being read (only while they are on). */}
              <SceneMuteButton sceneId={readingScene} />
              <SpeedMenu />
              <ToneChip />
            </div>
          ) : null}
          <Actions bar={shown} />
        </div>
        <ProgressLine bar={shown} />
      </div>
    </div>
  )
}

// ---------- The buttons ----------

/** A thin upright rule between the bar's groups; hidden in a narrow bar. */
function Rule(): React.JSX.Element {
  return <span aria-hidden className="hidden h-6 w-px shrink-0 bg-line @min-[560px]:block" />
}

/** A round button in the bar: coloured with the accent, its name as a tooltip. */
function RoundButton({
  label,
  onClick,
  disabled,
  quiet,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  /** Close: grey rather than coloured. */
  quiet?: boolean
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full outline-none transition-colors duration-150',
        'focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-35',
        quiet ? 'text-muted hover:bg-surface-2 hover:text-fg' : 'text-accent hover:bg-accent/15'
      )}
    >
      {children}
    </button>
  )
}

/** Back one line, Play or Pause, Next line and Stop. After Stop, the big button carries on from where it stopped. */
function Transport({ bar }: { bar: ReadingBar }): React.JSX.Element {
  const stopped = bar.phase === 'stopped'
  const paused = bar.phase === 'paused'
  // Stepping needs a line playing (or paused); not while the first lines are got ready.
  const step = bar.phase === 'playing' || paused
  const label = stopped ? 'Carry on' : paused ? withShortcut('Carry on', 'listen') : withShortcut('Pause', 'listen')
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <RoundButton label="Back one line" onClick={stepBack} disabled={!step}>
        <SkipBack size={16} fill="currentColor" strokeWidth={1.75} />
      </RoundButton>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => (stopped ? listenAgain() : paused ? resumeReading() : pauseReading())}
        className={cn(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg shadow-soft outline-none',
          // A press, in both looks: in quickly (90ms), back softly (150ms). (scale-* is the CSS scale property, so it is listed.)
          'transition-[background-color,transform,scale] duration-150 ease-press hover:bg-accent-hover active:duration-(--dur-press) active:scale-95',
          'focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-page'
        )}
      >
        {stopped || paused ? (
          <Play size={16} fill="currentColor" className="translate-x-px" />
        ) : (
          <Pause size={16} fill="currentColor" strokeWidth={1.5} />
        )}
      </button>
      <RoundButton label="Next line" onClick={stepNext} disabled={!step}>
        <SkipForward size={16} fill="currentColor" strokeWidth={1.75} />
      </RoundButton>
      <RoundButton label="Redo this line" onClick={redoLine} disabled={!step} quiet>
        <RotateCcw size={15} strokeWidth={2} />
      </RoundButton>
      <RoundButton label={withShortcut('Stop reading', 'stopReading')} onClick={stopReading} disabled={stopped}>
        <Square size={13} fill="currentColor" />
      </RoundButton>
    </div>
  )
}

// ---------- Who is speaking, and where ----------

/** Moving bars while a voice speaks; still when paused; a spinner while lines are got ready. */
function Indicator({ phase }: { phase: ReadingBar['phase'] }): React.JSX.Element | null {
  if (phase === 'starting' || phase === 'waiting') return <Spinner size={14} className="shrink-0 text-accent" />
  if (phase === 'problem') return <CircleAlert size={15} className="shrink-0 text-danger" aria-hidden />
  if (phase !== 'playing' && phase !== 'paused') return null
  return (
    <span className="aw-speaking flex h-3.5 w-3.5 shrink-0 items-end justify-center gap-[2px]" data-live={phase === 'playing'} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="block h-full w-[3px] rounded-full bg-accent" />
      ))}
    </span>
  )
}

/** The world's characters by name, so the bar's speaker can open their voice. */
function useCharacterIds(): ReadonlyMap<string, ID> {
  const rev = useApp((s) => s.entriesRev)
  const worldId = useApp((s) => s.world?.id ?? null)
  const [ids, setIds] = useState<ReadonlyMap<string, ID>>(new Map())
  useEffect(() => {
    if (!worldId) return
    let live = true
    api
      .listEntries('character')
      .then((list) => live && setIds(new Map(list.map((e) => [e.name.trim(), e.id]))))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [rev, worldId])
  return ids
}

/** Who is speaking: a character's name opens their read-aloud voice; the narrator and "Someone" are plain words. */
function Speaker({ who }: { who: string }): React.JSX.Element {
  const id = useCharacterIds().get(who.trim())
  if (!id) return <span className="font-semibold text-fg">{who}</span>
  return (
    <button
      type="button"
      title={`${who}’s read-aloud voice`}
      onClick={() => openEntryVoice(id)}
      className="rounded-sm font-semibold text-fg underline decoration-dotted decoration-faint underline-offset-2 outline-none transition-colors duration-150 hover:text-accent hover:decoration-accent focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {who}
    </button>
  )
}

function Words({ bar }: { bar: ReadingBar }): React.JSX.Element {
  const speaking = (bar.phase === 'playing' || bar.phase === 'paused') && !!bar.who
  // Which paragraph, while it reads and where it stopped.
  const where = bar.at && bar.phase !== 'starting' && isPlayer(bar) ? `Paragraph ${bar.at.paragraph} of ${bar.at.paragraphs}` : null
  return (
    <div className={cn('flex min-w-0 flex-1 items-center gap-2', !isPlayer(bar) && 'pl-2')}>
      <Indicator phase={bar.phase} />
      <div className="min-w-0 flex-1">
        <p
          // What went wrong may take two lines (the bar grows over the page, so nothing moves); the rest is one line. The
          // room around two lines is margin, not padding, so no part of a third line shows in it.
          className={cn('text-[13px]', bar.phase === 'problem' ? 'my-2 line-clamp-2 leading-snug' : 'truncate leading-tight')}
          aria-live={bar.phase === 'problem' || bar.phase === 'stopped' || bar.phase === 'finished' ? 'polite' : undefined}
          title={speaking ? [bar.who, bar.how].filter(Boolean).join(' · ') : bar.note}
        >
          {speaking ? (
            <>
              <Speaker who={bar.who} />
              {bar.how ? <span className="text-muted"> · {bar.how}</span> : null}
              {bar.phase === 'paused' ? <span className="text-accent"> · Paused</span> : null}
            </>
          ) : bar.phase === 'paused' ? (
            <span className="text-accent">Paused</span>
          ) : (
            <span className={bar.phase === 'problem' ? 'text-fg' : 'text-muted'}>{bar.note}</span>
          )}
        </p>
        {isPlayer(bar) ? <Where paragraph={where} /> : null}
      </div>
    </div>
  )
}

/**
 * Under who is speaking: the chapter and scene being read ("Chapter 3 · The Ferry"; the chapter's own title is in the
 * tooltip), which brings the line being read into view, and the paragraph ("Paragraph 2 of 5") when the bar has room
 * for both (the tooltip says it always). The line keeps its height while the names load, so nothing moves. A long scene
 * title is cut short.
 */
function Where({ paragraph }: { paragraph: string | null }): React.JSX.Element {
  const sceneId = useReading((s) => s.sceneId)
  const outline = useOutlineStore((s) => s.outline)
  const place = playingPlace(outline, sceneId)
  return (
    <div className="mt-0.5 flex h-[15px] min-w-0 items-center whitespace-nowrap text-[11.5px] leading-tight text-muted">
      {place ? (
        <button
          type="button"
          aria-label={`${place.chapter} · ${place.scene}`}
          title={`${place.chapterName} · ${place.scene}${paragraph ? `, ${paragraph.toLowerCase()}` : ''}. Click to show the line being read.`}
          onClick={showReading}
          className={cn(
            'flex min-w-0 items-center rounded-sm outline-none transition-colors duration-150',
            'hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50'
          )}
        >
          <span className="shrink-0">{place.chapter}</span>
          <span className="shrink-0 px-1">·</span>
          <span className="min-w-[2.5em] truncate font-medium text-fg/80">{place.scene}</span>
        </button>
      ) : null}
      {paragraph ? (
        <span className="hidden shrink-0 tabular-nums @min-[720px]:inline">
          {place ? <span className="px-1">·</span> : null}
          {paragraph}
        </span>
      ) : null}
    </div>
  )
}

/** The thin line along the bar's foot: how far through the scene's words reading is. */
function ProgressLine({ bar }: { bar: ReadingBar }): React.JSX.Element {
  const share = bar.phase === 'finished' ? 1 : (bar.at?.share ?? 0)
  return (
    <div className="absolute inset-x-0 bottom-0 h-[3px] bg-accent/20" aria-hidden>
      <div className="h-full bg-accent transition-[width] duration-300 ease-linear" style={{ width: `${share * 100}%` }} />
    </div>
  )
}

// ---------- Speed, and Emotion and tone ----------

/** The speed ("1×"), with a short list to pick another: heard at once, and saved as the read-aloud speed. */
function SpeedMenu(): React.JSX.Element {
  const speed = useApp((s) => s.settings?.speech.speed ?? 1)
  const speeds = SPEEDS.includes(speed) ? SPEEDS : [...SPEEDS, speed].sort((a, b) => a - b)
  return (
    <M.Root modal={false}>
      <M.Trigger
        aria-label={`Speed: ${speedText(speed)}`}
        title="Reading speed"
        className={cn(
          'flex h-8 shrink-0 items-center gap-0.5 rounded-full border border-accent/35 bg-page px-2.5 text-[12.5px] font-semibold tabular-nums text-accent',
          'outline-none transition-colors duration-150 hover:border-accent/70 hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent/50 data-[state=open]:border-accent'
        )}
      >
        {speedText(speed)}
        <ChevronDown size={12} className="hidden @min-[480px]:block" aria-hidden />
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 min-w-[150px] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
        >
          <M.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-medium text-faint">Reading speed</M.Label>
          <M.RadioGroup value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
            {speeds.map((v) => (
              <M.RadioItem
                key={v}
                value={String(v)}
                className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-fg outline-none data-[highlighted]:bg-surface-2"
              >
                <span className="flex-1 tabular-nums">
                  {speedText(v)}
                  {v === 1 ? <span className="text-muted"> (normal)</span> : null}
                </span>
                <M.ItemIndicator>
                  <Check size={14} className="text-accent" />
                </M.ItemIndicator>
              </M.RadioItem>
            ))}
          </M.RadioGroup>
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}

/**
 * "Emotion and tone: On" (or Off): whether the AI notes how each line is said (Mark who says what), with sighs and
 * laughs beside it (Perform written sounds). Clicking it says what they do and turns them on or off.
 */
function ToneChip(): React.JSX.Element | null {
  const speech = useApp((s) => s.settings?.speech)
  const [open, setOpen] = useState(false)
  if (!speech) return null
  const on = speech.markSpeakers
  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Trigger
        aria-label={`Emotion and tone: ${onOff(on)}`}
        title={toneTooltip(speech)}
        className={cn(
          'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium outline-none transition-colors duration-150',
          'focus-visible:ring-2 focus-visible:ring-accent/50',
          on
            ? 'border-ai/40 bg-ai-soft text-ai hover:border-ai/70 data-[state=open]:border-ai'
            : 'border-line-strong bg-surface-2 text-muted hover:text-fg data-[state=open]:text-fg'
        )}
      >
        <Drama size={14} className="shrink-0" aria-hidden />
        <span className="whitespace-nowrap">
          <span className="hidden @min-[640px]:inline">Emotion and tone: </span>
          <span className="hidden @min-[440px]:inline @min-[640px]:hidden">Tone: </span>
          <span className={on ? 'font-semibold' : undefined}>{onOff(on)}</span>
        </span>
      </P.Trigger>
      <PopoverPanel className="w-[340px]" align="end">
        <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-fg">
          <Drama size={15} className="text-ai" aria-hidden />
          How the lines are performed
        </h3>
        <div className="mt-3 flex flex-col gap-2">
          <ToneSwitch
            label="Emotion and tone"
            checked={speech.markSpeakers}
            onChange={(markSpeakers) => saveSpeech({ markSpeakers })}
            text={speech.markSpeakers ? TONE_ON : TONE_OFF}
          />
          <ToneSwitch
            label="Sighs and laughs"
            checked={speech.sounds}
            onChange={(sounds) => saveSpeech({ sounds })}
            text={speech.sounds ? SOUNDS_ON : SOUNDS_OFF}
          />
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-faint">
          A change is heard from the next lines. In Settings › Read aloud and dictation, under More › How it reads, these are Mark who says
          what (marked by the writer) and Perform written sounds.
        </p>
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setOpen(false)
              openHowItReads()
            }}
          >
            Open settings
          </Button>
        </div>
      </PopoverPanel>
    </P.Root>
  )
}

function ToneSwitch({
  label,
  checked,
  onChange,
  text
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  text: string
}): React.JSX.Element {
  const id = useId()
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border px-3 py-2.5', checked ? 'border-ai/30 bg-ai-soft/60' : 'border-line')}>
      <Switch id={id} checked={checked} onChange={onChange} aria-describedby={`${id}-help`} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={id} className="text-[13px] font-medium text-fg">
            {label}
          </label>
          <span className={cn('text-[12px] font-semibold', checked ? 'text-ai' : 'text-muted')}>{onOff(checked)}</span>
        </div>
        <p id={`${id}-help`} className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
          {text}
        </p>
      </div>
    </div>
  )
}

// ---------- What went wrong, and Close ----------

function Actions({ bar }: { bar: ReadingBar }): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {bar.phase === 'problem' && bar.fix === 'settings' ? (
        <Button size="sm" variant="primary" onClick={openSpeechSettings}>
          Open speech settings
        </Button>
      ) : null}
      {bar.phase === 'problem' && bar.fix ? (
        <Button size="sm" variant={bar.fix === 'retry' ? 'primary' : 'secondary'} onClick={listenAgain}>
          Try again
        </Button>
      ) : null}
      {bar.phase === 'problem' && bar.skip ? (
        <Button size="sm" variant="secondary" onClick={skipLine}>
          Skip this line
        </Button>
      ) : null}
      <RoundButton label="Close" onClick={closeReading} quiet>
        <X size={16} />
      </RoundButton>
    </div>
  )
}
