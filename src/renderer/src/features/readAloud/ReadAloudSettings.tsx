// Adapted from mcreader-v2, src/components/speech/SpeechSettings.tsx (its narrator, delivery, playback and saved
// audio sections, and the voice row; reading aloud's own text-to-speech code; Adam's rule, 2 October 2026). The
// speech server's own sections (its status, downloads and address) are the Speech engine part's, above these.
//
// Settings › Read aloud and dictation, reading aloud's parts: turning it on, the narrator's voice, speed
// and Sample (everyday); the dialogue voice, cast voices, How to read, who says each line, Keep reading,
// Follow along, sound effects and the audio cache (More). Owned by the Read aloud part. Every change saves at once. Mark who says
// what and Perform written sounds say plainly whether Emotion and tone, and sighs and laughs, are on (tone.ts), as the
// reading bar does.
import { AudioLines, Check, CircleCheck, HardDrive, Play, Search, Square, Trash2 } from '@/components/ui/icons'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AudioCacheStats, ReadAloudVoice } from '@shared/contracts/readAloud'
import type { SoundsStatus } from '@shared/contracts/sounds'
import type { SpeechSettings } from '@shared/types'
import { defaultSpeechSettings } from '@shared/defaults'
import { Badge, Button, Field, Input, Notice, Select, SettingsSection, Spinner, Textarea, toast } from '@/components/ui'
import { api, ApiError, onEvent } from '@/lib/api'
import { cn } from '@/lib/cn'
import { shortcutText } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { Switch } from '@/features/world/parts/Switch'
import { useSpeechStatus } from '@/features/speech/useSpeechStatus'
import { SoundsDownload } from '@/features/speech/SoundsDownload'
import { mixer } from '@/features/sounds/mixer'
import { HOW_IT_READS, onOff, SOUNDS_OFF, SOUNDS_ON, TONE_ON } from './tone'
import { clearSampleError, playSample, useSample } from './useSample'
import { loadVoices, useVoices } from './useVoices'

const CACHE_LIMITS = [1, 2, 5, 10, 20, 50]
const DEFAULTS = defaultSpeechSettings()

/** The buttons on this page, for the sample player. */
const OURS = (label: string): boolean => label.startsWith('settings:')

async function save(patch: Partial<SpeechSettings>): Promise<void> {
  try {
    await useApp.getState().updateSettings({ speech: patch })
  } catch (e) {
    toast(`That change couldn't be saved. ${(e as Error).message}`, { tone: 'danger' })
  }
}

export function ReadAloudSettings({ section }: { section: 'everyday' | 'more' }): React.JSX.Element | null {
  const speech = useApp((s) => s.settings?.speech)
  if (!speech) return null
  if (section === 'everyday') return <Everyday speech={speech} />
  return speech.readAloud ? <More speech={speech} /> : null
}

// ---------- Everyday: on or off, the narrator, speed and Sample ----------

type WarmUp = { state: 'loading' } | { state: 'ready' } | { state: 'failed'; message: string; code: string | undefined } | null

/** The speech engine's problems as this page puts them: its own section, where they are fixed, is just above. */
function engineWords(message: string, code: string | undefined): string {
  if (code === 'speech-not-running') return "The speech engine isn't running. Start it above, then try again."
  if (code === 'voices-not-ready')
    return "The voices aren't ready yet. Download them above, or check the speech engine there, then try again."
  return message
}

