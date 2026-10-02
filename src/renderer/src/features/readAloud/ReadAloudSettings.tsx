// Adapted from mcreader-v2, src/components/speech/SpeechSettings.tsx (its narrator, delivery, playback and saved
// audio sections, and the voice row; reading aloud's own text-to-speech code; Adam's rule, 2 October 2026). The
// speech server's own sections (its status, downloads and address) are the Speech engine part's, above these.
//
// Settings › Read aloud and dictation, reading aloud's parts: turning it on, the narrator's voice, speed
// and Sample (everyday); the dialogue voice, cast voices, How to read, who says each line, Keep reading,
// Follow along and the audio cache (More). Owned by the Read aloud part. Every change saves at once.
import { Check, HardDrive, Play, Search, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { AudioCacheStats, ReadAloudVoice } from '@shared/contracts/readAloud'
import type { SpeechSettings } from '@shared/types'
import { defaultSpeechSettings } from '@shared/defaults'
import { Badge, Button, Field, Input, Notice, Select, SettingsSection, Spinner, Textarea, toast } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { shortcutText } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { Switch } from '@/features/world/parts/Switch'
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

type WarmUp = { state: 'loading' } | { state: 'failed'; message: string; code: string | undefined } | null

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
      setWarm(null)
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
        {on && warm?.state === 'loading' ? (
          <p className="flex items-center gap-2 text-[12.5px] text-muted animate-fade-in">
            <Spinner size={13} className="text-faint" />
            Loading the voices… The first time takes a minute or two.
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
  const list = voices ?? []
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? list.filter((v) => `${v.name} ${v.id} ${v.about}`.toLowerCase().includes(q)) : list
  }, [list, filter])
  const described = !!speech.narratorDescription.trim()

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
      {list.length > 8 ? (
        <div className="relative">
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
        role="radiogroup"
        aria-labelledby={labelId}
        className={cn('max-h-[264px] overflow-y-auto rounded-lg border border-line bg-surface', described && 'opacity-80')}
      >
        {!list.length ? (
          <p className="flex min-h-[52px] items-center justify-center gap-2 px-4 py-4 text-center text-[13px] text-muted">
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
              playing={sample.playing === `settings:voice:${v.id}`}
              loading={sample.loading === `settings:voice:${v.id}`}
              onPick={() => void save({ narratorVoice: v.id })}
              onHear={() => void playSample(`settings:voice:${v.id}`, { kind: 'voice', voice: v.id })}
            />
          ))
        )}
      </div>
      {described ? <p className="text-[12px] text-faint">The description below is used instead while it is filled in.</p> : null}
    </div>
  )
}

/** One voice: the row picks it, the button plays it. */
function VoiceRow({
  voice,
  on,
  playing,
  loading,
  onPick,
  onHear
}: {
  voice: ReadAloudVoice
  on: boolean
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
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPick()
        }
      }}
      className={cn(
        'flex items-center gap-3 border-b border-line px-2.5 py-2 outline-none transition-colors duration-150 last:border-b-0 focus-visible:bg-surface-2',
        on ? 'bg-accent-soft/60' : 'hover:bg-surface-2'
      )}
    >
      <button
        type="button"
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
      hint="Sample plays it exactly as reading will sound: the voice, its description, How to read and the speed."
    >
      {(id) => (
        <div className="flex items-start gap-2">
          <Input
            id={id}
            value={text}
            maxLength={500}
            placeholder={DEFAULTS.sample}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commit()
                void playSample('settings:sample', { kind: 'narrator', text: text.trim() || undefined })
              }
            }}
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
            description="The AI also notes how each line is said, its tone and pace, a little ahead of the reading. Without it, the AI only marks who says a line when the rules can’t tell. It uses the Read aloud model in Settings › Models."
          />
          <SwitchRow
            label="Perform written sounds"
            checked={speech.sounds}
            onChange={(sounds) => void save({ sounds })}
            description="Sighs, laughs and “Ahem” are performed as real sounds instead of being read out."
          />
        </div>
      </SettingsSection>

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

      <SavedAudio limitGb={speech.cacheLimitGb} />
    </>
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
      toast(`The saved audio couldn't be cleared. ${(e as Error).message}`, { tone: 'danger' })
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
            <Button variant="danger" icon={<Trash2 size={14} />} loading={clearing} disabled={!stats?.files} onClick={() => void clear()}>
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
  onChange
}: {
  label: string
  description: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5">
      <Switch id={id} checked={checked} onChange={onChange} aria-describedby={`${id}-help`} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="text-[13px] font-medium text-fg">
          {label}
        </label>
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
