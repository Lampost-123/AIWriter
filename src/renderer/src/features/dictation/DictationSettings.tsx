// Settings › Read aloud and dictation, dictation's parts (milestone 4). Everyday: the hold-to-talk key
// (press the key to use; Esc clears it), and, when the speech engine can't write words down yet, why in
// plain words with a way to its settings at the top of the page. More: the microphone (the computer's
// default to start) and its Test, a live level meter with a try-it box that shows what was heard. The
// engine choice and its download are the speech engine's own settings. Owned by the Dictation part.
import { Mic, Square } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { SpeechStatus } from '@shared/contracts/speech'
import { Button, Notice, Select, SettingsSection, Textarea, type SelectOption } from '@/components/ui'
import { isMac } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { DictationLayer } from './DictationLayer'
import { insertIntoBox } from './insertText'
import { isModifierKey, keptKey, keyName, refusal } from './keys'
import { useMicLevel } from './Marker'
import { listMicrophones } from './mic'
import { useSpeechEngine } from './ready'
import { cancelRecording, finishRecording, setPickingKey, startRecording, useDictation } from './session'

export function DictationSettings({ section }: { section: 'everyday' | 'more' }): React.JSX.Element {
  return section === 'everyday' ? <HoldToTalk /> : <Microphone />
}

// ---------- Everyday: the hold-to-talk key ----------

function HoldToTalk(): React.JSX.Element {
  // With no world open, the workspace (and the hold-to-talk it carries) isn't there: this page carries
  // it instead, so the key can be tried in the try-it box.
  const worldOpen = useApp((s) => !!s.world)
  return (
    <SettingsSection
      title="Dictation"
      description="Hold a key and talk instead of typing. When you let go, your words are typed where the cursor is: in the scene, a scene card, the chat or any other text box."
    >
      <KeyPicker />
      <EngineNotice className="mt-3 max-w-2xl" />
      {worldOpen ? null : <DictationLayer />}
    </SettingsSection>
  )
}

const ONE_KEY = 'Pick one key on its own, not a combination: such as F9, Right Ctrl or Right Alt.'