function Everyday({ speech }: { speech: SpeechSettings }): React.JSX.Element {
  const on = speech.readAloud
  const [warm, setWarm] = useState<WarmUp>(null)
  const voices = useVoices(on)
  const sample = useSample(OURS)

  /** Loads the voices, then says "Ready when you are." in the narrator's voice. */
  const warmUp = useCallback(async () => {
    setWarm({ state: 'loading' })
    try {
      await api.warmUpVoices()
      // The line stays, saying so, rather than going and moving the page up.
      setWarm({ state: 'ready' })
      void playSample('settings:ready', { kind: 'ready' })
    } catch (e) {
      setWarm({ state: 'failed', message: (e as Error).message, code: e instanceof ApiError ? e.code : undefined })
    }
  }, [])

  const turn = async (next: boolean): Promise<void> => {
    await save({ readAloud: next })
    if (next) void warmUp()
    else setWarm(null)
  }

  // One note for the speech engine not being ready, whichever asked first.
  const engineProblem =
    warm?.state === 'failed'
      ? engineWords(warm.message, warm.code)
      : voices.error
        ? engineWords(voices.error.message, voices.error.code)
        : null

  return (
    <SettingsSection title="Reading aloud" description="Hear any scene read aloud, with a narrator and each character in their own voice.">
      <div className="flex max-w-xl flex-col gap-5">
        <SwitchRow
          label="Read scenes aloud"
          checked={on}
          onChange={(v) => void turn(v)}
          description={
            on
              ? `Listen is in the scene's toolbar (${shortcutText('listen')}), and ${shortcutText('stopReading')} stops reading from anywhere.`
              : 'Shows Listen in the scene’s toolbar. The voices run on this computer, so nothing you write is sent anywhere to be read.'
          }
        />
        {on && (warm?.state === 'loading' || warm?.state === 'ready') ? (
          <p className="flex h-5 items-center gap-2 text-[12.5px] text-muted animate-fade-in">
            {warm.state === 'loading' ? (
              <>
                <Spinner size={13} className="text-faint" />
                Loading the voices… The first time takes a minute or two.
              </>
            ) : (
              <>
                <CircleCheck size={14} className="text-success" aria-hidden />
                The voices are ready.
              </>
            )}
          </p>
        ) : null}
        {on && engineProblem ? (
          <Notice
            action={
              <Button
                size="sm"
                onClick={() => {
                  void loadVoices()
                  if (warm) void warmUp()
                }}
              >
                Try again
              </Button>
            }
          >
            {engineProblem}
          </Notice>
        ) : null}
        {on ? (
          <>
            <NarratorVoice speech={speech} voices={voices.voices} loading={voices.loading} failed={!!voices.error} />
            <TextSetting
              label="Describe the narrator"
              value={speech.narratorDescription}
              placeholder="A woman in her forties with a warm, low voice, a light Irish accent and an unhurried delivery"
              hint="The voice is made from the description once and kept, so it never drifts; changing the words makes a new voice. Leave it empty to use the voice picked above."
              max={2000}
              onCommit={(narratorDescription) => save({ narratorDescription })}
            />
            <SpeedSetting speed={speech.speed} />
            <SampleSetting speech={speech} />
            {sample.error ? (
              <SampleError message={engineWords(sample.error.message, sample.error.code)} onDismiss={() => clearSampleError(OURS)} />
            ) : null}
          </>
        ) : null}
      </div>
    </SettingsSection>
  )
}

