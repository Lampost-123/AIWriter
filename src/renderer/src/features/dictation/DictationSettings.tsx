// Settings › Read aloud and dictation, dictation's parts (milestone 4). Everyday: the hold-to-talk key
// (press the key to use; Esc clears it), and, when the speech engine can't write words down yet, why in
// plain words with a way to its settings at the top of the page. More: the microphone (the computer's
// default to start) and its Test, a live level meter with a try-it box that shows what was heard. The
// engine choice and its download are the speech engine's own settings. Owned by the Dictation part.
import { Mic, Square } from '@/components/ui/icons'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { SpeechStatus } from '@shared/contracts/speech'
import { Button, Notice, Select, SettingsSection, Textarea, type SelectOption } from '@/components/ui'
import { isMac } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { DictationLayer } from './DictationLayer'
import { insertIntoBox } from './insertText'
import { BUTTON_KEYS, isModifierKey, isSystemKey, keptKey, KEPT_BY_WINDOW, keyName, refusal, suggestKeys } from './keys'
import { useMicLevel } from './Marker'
import { listMicrophones, micAllowWhere, MIC_MISSING } from './mic'
import { useSpeechEngine } from './ready'
import { cancelRecording, finishRecording, notStarted, setPickingKey, startRecording, useDictation } from './session'
import { scrollBehavior } from '@/features/look/motion'

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

const oneKey = (mac: boolean): string => `Pick one key on its own, not a combination: ${suggestKeys(mac)}.`

/** Pressed with another key, a Ctrl, Shift or Alt key works as it always has: said with an example, where there's a plain one. */
function asUsual(key: string, mac: boolean): string {
  const example = key.startsWith('Shift') ? 'capital letters still type' : key.startsWith('Control') && !mac ? 'Ctrl+C still copies' : ''
  return `With another key it works as usual${example ? `, so ${example}` : ''}.`
}