function KeyPicker(): React.JSX.Element {
  const key = useApp((s) => s.settings?.speech?.dictationKey ?? '')
  const update = useApp((s) => s.updateSettings)
  const [picking, setPicking] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const labelId = useId()
  const hintId = useId()
  const mac = isMac()
  const name = keyName(key, mac)

  useEffect(() => {
    if (!picking) return
    setPickingKey(true)
    const choose = (k: string): void => {
      setPicking(false)
      void update({ speech: { dictationKey: k } })
    }
    // A Ctrl, Shift or Alt key is taken as it comes up, when nothing was pressed with it.
    let modifier: { code: string; at: number } | null = null
    let combined = false
    // Keys that went down here: one that only comes up was kept by the window (F5, F12).
    const seen = new Set<string>()

    const onDown = (e: KeyboardEvent): void => {
      // Tab (or Shift+Tab) moves on, as from any other control.
      if (e.code === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        setPicking(false)
        return
      }
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      seen.add(e.code)
      if (e.key === 'Escape') {
        // Esc clears the key: no hold-to-talk.
        choose('')
        return
      }
      if (isModifierKey(e.code)) {
        // Right Alt on many keyboards (AltGr) brings a left Ctrl of its own a moment before it.
        if (modifier?.code === 'ControlLeft' && e.code === 'AltRight' && e.timeStamp - modifier.at < 80)
          modifier = { code: e.code, at: e.timeStamp }
        else if (modifier) combined = true
        else modifier = { code: e.code, at: e.timeStamp }
        return
      }
      if (modifier || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) {
        combined = true
        setRefused(ONE_KEY)
        return
      }
      const why = refusal(e.key)
      if (why) setRefused(why)
      else choose(keptKey(e))
    }

    const onUp = (e: KeyboardEvent): void => {
      if (e.code === 'Tab') return
      e.preventDefault()
      e.stopPropagation()
      if (modifier && e.code === modifier.code) {
        if (!combined) choose(e.code)
        modifier = null
        combined = false
        return
      }
      if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        modifier = null
        combined = false
      }
      if (!seen.has(e.code) && !isModifierKey(e.code)) {
        const why = refusal(e.key)
        if (why) setRefused(why)
      }
    }

    // Clicking anywhere else, or going to another window, stops picking and keeps the key as it was.
    const onPointer = (e: PointerEvent): void => {
      if (!button.current?.contains(e.target as Node)) setPicking(false)
    }
    const onBlur = (): void => setPicking(false)

    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('blur', onBlur)
    return () => {
      setPickingKey(false)
      setRefused(null)
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [picking, update])

  const hint =
    refused ??
    (picking
      ? 'Press the key you want to hold while you talk. Esc clears it.'
      : !key
        ? "No key yet. Pick one you don't type with, such as F9, Right Ctrl or Right Alt."
        : isModifierKey(key)
          ? `Hold ${name} on its own and talk, then let go. With another key it works as usual, so ${mac ? '⌘' : 'Ctrl'}+C still copies.`
          : `Hold ${name} and talk, then let go.`)

  return (
    <div className="flex max-w-md flex-col">
      <span id={labelId} className="text-[12px] font-medium text-muted">
        Hold-to-talk key
      </span>
      <div className="mt-1 flex items-center gap-2">
        <span
          data-testid="dictation-key"
          className={cn(
            'inline-flex h-8 min-w-[120px] items-center justify-center rounded-md border bg-page px-3 text-[13px] font-medium transition-[border-color,box-shadow] duration-150',
            picking ? 'border-accent text-muted ring-2 ring-accent/20' : 'border-line-strong shadow-[inset_0_-1px_0_var(--line-strong)]',
            !picking && (key ? 'text-fg' : 'text-faint')
          )}
        >
          {picking ? 'Press a key…' : key ? name : 'None'}
        </span>
        <Button
          ref={button}
          aria-describedby={`${labelId} ${hintId}`}
          onClick={() => {
            setRefused(null)
            setPicking((p) => !p)
          }}
        >
          {picking ? 'Cancel' : key ? 'Change' : 'Pick a key'}
        </Button>
      </div>
      <p
        id={hintId}
        aria-live="polite"
        className={cn('mt-1.5 min-h-[36px] text-[12px] leading-[18px]', refused ? 'text-danger' : 'text-faint')}
      >
        {hint}
      </p>
    </div>
  )
}

/** Why dictation can't write words down yet, in this page's words. Null when it can (or isn't known yet). */
function notReadyHere(status: SpeechStatus | null): string | null {
  if (!status || status.dictationReady) return null
  if (status.server === 'starting') return 'The speech engine is starting. Dictation can be used as soon as it is ready.'
  if (status.server === 'connected') return 'Dictation needs a dictation model: pick Parakeet or Whisper at the top of this page.'
  return "Dictation needs the speech engine, which isn't running. Start it at the top of this page."
}

/** Scrolls this Settings page up to the speech engine's settings, which come first on it. */
function toSpeechEngine(from: HTMLElement | null): void {
  from?.closest('.overflow-auto')?.scrollTo({ top: 0, behavior: 'smooth' })
}

function EngineNotice({ className }: { className?: string }): React.JSX.Element | null {
  const status = useSpeechEngine()
  const ref = useRef<HTMLDivElement>(null)
  const text = notReadyHere(status)
  if (!text) return null
  return (
    <div ref={ref} className={className}>
      <Notice
        action={
          status?.server === 'starting' ? undefined : (
            <Button size="sm" onClick={() => toSpeechEngine(ref.current)}>
              Go to the speech engine
            </Button>
          )
        }
      >
        {text}
      </Notice>
    </div>
  )
}

// ---------- More: the microphone and its Test ----------

/** Windows' own stand-ins for "whichever is the default": the first choice covers them. */
const STAND_INS = new Set(['', 'default', 'communications'])

/** A microphone's name without the hardware numbers some computers add ("USB Mic (0d8c:0014)"). */
const tidyName = (label: string): string => label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim()

/** The microphones plugged in now (null until known). Their names show once a microphone has been used. */
function useMicrophones(): { list: SelectOption[] | null; refresh: () => void } {
  const [list, setList] = useState<SelectOption[] | null>(null)
  const refresh = useCallback(() => {
    void listMicrophones().then((devices) =>
      setList(
        devices
          .filter((d) => !STAND_INS.has(d.deviceId))
          .map((d, i) => ({ value: d.deviceId, label: tidyName(d.label) || `Microphone ${i + 1}` }))
      )
    )
  }, [])
  useEffect(() => {
    refresh()
    const media = navigator.mediaDevices
    media?.addEventListener?.('devicechange', refresh)
    return () => media?.removeEventListener?.('devicechange', refresh)
  }, [refresh])
  return { list, refresh }
}

const QUIET = "The microphone didn't hear anything. Check it's the right one, and that it isn't muted."

interface TestNote {
  text: string
  tone?: 'muted' | 'danger'
  /** The fix is in the speech engine's settings. */
  engine?: boolean
}

function Microphone(): React.JSX.Element {
  const saved = useApp((s) => s.settings?.speech?.microphone ?? '')
  const key = useApp((s) => s.settings?.speech?.dictationKey ?? '')
  const update = useApp((s) => s.updateSettings)
  const status = useSpeechEngine()
  const { list, refresh } = useMicrophones()
  const rec = useDictation((s) => s.recordings.find((r) => r.by === 'test') ?? null)
  const listening = rec?.phase === 'listening'
  const level = useMicLevel(listening)
  const [note, setNote] = useState<TestNote | null>(null)
  const [heard, setHeard] = useState('')
  const tryBox = useRef<HTMLTextAreaElement>(null)
  const noteRef = useRef<HTMLDivElement>(null)
  const selectId = useId()
  const tryId = useId()

  // Leaving the page stops a Test that is still listening, without writing it down.
  useEffect(
    () => () => {
      const r = useDictation.getState().recordings.find((x) => x.by === 'test' && x.phase !== 'writing')
      if (r) cancelRecording(r.id)
    },
    []
  )

  const options: SelectOption[] = list ?? []
  const known = !saved || options.some((o) => o.value === saved)
  // Before any microphone has been used the list has no names or ids to go by, so nothing is said to be missing.
  const missing = !known && options.length > 0
  const shown = known
    ? options
    : [{ value: saved, label: missing ? 'The microphone you picked (not plugged in)' : 'The microphone you picked' }, ...options]

  const test = (): void => {
    if (rec) {
      if (rec.phase === 'writing') return
      // Without the speech engine there's nothing to write the words down: the level was the test.
      const notReady = notReadyHere(status)
      if (notReady) {
        cancelRecording(rec.id)
        setNote({ text: notReady, engine: status?.server !== 'starting' })
        return
      }
      finishRecording(rec.id)
      return
    }
    setNote(null)
    const id = startRecording({
      owner: 'test',
      by: 'test',
      deliver: (text) => {
        if (tryBox.current) insertIntoBox(tryBox.current, text, setHeard)
        setNote({ text: "That's what the microphone heard. If a word came out wrong, try again a little closer to it." })
      },
      onProblem: (message, code) =>
        setNote({ text: message, tone: 'danger', engine: code === 'speech-not-running' || code === 'dictation-not-ready' }),
      onNothing: (why) =>
        setNote(
          why === 'quiet'
            ? { text: QUIET, tone: 'danger' }
            : why === 'no-words'
              ? { text: 'No words were heard. Try again, a little closer to the microphone.' }
              : { text: 'That was very short. Click Test, say a sentence, then click Stop.' }
        ),
      onFellBack: () => setNote({ text: "The microphone you picked isn't plugged in, so this is the computer's default." })
    })
    if (id == null) setNote({ text: 'Dictation is listening somewhere else. Stop that first, then try again.' })
    // The microphones' names show once one has been used.
    else refresh()
  }

  const stateLine = note
    ? null
    : rec?.phase === 'writing'
      ? 'Writing it down…'
      : listening
        ? 'Listening. Say a sentence or two, then click Stop.'
        : rec
          ? 'Starting the microphone…'
          : null

  return (
    <SettingsSection
      title="Microphone"
      description="The microphone dictation listens to. Test it to see how well it hears you, and to check your words come out right."
    >
      <div className="flex max-w-md flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={selectId} className="text-[12px] font-medium text-muted">
            Listen with
          </label>
          <div className="flex items-center gap-2">
            <Select
              id={selectId}
              className="min-w-0 flex-1"
              value={saved || null}
              allowNone
              noneLabel="The computer's default"
              options={shown}
              onChange={(v) => {
                if (rec && rec.phase !== 'writing') {
                  cancelRecording(rec.id)
                  setNote({ text: 'Microphone changed. Click Test to try it.' })
                }
                void update({ speech: { microphone: v ?? '' } })
              }}
            />
            <Button
              className="w-[84px]"
              onClick={test}
              disabled={rec?.phase === 'writing'}
              icon={rec && rec.phase !== 'writing' ? <Square size={10} fill="currentColor" strokeWidth={0} /> : <Mic size={14} />}
            >
              {rec && rec.phase !== 'writing' ? 'Stop' : 'Test'}
            </Button>
          </div>
          {missing ? (
            <p className="text-[12px] text-faint">
              That microphone isn't plugged in, so dictation uses the computer's default until it is.
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <span className="w-[36px] shrink-0 text-[12px] font-medium text-muted">Level</span>
          <div
            role="meter"
            aria-label="Microphone level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level * 100)}
            className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-3"
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-150 ease-out"
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>
        </div>

        <div ref={noteRef} aria-live="polite" className="min-h-[18px] text-[12px] leading-[18px]">
          {note?.engine ? (
            <Notice
              tone="neutral"
              action={
                <Button size="sm" onClick={() => toSpeechEngine(noteRef.current)}>
                  Go to the speech engine
                </Button>
              }
            >
              {note.text}
            </Notice>
          ) : note ? (
            <p className={note.tone === 'danger' ? 'text-danger' : 'text-muted'}>{note.text}</p>
          ) : stateLine ? (
            <p className="text-muted">{stateLine}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={tryId} className="text-[12px] font-medium text-muted">
            Try it
          </label>
          <Textarea
            ref={tryBox}
            id={tryId}
            value={heard}
            minRows={3}
            maxRows={8}
            placeholder="What the microphone hears is written here."
            className="font-serif text-[14.5px]"
            onChange={(e) => setHeard(e.target.value)}
          />
          <p className="text-[12px] text-faint">
            {key
              ? `You can hold ${keyName(key, isMac())} in this box too, to try your key.`
              : 'Pick a hold-to-talk key above to try it here too.'}
          </p>
        </div>
      </div>
    </SettingsSection>
  )
}