/** The narrator's voice: one of the server's, each with "Hear this voice". */
function NarratorVoice({
  speech,
  voices,
  loading,
  failed
}: {
  speech: SpeechSettings
  voices: ReadAloudVoice[] | null
  loading: boolean
  failed: boolean
}): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const sample = useSample(OURS)
  const labelId = useId()
  const group = useRef<HTMLDivElement>(null)
  const list = voices ?? []
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? list.filter((v) => `${v.name} ${v.id} ${v.about}`.toLowerCase().includes(q)) : list
  }, [list, filter])
  const described = !!speech.narratorDescription.trim()
  // One stop for Tab in the list: the voice picked (or the first shown); the arrow keys move and pick.
  const focusable = shown.some((v) => v.id === speech.narratorVoice) ? speech.narratorVoice : shown[0]?.id
  const onArrows = (e: React.KeyboardEvent): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || !shown.length) return
    const rows = [...(group.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])]
    const at = rows.findIndex((r) => r.contains(document.activeElement))
    e.preventDefault()
    const step = e.key === 'ArrowDown' ? 1 : -1
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : at < 0 ? 0 : (at + step + rows.length) % rows.length
    rows[next]?.focus()
    const v = shown[next]
    if (v && v.id !== speech.narratorVoice) void save({ narratorVoice: v.id })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-3">
        <span id={labelId} className="text-[12px] font-medium text-muted">
          Narrator's voice
        </span>
        {list.length ? (
          <span className="text-[12px] tabular-nums text-faint">
            {shown.length === list.length ? `${list.length} voices` : `${shown.length} of ${list.length} voices`}
          </span>
        ) : null}
      </div>
      {/* The same room while the voices load as once they are listed, so nothing below moves when they come. */}
      <div className="flex h-[304px] flex-col gap-2">
        {list.length > 8 ? (
          <div className="relative shrink-0">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <Input
              className="pl-8"
              placeholder="Filter voices"
              aria-label="Filter voices"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        ) : null}
        <div
          ref={group}
          role="radiogroup"
          aria-labelledby={labelId}
          onKeyDown={onArrows}
          className={cn('min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-surface', described && 'opacity-80')}
        >
          {!list.length ? (
            <p className="flex h-full items-center justify-center gap-2 px-4 py-4 text-center text-[13px] text-muted">
              {loading && !failed ? (
                <>
                  <Spinner size={13} className="text-faint" /> Looking for the voices…
                </>
              ) : failed ? (
                'The voices show here once the speech engine is ready.'
              ) : (
                'The speech engine has no voices yet.'
              )}
            </p>
          ) : !shown.length ? (
            <p className="px-4 py-4 text-center text-[13px] text-muted">No voice matches that.</p>
          ) : (
            shown.map((v) => (
              <VoiceRow
                key={v.id}
                voice={v}
                on={v.id === speech.narratorVoice}
                focusable={v.id === focusable}
                playing={sample.playing === `settings:voice:${v.id}`}
                loading={sample.loading === `settings:voice:${v.id}`}
                onPick={() => void save({ narratorVoice: v.id })}
                onHear={() => void playSample(`settings:voice:${v.id}`, { kind: 'voice', voice: v.id })}
              />
            ))
          )}
        </div>
      </div>
      {described ? <p className="text-[12px] text-faint">The description below is used instead while it is filled in.</p> : null}
    </div>
  )
}

/** One voice: the row picks it, the button plays it (Sample plays the voice picked, for the keyboard). */
function VoiceRow({
  voice,
  on,
  focusable,
  playing,
  loading,
  onPick,
  onHear
}: {
  voice: ReadAloudVoice
  on: boolean
  focusable: boolean
  playing: boolean
  loading: boolean
  onPick: () => void
  onHear: () => void
}): React.JSX.Element {
  return (
    <div
      role="radio"
      aria-checked={on}
      aria-label={voice.name}
      tabIndex={focusable ? 0 : -1}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPick()
        }
      }}
      className={cn(
        'flex items-center gap-3 border-b border-line px-2.5 py-2 outline-none transition-colors duration-150 last:border-b-0',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
        on ? 'bg-accent-soft/60' : 'hover:bg-surface-2'
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={playing ? `Stop ${voice.name}` : `Hear ${voice.name}`}
        title={playing ? 'Stop' : 'Hear this voice'}
        onClick={(e) => {
          e.stopPropagation()
          onHear()
        }}
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors duration-150',
          playing ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line bg-page text-muted hover:text-fg'
        )}
      >
        {loading ? <Spinner size={12} /> : playing ? <Square size={10} /> : <Play size={12} />}
      </button>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-fg">{voice.name}</span>
        {voice.about ? <span className="block truncate text-[12px] text-muted">{voice.about}</span> : null}
      </span>
      {voice.clip ? <Badge>Your clip</Badge> : voice.recommended ? <Badge tone="accent">Suggested</Badge> : null}
      <span className="flex w-4 shrink-0 justify-center">{on ? <Check size={15} className="text-accent" aria-hidden /> : null}</span>
    </div>
  )
}