function KeyPicker(): React.JSX.Element {
  const key = useApp((s) => s.settings?.speech?.dictationKey ?? '')
  const update = useApp((s) => s.updateSettings)
  const [picking, setPicking] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  /** Picking was started from the keyboard (Enter or Space on the button): those keys still work the button. */
  const byKeyboard = useRef(false)
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
    // Started from the keyboard, Enter or Space on the button works it as on any button (Cancel). With the
    // mouse, they are keys pressed to try them, and get told why they can't be used.
    const onButton = (e: KeyboardEvent): boolean =>
      byKeyboard.current && BUTTON_KEYS.has(e.key) && document.activeElement === button.current

    const onDown = (e: KeyboardEvent): void => {
      // Tab (or Shift+Tab) moves on, as from any other control.
      if (e.code === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        setPicking(false)
        return
      }
      if (onButton(e) && !e.repeat) return
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
      // The Windows key on its own comes with metaKey set, but it is one key: it is told why it can't be used.
      if (modifier || e.ctrlKey || e.altKey || e.shiftKey || (e.metaKey && !isSystemKey(e.key))) {
        combined = true
        setRefused(oneKey(isMac()))
        return
      }
      const why = refusal(e.key, isMac())
      if (why) setRefused(why)
      else choose(keptKey(e))
    }

    const onUp = (e: KeyboardEvent): void => {
      if (e.code === 'Tab' || onButton(e)) return
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
      // F5 and F12 never reach the page going down (the window keeps them), only coming up. Any other key
      // that only comes up went down before picking started (the Enter that opened it): nothing to say.
      if (!seen.has(e.code) && KEPT_BY_WINDOW.has(e.key)) setRefused(refusal(e.key, isMac()))
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
        ? `No key yet. Pick one you don't type with, ${suggestKeys(mac)}.`
        : isModifierKey(key)
          ? `Hold ${name} on its own and talk, then let go. ${asUsual(key, mac)}`
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
          onClick={(e) => {
            // A click from Enter or Space has no mouse presses (detail 0).
            byKeyboard.current = e.detail === 0
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
  from?.closest('.overflow-auto')?.scrollTo({ top: 0, behavior: scrollBehavior() })
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

/** Why the Test's words weren't written down: the speech engine isn't running, or has no dictation model. */
type EngineWhy = 'not-running' | 'no-model' | 'starting'

/**
 * What the Test says about itself, in plain words that fit the two lines kept for them (so nothing below
 * moves). `engine`: the words weren't written down because the speech engine isn't ready (`tried`: it
 * said so when they were sent; else only the level was tested). That is said from the engine's status as
 * it is now, and goes once the engine is ready.
 */
type TestNote = { text: string; danger?: boolean } | { engine: EngineWhy; tried: boolean }

/** The speech engine's state now, as the Test's words put it; `said` when its status says it is ready (it may not have caught up). */
function engineNow(status: SpeechStatus | null, said: EngineWhy): EngineWhy {
  if (!status || status.dictationReady) return said
  return status.server === 'starting' ? 'starting' : status.server === 'connected' ? 'no-model' : 'not-running'
}

const LEVEL_ONLY: Record<EngineWhy, string> = {
  'not-running': 'Only the level was tested. Your words can be written down once the speech engine is running.',
  'no-model': 'Only the level was tested. Your words can be written down once you pick a dictation model.',
  starting: 'Only the level was tested. Your words can be written down once the speech engine has started.'
}
const NOT_WRITTEN: Record<EngineWhy, string> = {
  'not-running': "Your words couldn't be written down, as the speech engine isn't running.",
  'no-model': "Your words couldn't be written down, as there's no dictation model yet.",
  starting: "Your words couldn't be written down, as the speech engine is still starting."
}

/** A problem the Test hit, in words short enough for its two lines (the message in the corner says more). */
function testProblem(message: string, code?: string): string {
  if (code === 'limit') return 'The Test stops at about 4 minutes. What you said is being written down.'
  if (code === 'microphone-denied') return `The microphone isn't allowed. ${micAllowWhere()}.`
  if (code === 'microphone-busy')
    return "The microphone couldn't be started. Close any other app that may be using it, or pick another microphone above."
  if (code === 'microphone-missing') return MIC_MISSING
  return message
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
  const noteRef = useRef<HTMLParagraphElement>(null)
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

  // Once the speech engine is ready, what the Test said about it no longer holds.
  const ready = !!status?.dictationReady
  useEffect(() => {
    if (ready) setNote((n) => (n && 'engine' in n ? null : n))
  }, [ready])

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
      if (status && !status.dictationReady) {
        cancelRecording(rec.id)
        setNote({ engine: engineNow(status, 'not-running'), tried: false })
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
        setNote(
          code === 'speech-not-running' || code === 'dictation-not-ready'
            ? { engine: code === 'speech-not-running' ? 'not-running' : 'no-model', tried: true }
            : { text: testProblem(message, code), danger: code !== 'limit' }
        ),
      onNothing: (why) =>
        setNote(
          why === 'quiet'
            ? { text: QUIET, danger: true }
            : why === 'no-words'
              ? { text: 'No words were heard. Try again, a little closer to the microphone.' }
              : why === 'not-started'
                ? { text: notStarted('test') }
                : { text: 'That was very short. Click Test, say a sentence, then click Stop.' }
        ),
      onFellBack: () => setNote({ text: "The microphone you picked isn't plugged in, so this is the computer's default." })
    })
    if (id == null) setNote({ text: 'Dictation is listening somewhere else. Stop that first, then try again.' })
    // The microphones' names show once one has been used.
    else refresh()
  }

  // The Test's line: what came of it, or what it is doing.
  const said = note && 'text' in note ? note : null
  const notWritten = note && 'engine' in note ? note : null
  const engine = notWritten ? engineNow(status, notWritten.engine) : null
  const [line, tone]: [string, string] = said
    ? [said.text, said.danger ? 'text-danger' : 'text-muted']
    : notWritten && engine
      ? [(notWritten.tried ? NOT_WRITTEN : LEVEL_ONLY)[engine], notWritten.tried ? 'text-danger' : 'text-muted']
      : rec?.phase === 'writing'
        ? ['Writing it down…', 'text-muted']
        : listening
          ? ['Listening. Say a sentence or two, then click Stop.', 'text-muted']
          : rec
            ? ['Starting the microphone…', 'text-muted']
            : ['Click Test and say a sentence or two.', 'text-faint']

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

        {/* Two lines kept for it, so nothing below moves as it changes. */}
        <p
          ref={noteRef}
          aria-live="polite"
          data-testid="microphone-test-line"
          className={cn('min-h-[36px] text-[12px] leading-[18px]', tone)}
        >
          {line}
          {engine && engine !== 'starting' ? (
            <>
              {' '}
              <button
                type="button"
                className="rounded-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
                onClick={() => toSpeechEngine(noteRef.current)}
              >
                Go to the speech engine
              </button>
            </>
          ) : null}
        </p>

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