/** Speed, 0.5× to 2×, without changing pitch. Saved when the slider is let go. */
function SpeedSetting({ speed }: { speed: number }): React.JSX.Element {
  const [value, setValue] = useState(speed)
  useEffect(() => setValue(speed), [speed])
  const commit = (v: number): void => {
    if (v !== speed) void save({ speed: v })
  }
  return (
    <Field label={`Speed: ${value.toFixed(2)}×`} hint="Faster or slower without changing the pitch of the voice.">
      {(id) => (
        <input
          id={id}
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          onPointerUp={(e) => commit(Number(e.currentTarget.value))}
          onKeyUp={(e) => commit(Number(e.currentTarget.value))}
          onBlur={(e) => commit(Number(e.currentTarget.value))}
          className="w-full max-w-[360px] accent-[var(--accent)]"
        />
      )}
    </Field>
  )
}

/** The sample sentence, and Sample: it played exactly as reading will sound. */
function SampleSetting({ speech }: { speech: SpeechSettings }): React.JSX.Element {
  const [text, setText] = useState(speech.sample)
  useEffect(() => setText(speech.sample), [speech.sample])
  const sample = useSample(OURS)
  const busy = sample.playing === 'settings:sample' || sample.loading === 'settings:sample'
  const commit = (): void => {
    const v = text.trim()
    if (v !== speech.sample) void save({ sample: v || DEFAULTS.sample })
  }
  return (
    <Field
      label="Sample sentence"
      hint={
        // A steady narrator reads narration without How to read (plan.ts), and so does Sample.
        speech.steadyNarrator
          ? 'Sample plays it exactly as reading will sound: the voice, its description and the speed.'
          : 'Sample plays it exactly as reading will sound: the voice, its description, How to read and the speed.'
      }
    >
      {(id) => (
        <div className="flex items-start gap-2">
          <Textarea
            id={id}
            value={text}
            maxLength={500}
            minRows={1}
            maxRows={3}
            placeholder={DEFAULTS.sample}
            // One sentence: a new line is a space, and Enter plays it.
            onChange={(e) => setText(e.target.value.replace(/\s*\n\s*/g, ' '))}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
                void playSample('settings:sample', { kind: 'narrator', text: text.trim() || undefined })
              }
            }}
            // One row as tall as the button beside it.
            style={{ paddingTop: 5, paddingBottom: 5, lineHeight: '20px' }}
            className="flex-1"
          />
          <Button
            icon={sample.loading === 'settings:sample' ? <Spinner size={13} /> : busy ? <Square size={11} /> : <Play size={13} />}
            onClick={() => {
              commit()
              void playSample('settings:sample', { kind: 'narrator', text: text.trim() || undefined })
            }}
            className="w-[92px]"
          >
            {busy ? 'Stop' : 'Sample'}
          </Button>
        </div>
      )}
    </Field>
  )
}

function SampleError({ message, onDismiss }: { message: string; onDismiss: () => void }): React.JSX.Element {
  return (
    <Notice
      action={
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      }
    >
      {message}
    </Notice>
  )
}

// ---------- More: dialogue and cast voices, how it reads, while reading, saved audio ----------

function More({ speech }: { speech: SpeechSettings }): React.JSX.Element {
  const { voices } = useVoices(true)
  const list = voices ?? []
  const dialogueOptions = [
    ...list.map((v) => ({ value: v.id, label: v.name, hint: v.clip ? 'your clip' : undefined })),
    // A voice picked before that the server doesn't list now stays picked.
    ...(speech.dialogueVoice && !list.some((v) => v.id === speech.dialogueVoice)
      ? [{ value: speech.dialogueVoice, label: speech.dialogueVoice }]
      : [])
  ]
  return (
    <>
      <SettingsSection title="Dialogue and characters" description="Whose voice reads each line in quotes.">
        <div className="flex max-w-xl flex-col gap-5">
          <Field label="Quoted dialogue" hint="Lines from someone without a voice of their own are read in this voice.">
            {(id) => (
              <Select
                id={id}
                value={speech.dialogueVoice || null}
                onChange={(v) => void save({ dialogueVoice: v ?? '' })}
                options={dialogueOptions}
                allowNone
                noneLabel="Same as the narrator"
                className="max-w-[320px]"
              />
            )}
          </Field>
          <SwitchRow
            label="Give characters their own voices"
            checked={speech.castVoices}
            onChange={(castVoices) => void save({ castVoices })}
            description="Each character’s lines are read in the voice on their page in the world (Read-aloud voice). Off, everyone is read in the dialogue voice."
          />
        </div>
      </SettingsSection>

      <div id={HOW_IT_READS} className="scroll-mt-6">
        <SettingsSection title="How it reads" description="The narrator’s manner, and who says each line and how.">
          <div className="flex max-w-xl flex-col gap-5">
            <TextSetting
              label="How to read"
              value={speech.style}
              placeholder={DEFAULTS.style}
              hint={
                speech.steadyNarrator
                  ? 'A standing note for the narrator, in plain words. While the narrator’s voice is kept steady (below), narration is read plainly, without it.'
                  : 'A standing note for the narrator, in plain words.'
              }
              max={2000}
              onCommit={(style) => save({ style: style || DEFAULTS.style })}
            />
            <SwitchRow
              label="Keep the narrator’s voice steady"
              checked={speech.steadyNarrator}
              onChange={(steadyNarrator) => void save({ steadyNarrator })}
              description="Narration is read plainly, so only dialogue is acted. A tone the AI marks for the narration is still followed, gently."
            />
            <SwitchRow
              label="Mark who says what"
              checked={speech.markSpeakers}
              onChange={(markSpeakers) => void save({ markSpeakers })}
              status={`Emotion and tone: ${onOff(speech.markSpeakers)}`}
              description={
                speech.markSpeakers
                  ? `${TONE_ON} New drafts come marked by the writer as it writes; other text is marked by the writer model.`
                  : 'Turn this on for emotion and tone: the AI notes how each line is said, its tone and pace, a little ahead of the reading. Off, lines are read evenly, with a tone only where the words say how (“she snapped”), and the AI only marks who says a line when the rules can’t tell. New drafts come marked by the writer as it writes; other text is marked by the writer model.'
              }
            />
            <SwitchRow
              label="Show speakers and tone"
              checked={speech.showSpeakers}
              onChange={(showSpeakers) => void save({ showSpeakers })}
              description="Shows who says each paragraph, and how, in small grey words just above it. They are never part of your text. New drafts are marked as they are written; your own writing is marked when it is read aloud."
            />
            <SwitchRow
              label="Perform written sounds"
              checked={speech.sounds}
              onChange={(sounds) => void save({ sounds })}
              status={`Sighs and laughs: ${onOff(speech.sounds)}`}
              description={speech.sounds ? SOUNDS_ON : `${SOUNDS_OFF} Turn this on to hear them performed as real sounds.`}
            />
          </div>
        </SettingsSection>
      </div>

      <SettingsSection title="While reading">
        <div className="flex max-w-xl flex-col gap-3">
          <SwitchRow
            label="Keep reading"
            checked={speech.keepReading}
            onChange={(keepReading) => void save({ keepReading })}
            description="Carries on into the next scene when one ends."
          />
          <SwitchRow
            label="Follow along"
            checked={speech.followAlong}
            onChange={(followAlong) => void save({ followAlong })}
            description="Keeps the sentence being read a third of the way down the page."
          />
        </div>
      </SettingsSection>

      <SoundEffects speech={speech} />

      <SavedAudio limitGb={speech.cacheLimitGb} />
    </>
  )
}

// ---------- Sound effects ----------

/**
 * Sound effects and ambience under the reading (features/sounds): the switch, the sound model's download while it
 * isn't done, how loud they are, and the sounds kept so far with Clear (undoable from its toast).
 */
function SoundEffects({ speech }: { speech: SpeechSettings }): React.JSX.Element {
  const status = useSpeechStatus()
  const on = speech.soundEffects
  // Known and not downloaded: the download's own card (it names who made the sound model).
  const download = on && !!status && !status.installed.sounds
  return (
    <SettingsSection title="Sound effects">
      <div className="flex max-w-xl flex-col gap-5">
        <SwitchRow
          label="Sound effects and ambience"
          checked={on}
          onChange={(soundEffects) => void save({ soundEffects })}
          description="The AI adds quiet sounds under the reading: a door on the word it slams, rain while it falls. Made on this computer."
        />
        {on ? (
          <>
            {download ? <SoundsDownload /> : null}
            <SoundVolume volume={speech.soundVolume} />
            <SoundLibrary />
            {!download && status ? <p className="-mt-2 text-[12px] text-faint">Powered by Stability AI</p> : null}
          </>
        ) : null}
      </div>
    </SettingsSection>
  )
}

/** How loud the sounds are under the voice: heard at once while it moves, saved when it is let go. */
function SoundVolume({ volume }: { volume: number }): React.JSX.Element {
  const [value, setValue] = useState(volume)
  useEffect(() => setValue(volume), [volume])
  const commit = (v: number): void => {
    if (v !== volume) void save({ soundVolume: v })
  }
  return (
    <Field label="Sounds volume" hint="How loud the sounds are under the voice. They dip a little while a line is spoken.">
      {(id) => (
        <div className="flex max-w-[360px] items-center gap-3">
          <span aria-hidden className="text-[12px] text-faint">
            Quieter
          </span>
          <input
            id={id}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={value}
            aria-valuetext={`${Math.round(value * 100)}%`}
            onChange={(e) => {
              const v = Number(e.target.value)
              setValue(v)
              mixer.setVolume(v)
            }}
            onPointerUp={(e) => commit(Number(e.currentTarget.value))}
            onKeyUp={(e) => commit(Number(e.currentTarget.value))}
            onBlur={(e) => commit(Number(e.currentTarget.value))}
            className="min-w-0 flex-1 accent-[var(--accent)]"
          />
          <span aria-hidden className="text-[12px] text-faint">
            Louder
          </span>
        </div>
      )}
    </Field>
  )
}

/** "42 sounds kept · 120 MB", what is being made, and Clear sounds (Undo in its toast). */
function SoundLibrary(): React.JSX.Element {
  const [status, setStatus] = useState<SoundsStatus | null>(null)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    let live = true
    api
      .getSoundsStatus()
      .then((s) => live && setStatus(s))
      .catch(() => undefined)
    const off = onEvent('sounds:status', (s) => setStatus(s))
    return () => {
      live = false
      off()
    }
  }, [])

  const clear = async (): Promise<void> => {
    setClearing(true)
    try {
      setStatus(await api.clearSoundLibrary())
      // Nothing decoded before plays again.
      mixer.forget()
      toast('Sounds cleared.', {
        action: {
          label: 'Undo',
          run: () =>
            void api
              .undoClearSoundLibrary()
              .then((s) => {
                mixer.forget()
                setStatus(s)
              })
              .catch((e: unknown) => toast((e as Error).message || 'The sounds couldn’t be put back.', { tone: 'danger' }))
        }
      })
    } catch (e) {
      toast((e as Error).message || 'The sounds couldn’t be cleared. Try again in a moment.', { tone: 'danger' })
    } finally {
      setClearing(false)
    }
  }

  const count = status?.library.count ?? 0
  const doing = status?.making
    ? `Making “${status.making}”…`
    : status?.waiting
      ? `${status.waiting} waiting to be made`
      : 'Kept on this computer for every world, so a sound is only made once.'
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-muted">
          <AudioLines size={16} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium tabular-nums text-fg">
            {status ? `${count.toLocaleString('en-GB')} ${count === 1 ? 'sound' : 'sounds'} kept` : '…'}
            {status && count ? <span className="font-normal text-muted"> · {sizeText(status.library.bytes)}</span> : null}
          </p>
          <p className="truncate text-[12px] text-muted">{status ? doing : ' '}</p>
        </div>
      </div>
      <Button variant="secondary" icon={<Trash2 size={14} />} loading={clearing} disabled={!count} onClick={() => void clear()}>
        Clear sounds
      </Button>
    </div>
  )
}

/** How much spoken audio is kept, its limit, and Clear. */
function SavedAudio({ limitGb }: { limitGb: number }): React.JSX.Element {
  const [stats, setStats] = useState<AudioCacheStats | null>(null)
  const [clearing, setClearing] = useState(false)
  const playing = useSample(OURS).playing

  useEffect(() => {
    let live = true
    // Again after a sample has played (it may have added a clip) and when the limit changes.
    if (!playing)
      api
        .getReadAloudCache()
        .then((s) => live && setStats(s))
        .catch(() => undefined)
    return () => {
      live = false
    }
  }, [playing, limitGb])

  const clear = async (): Promise<void> => {
    setClearing(true)
    try {
      setStats(await api.clearReadAloudCache())
      toast('Saved audio cleared.')
    } catch (e) {
      // Some of it was in use (it says so in plain words); the rest went.
      toast((e as Error).message || "The saved audio couldn't be cleared. Try again in a moment.")
      api
        .getReadAloudCache()
        .then(setStats)
        .catch(() => undefined)
    } finally {
      setClearing(false)
    }
  }

  const limits = [...new Set([...CACHE_LIMITS, limitGb])].sort((a, b) => a - b)
  const share = stats && stats.limitBytes ? Math.min(1, stats.bytes / stats.limitBytes) : 0
  return (
    <SettingsSection
      title="Saved audio"
      description="Every line spoken is kept on this computer, so a passage heard again plays at once. Past the limit, the oldest go first. It is never part of a world or its backups."
    >
      <div className="flex max-w-xl flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-muted">
              <HardDrive size={16} aria-hidden />
            </span>
            <div className="min-w-[150px]">
              <p className="text-[13.5px] font-medium tabular-nums text-fg">
                {stats ? sizeText(stats.bytes) : '…'} <span className="font-normal text-muted">of {sizeText(limitGb * 1024 ** 3)}</span>
              </p>
              <p className="text-[12px] tabular-nums text-muted">
                {stats ? `${stats.files.toLocaleString('en-GB')} ${stats.files === 1 ? 'clip' : 'clips'}` : ' '}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={String(limitGb)}
              onChange={(v) => v && void save({ cacheLimitGb: Number(v) })}
              options={limits.map((gb) => ({ value: String(gb), label: `Up to ${gb} GB` }))}
              className="w-[140px]"
            />
            <Button
              variant="secondary"
              icon={<Trash2 size={14} />}
              loading={clearing}
              disabled={!stats?.files}
              onClick={() => void clear()}
            >
              Clear
            </Button>
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${share * 100}%` }} />
        </div>
      </div>
    </SettingsSection>
  )
}

/** "48 KB", "312 MB", "1.4 GB". */
export function sizeText(bytes: number): string {
  if (bytes > 0 && bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  const mb = bytes / 1024 ** 2
  if (mb < 1024) return `${mb < 10 && mb > 0 ? mb.toFixed(1) : Math.round(mb)} MB`
  const gb = mb / 1024
  return `${gb < 10 && !Number.isInteger(gb) ? gb.toFixed(1) : Math.round(gb)} GB`
}

// ---------- Parts ----------

function SwitchRow({
  label,
  description,
  checked,
  onChange,
  status
}: {
  label: string
  description: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  /** What the switch turns on, said as On or Off beside its name ("Emotion and tone: On"). */
  status?: string
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5">
      <Switch id={id} checked={checked} onChange={onChange} aria-describedby={`${id}-help`} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <label htmlFor={id} className="text-[13px] font-medium text-fg">
            {label}
          </label>
          {status ? <Badge tone={checked ? 'ai' : 'neutral'}>{status}</Badge> : null}
        </div>
        <p id={`${id}-help`} className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
          {description}
        </p>
      </div>
    </div>
  )
}

/** A text setting saved when Adam leaves the box. */
function TextSetting({
  label,
  value,
  placeholder,
  hint,
  max,
  onCommit
}: {
  label: string
  value: string
  placeholder: string
  hint: ReactNode
  max: number
  onCommit: (v: string) => Promise<void>
}): React.JSX.Element {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <Textarea
          id={id}
          value={text}
          minRows={2}
          maxRows={8}
          maxLength={max}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (text.trim() !== value.trim()) void onCommit(text.trim())
          }}
        />
      )}
    </Field>
  )
}
