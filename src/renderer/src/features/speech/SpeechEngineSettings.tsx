// Settings › Read aloud and dictation, the speech engine's parts: the status badge, "Start with AI Write",
// the one-click downloads with their progress (everyday), and the server address, Check, the Hugging
// Face key, where things are kept and removing them (More). Owned by the Speech engine part.
import { AudioLines, Download, ExternalLink, FolderOpen, KeyRound, Link2, Mic, RefreshCw, Server, Trash2 } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import type { DictationModel, SpeechDownload, SpeechDownloadKind, SpeechStatus, SpeechStorage } from '@shared/contracts/speech'
import { SPEECH_SERVER_URL } from '@shared/defaults'
import { Badge, Button, Card, Field, Input, Notice, SettingsSection, Spinner, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { Switch } from '@/features/world/parts/Switch'
import { Segmented } from '@/features/generate/parts'
import { setSpeechStatus, useSpeechStatus } from './useSpeechStatus'

/** What each download is called in Settings, and its size. */
const KINDS: Record<SpeechDownloadKind, { name: string; size: string }> = {
  server: { name: 'the speech engine', size: 'about 150 MB' },
  voices: { name: 'the voices', size: 'about 12 GB' },
  parakeet: { name: 'Parakeet', size: 'about 1 GB' },
  whisper: { name: 'Whisper', size: 'about 300 MB' }
}

const HF_KEYS_PAGE = 'https://huggingface.co/settings/tokens'

const linkClass =
  'text-accent underline decoration-accent/50 underline-offset-2 transition-colors duration-150 hover:text-accent-hover hover:decoration-accent'

/** Runs an action that answers with the status, and shows a problem as a toast. */
async function act(run: () => Promise<SpeechStatus>, after?: () => Promise<void>): Promise<boolean> {
  try {
    setSpeechStatus(await run())
    if (after) await after()
    return true
  } catch (e) {
    toast((e as Error).message, { tone: 'danger' })
    return false
  }
}

async function refreshSettings(): Promise<void> {
  useApp.setState({ settings: await api.getSettings() })
}

export function SpeechEngineSettings({ section }: { section: 'everyday' | 'more' }): React.JSX.Element | null {
  const status = useSpeechStatus({ poll: true })
  return section === 'everyday' ? <Everyday status={status} /> : <More status={status} />
}

// ---------- Everyday ----------

function StatusBadge({ status }: { status: SpeechStatus | null }): React.JSX.Element {
  if (!status) return <Badge className="invisible">Not running</Badge>
  if (status.server === 'connected') return <Badge tone="success">Connected</Badge>
  if (status.server === 'starting') {
    return (
      <Badge tone="accent" className="gap-1.5">
        <Spinner size={10} />
        Starting
      </Badge>
    )
  }
  return <Badge>Not running</Badge>
}

function Everyday({ status }: { status: SpeechStatus | null }): React.JSX.Element {
  const [checking, setChecking] = useState(false)
  const check = async (): Promise<void> => {
    setChecking(true)
    await act(() => api.checkSpeech())
    setChecking(false)
  }
  return (
    <SettingsSection
      title="Speech engine"
      badge={<StatusBadge status={status} />}
      description="One speech engine on this computer runs the voices and dictation, with no cost per use."
      actions={
        <Button size="sm" icon={<RefreshCw size={13} />} loading={checking} disabled={!status} onClick={() => void check()}>
          Check
        </Button>
      }
    >
      <Card className={cn('divide-y divide-line', !status && 'invisible')}>
        {status ? (
          <>
            <Readiness status={status} />
            <StartWithApp status={status} />
            <Voices status={status} />
            <Dictation status={status} />
          </>
        ) : (
          <div className="h-[420px]" aria-busy />
        )}
      </Card>
    </SettingsSection>
  )
}

/** One of the three things the status says: what it is, and a dot (green when ready). */
function Fact({
  label,
  value,
  ready,
  className
}: {
  label: string
  value: string
  ready?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1.5 text-[13px] text-fg" title={value}>
        {ready !== undefined ? (
          <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', ready ? 'bg-success' : 'bg-line-strong')} />
        ) : null}
        <span className="truncate">{value}</span>
      </dd>
    </div>
  )
}

function voicesFact(s: SpeechStatus): { value: string; ready: boolean } {
  if (isPending(s, 'voices')) return { value: 'Downloading', ready: false }
  if (s.server === 'connected') {
    if (s.voicesReady) return { value: s.loaded.voices ? 'Ready, loaded' : 'Ready', ready: true }
    return { value: s.installed.voices ? 'Not ready' : 'Not downloaded', ready: false }
  }
  if (s.installed.voices === 'mcreader') return { value: 'MCreader’s copy', ready: false }
  return { value: s.installed.voices ? 'Downloaded' : 'Not downloaded', ready: false }
}

const modelName = (m: DictationModel): string => (m === 'parakeet' ? 'Parakeet' : 'Whisper')

function dictationFact(s: SpeechStatus, picked: 'none' | DictationModel): { value: string; ready: boolean } {
  const name = picked === 'parakeet' ? 'Parakeet' : picked === 'whisper' ? 'Whisper' : ''
  if (!name) {
    // A speech server AI Write didn't start may have its own model ready.
    if (s.server === 'connected' && s.dictationReady)
      return { value: s.loaded.dictation ? `${modelName(s.loaded.dictation)}, loaded` : 'Ready', ready: true }
    return { value: 'Not picked', ready: false }
  }
  if (isPending(s, picked as DictationModel)) return { value: `${name}, downloading`, ready: false }
  if (s.server === 'connected') {
    if (s.dictationReady) return { value: s.loaded.dictation ? `${name}, loaded` : `${name}, ready`, ready: true }
    return { value: s.installed[picked as DictationModel] ? `${name}, not ready` : `${name}, not downloaded`, ready: false }
  }
  return { value: s.installed[picked as DictationModel] ? `${name}, downloaded` : `${name}, not downloaded`, ready: false }
}

function Readiness({ status }: { status: SpeechStatus }): React.JSX.Element {
  const picked = useApp((s) => s.settings?.speech?.dictationEngine ?? 'none')
  const voices = voicesFact(status)
  const dictation = dictationFact(status, picked)
  const device = status.server === 'connected' ? status.device || 'Processor' : status.nvidia ? status.nvidia : '—'
  return (
    <div className="@container p-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 @lg:grid-cols-3">
        <Fact label="Voices" value={voices.value} ready={voices.ready} />
        <Fact label="Dictation" value={dictation.value} ready={dictation.ready} />
        <Fact label="Runs on" value={device} className="col-span-2 @lg:col-span-1" />
      </dl>
      <StatusLine status={status} />
    </div>
  )
}

/** A sentence under the facts when there is something to say: starting, a problem, or how to start it. */
function StatusLine({ status }: { status: SpeechStatus }): React.JSX.Element | null {
  const custom = status.address !== SPEECH_SERVER_URL
  const line = 'mt-3 text-[12.5px] leading-5'
  if (status.server === 'connected') return null
  if (status.server === 'starting') {
    const downloading = status.download?.kind === 'server' && status.download.state === 'running'
    return (
      <p className={cn(line, 'flex items-center gap-2 text-muted')}>
        <Spinner size={12} />
        {downloading
          ? 'It starts as soon as its download finishes.'
          : 'Starting the speech engine. It runs hidden and takes a few seconds.'}
      </p>
    )
  }
  if (status.problem) return <p className={cn(line, 'text-danger')}>{status.problem}</p>
  let text = 'Turn on “Start with AI Write” below to run it whenever AI Write is open.'
  if (status.managed) text = status.installed.server ? 'Press Check to start it.' : 'It starts once the speech engine is downloaded.'
  else if (custom) text = `Nothing answers at ${status.address}. Start that speech server, or turn on “Start with AI Write” below.`
  return <p className={cn(line, 'text-muted')}>{text}</p>
}

function Row({
  icon,
  title,
  badge,
  control,
  children
}: {
  icon: ReactNode
  title: string
  badge?: ReactNode
  control?: ReactNode
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 p-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex min-h-[20px] items-center gap-2">
          <h3 className="text-[13.5px] font-semibold text-fg">{title}</h3>
          {badge}
          {control ? <div className="ml-auto flex shrink-0 items-center">{control}</div> : null}
        </div>
        {children}
      </div>
    </div>
  )
}

function StartWithApp({ status }: { status: SpeechStatus }): React.JSX.Element {
  const on = useApp((s) => !!s.settings?.speech?.runServer)
  const [busy, setBusy] = useState(false)
  const id = useId()
  const toggle = async (next: boolean): Promise<void> => {
    setBusy(true)
    // The switch moves at once; the status follows.
    useApp.setState((s) => (s.settings ? { settings: { ...s.settings, speech: { ...s.settings.speech, runServer: next } } } : {}))
    await act(() => api.setSpeechStartWithApp(next), refreshSettings)
    setBusy(false)
  }
  return (
    <Row
      icon={<Server size={16} />}
      title="Start with AI Write"
      control={
        <label htmlFor={id} className={cn('flex items-center', busy && 'pointer-events-none')}>
          <span className="sr-only">Start with AI Write</span>
          <Switch id={id} checked={on} onChange={(v) => void toggle(v)} aria-describedby={`${id}-hint`} />
        </label>
      }
    >
      <p id={`${id}-hint`} className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
        Runs the speech engine hidden while AI Write is open, and stops it when AI Write closes.
        {status.installed.server ? null : ` Turning it on the first time downloads the engine (${KINDS.server.size}).`}
      </p>
      <DownloadFor kind="server" status={status} />
    </Row>
  )
}

function Voices({ status }: { status: SpeechStatus }): React.JSX.Element {
  const installed = status.installed.voices
  const pending = isPending(status, 'voices')
  // A download that stopped has its own Try again.
  const stopped = status.download?.kind === 'voices' && status.download.state !== 'done'
  const noCard = status.nvidia === ''
  return (
    <Row
      icon={<AudioLines size={16} />}
      title="Voices"
      badge={
        installed === 'own' ? (
          <Badge tone="success">Downloaded</Badge>
        ) : installed === 'mcreader' ? (
          <Badge tone="success">MCreader’s copy</Badge>
        ) : null
      }
    >
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
        Breeze TTS 2 gives the narrator and each character a voice of their own, made from a description, with sighs and laughs performed.
        {installed ? null : ' About 12 GB. It needs an NVIDIA graphics card: on the processor it is far too slow.'} Its licence is for
        personal, non-commercial use.
      </p>
      {installed === 'mcreader' && status.mcreader ? (
        <p className="mt-1.5 truncate text-[12px] text-faint" title={status.mcreader.folder}>
          From {status.mcreader.folder}
        </p>
      ) : null}
      {!installed && noCard ? (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          No NVIDIA graphics card was found on this computer, so the voices would be far too slow here.
        </p>
      ) : null}
      {!installed && !pending && (!stopped || status.mcreader) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {stopped ? null : (
            <Button
              size="sm"
              variant={noCard ? 'secondary' : 'primary'}
              icon={<Download size={13} />}
              onClick={() => void act(() => api.downloadSpeech('voices'))}
            >
              Download the voices
            </Button>
          )}
          {status.mcreader ? (
            <Button size="sm" onClick={() => void act(() => api.useMCreaderVoices())}>
              Use MCreader’s copy
            </Button>
          ) : null}
        </div>
      ) : null}
      {installed === 'mcreader' && !pending && !stopped ? (
        <div className="mt-2">
          <Button
            size="sm"
            variant="ghost"
            className="-ml-2.5"
            icon={<Download size={13} />}
            onClick={() => void act(() => api.downloadSpeech('voices'))}
          >
            Download AI Write’s own copy
          </Button>
        </div>
      ) : null}
      <DownloadFor kind="voices" status={status} />
    </Row>
  )
}

function Dictation({ status }: { status: SpeechStatus }): React.JSX.Element {
  const picked = useApp((s) => s.settings?.speech?.dictationEngine ?? 'none')
  const options: { value: 'none' | DictationModel; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'parakeet', label: 'Parakeet' },
    { value: 'whisper', label: 'Whisper' }
  ]
  const pick = async (engine: 'none' | DictationModel): Promise<void> => {
    if (engine === picked) return
    useApp.setState((s) => (s.settings ? { settings: { ...s.settings, speech: { ...s.settings.speech, dictationEngine: engine } } } : {}))
    await act(() => api.setDictationEngine(engine), refreshSettings)
  }
  const chosen = picked === 'none' ? null : picked
  const missing = chosen && !status.installed[chosen] && !isPending(status, chosen) && status.download?.kind !== chosen
  return (
    <Row icon={<Mic size={16} />} title="Dictation">
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
        Speak instead of typing. English only, on the processor, so the graphics card stays free for the voices. Parakeet is the sharper one
        (about 1 GB); Whisper is smaller (about 300 MB). Picking one downloads it the first time.
      </p>
      <Segmented<'none' | DictationModel>
        className="mt-3"
        label="Dictation model"
        value={picked}
        onChange={(v) => void pick(v)}
        options={options}
      />
      {missing ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[12.5px] text-muted">{chosen === 'parakeet' ? 'Parakeet' : 'Whisper'} isn’t downloaded yet.</span>
          <Button size="sm" variant="primary" icon={<Download size={13} />} onClick={() => void act(() => api.downloadSpeech(chosen))}>
            Download {chosen === 'parakeet' ? 'Parakeet' : 'Whisper'} ({KINDS[chosen].size})
          </Button>
        </div>
      ) : null}
      <DownloadFor kind="parakeet" status={status} />
      <DownloadFor kind="whisper" status={status} />
    </Row>
  )
}

const isPending = (s: SpeechStatus, kind: SpeechDownloadKind): boolean =>
  (s.download?.kind === kind && s.download.state === 'running') || s.queued.includes(kind)

// ---------- Downloads ----------

/** The download card for `kind`: running, waiting, stopped by Cancel or failed. One that finished says so in a toast (useSpeechStatus). */
function DownloadFor({ kind, status }: { kind: SpeechDownloadKind; status: SpeechStatus }): React.JSX.Element | null {
  const d = status.download
  if (d?.kind === kind) return <DownloadCard download={d} />
  if (status.queued.includes(kind)) {
    const ahead = status.download && status.download.state === 'running' ? KINDS[status.download.kind].name : 'the download before it'
    return (
      <p className="mt-3 flex items-center gap-2 text-[12.5px] text-muted animate-fade-in">
        <Spinner size={12} />
        Waiting for {ahead} to finish, then {KINDS[kind].name} download.
      </p>
    )
  }
  return null
}

function ProgressBar({ percent }: { percent: number | null }): React.JSX.Element {
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-surface-2"
      role="progressbar"
      aria-label="Download progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
    >
      {percent === null ? (
        <div className="h-full w-full rounded-full bg-accent/40 animate-pulse" />
      ) : (
        <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(2, percent)}%` }} />
      )}
    </div>
  )
}

function DownloadCard({ download: d }: { download: SpeechDownload }): React.JSX.Element | null {
  const what = KINDS[d.kind]
  if (d.state === 'running') {
    return (
      <div className="mt-3 rounded-lg border border-line bg-surface-2/60 p-3 animate-fade-in" aria-live="polite">
        <div className="flex items-baseline gap-3">
          <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{d.step}</p>
          {d.stepCount > 1 ? (
            <span className="shrink-0 text-[12px] tabular-nums text-faint">
              Step {d.stepIndex} of {d.stepCount}
            </span>
          ) : null}
        </div>
        <div className="mt-2">
          <ProgressBar percent={d.percent} />
        </div>
        <div className="mt-2 flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-faint" title={d.line}>
            {d.line || ' '}
          </p>
          {d.amount ? <span className="shrink-0 text-[12px] tabular-nums text-muted">{d.amount}</span> : null}
          <Button size="sm" variant="ghost" onClick={() => void act(() => api.cancelSpeechDownload())}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }
  if (d.state === 'done') return null
  if (d.state === 'cancelled') {
    return (
      <div className="mt-3">
        <Notice
          action={
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={() => void act(() => api.downloadSpeech(d.kind))}>
                Try again
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void act(() => api.dismissSpeechDownload())}>
                Dismiss
              </Button>
            </div>
          }
        >
          Download of {what.name} stopped. Try again carries on from where it can.
        </Notice>
      </div>
    )
  }
  return <Problem download={d} />
}

/** A download that stopped on a problem: what went wrong in plain words, and the fix. */
function Problem({ download: d }: { download: SpeechDownload }): React.JSX.Element {
  const [installing, setInstalling] = useState(false)
  const retry = (
    <Button size="sm" onClick={() => void act(() => api.downloadSpeech(d.kind))}>
      Try again
    </Button>
  )
  const dismiss = (
    <Button size="sm" variant="ghost" onClick={() => void act(() => api.dismissSpeechDownload())}>
      Dismiss
    </Button>
  )
  if (d.need === 'python') {
    return (
      <div className="mt-3">
        <Notice
          action={
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="primary"
                loading={installing}
                onClick={() => {
                  setInstalling(true)
                  void act(() => api.installPython()).finally(() => setInstalling(false))
                }}
              >
                Install Python
              </Button>
              {dismiss}
            </div>
          }
        >
          {d.error}
        </Notice>
      </div>
    )
  }
  if (d.need === 'licence') return <Licence download={d} retry={retry} dismiss={dismiss} />
  return (
    <div className="mt-3">
      <Notice
        tone="danger"
        action={
          <div className="flex shrink-0 gap-2">
            {retry}
            {dismiss}
          </div>
        }
      >
        {d.error}
        {d.need === 'python-manual' && d.link ? (
          <a href={d.link} target="_blank" rel="noreferrer" className={cn('mt-1 flex w-fit items-center gap-1', linkClass)}>
            Get Python from python.org
            <ExternalLink size={12} />
          </a>
        ) : null}
      </Notice>
    </div>
  )
}

/** Hugging Face wants the voices' licence accepted: the page to do it, and the key box. */
function Licence({ download: d, retry, dismiss }: { download: SpeechDownload; retry: ReactNode; dismiss: ReactNode }): React.JSX.Element {
  return (
    <div className="mt-3 rounded-lg border border-line bg-surface-2/60 p-3 text-[13px] leading-relaxed animate-fade-in">
      <p className="font-medium text-fg">{d.error}</p>
      <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-muted">
        <li>
          Open{' '}
          <a
            href={d.link || 'https://huggingface.co'}
            target="_blank"
            rel="noreferrer"
            className={cn('inline-flex items-center gap-1', linkClass)}
          >
            the voices’ page on Hugging Face
            <ExternalLink size={12} />
          </a>
          , sign in, and accept the licence.
        </li>
        <li>
          <a href={HF_KEYS_PAGE} target="_blank" rel="noreferrer" className={cn('inline-flex items-center gap-1', linkClass)}>
            Make a key on Hugging Face
            <ExternalLink size={12} />
          </a>{' '}
          (read access is enough) and paste it below.
        </li>
      </ol>
      <div className="mt-3">
        <HuggingFaceKey compact onSaved={() => void act(() => api.downloadSpeech(d.kind))} />
      </div>
      <div className="mt-3 flex gap-2">
        {retry}
        {dismiss}
      </div>
    </div>
  )
}

/** The Hugging Face key: saved like the AI keys, never shown again. In the licence card (`compact`), saving it tries the download again. */
function HuggingFaceKey({ compact = false, onSaved }: { compact?: boolean; onSaved?: () => void }): React.JSX.Element {
  const status = useSpeechStatus()
  const saved = !!status?.hfKey
  const [key, setKey] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const showForm = !saved || replacing

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!key.trim()) {
      setError('Paste your Hugging Face key first.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      setSpeechStatus(await api.setHuggingFaceKey(key))
      setKey('')
      setReplacing(false)
      onSaved?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    await act(() => api.setHuggingFaceKey(null))
    toast('Hugging Face key removed.')
  }

  if (!showForm) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-[200px] flex-1 text-[12.5px] text-muted">A Hugging Face key is saved on this computer, encrypted.</span>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="ghost" onClick={() => setReplacing(true)}>
            Replace key
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void remove()}>
            Remove
          </Button>
        </div>
      </div>
    )
  }
  const label = replacing ? 'New Hugging Face key' : 'Hugging Face key'
  const input = (id: string): React.JSX.Element => (
    <Input
      id={id}
      type="password"
      autoComplete="off"
      spellCheck={false}
      placeholder="hf_…"
      value={key}
      autoFocus={replacing}
      aria-label={compact ? undefined : label}
      aria-invalid={!!error}
      className={compact ? undefined : 'flex-1'}
      onChange={(e) => {
        setKey(e.target.value)
        setError(null)
      }}
    />
  )
  const buttons = (
    <div className={cn('flex shrink-0 gap-2', compact && 'mt-[21px]')}>
      <Button type="submit" variant={compact ? 'primary' : 'secondary'} loading={saving}>
        {onSaved ? 'Save key and try again' : 'Save key'}
      </Button>
      {replacing ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setReplacing(false)
            setKey('')
            setError(null)
          }}
        >
          Cancel
        </Button>
      ) : null}
    </div>
  )
  if (compact) {
    return (
      <form onSubmit={(e) => void save(e)} className="flex items-start gap-2">
        <Field label={label} className="flex-1" error={error}>
          {input}
        </Field>
        {buttons}
      </form>
    )
  }
  // In More the section's title names it, so the box has no label of its own.
  return (
    <form onSubmit={(e) => void save(e)}>
      <div className="flex items-start gap-2">
        {input(`${id}-key`)}
        {buttons}
      </div>
      {error ? <p className="mt-1.5 text-[12px] text-danger">{error}</p> : null}
    </form>
  )
}

// ---------- More ----------

function More({ status }: { status: SpeechStatus | null }): React.JSX.Element {
  return (
    <SettingsSection title="Speech engine" description="Where the speech engine is, the key for its downloads, and the space they take.">
      <Card className={cn('divide-y divide-line', !status && 'invisible')}>
        {status ? (
          <>
            <Address status={status} />
            <div className="p-4">
              <MoreTitle icon={<KeyRound size={14} />} title="Hugging Face key" />
              <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
                Only needed if Hugging Face asks for the voices’ licence to be accepted before they download. It is kept on this computer,
                encrypted, like your AI keys, and used for that download only.
              </p>
              <HuggingFaceKey />
            </div>
            {!status.mcreader && status.installed.voices !== 'mcreader' ? <FindMCreader /> : null}
            <Storage status={status} />
          </>
        ) : (
          <div className="h-[360px]" aria-busy />
        )}
      </Card>
    </SettingsSection>
  )
}

function MoreTitle({ icon, title, right }: { icon: ReactNode; title: string; right?: ReactNode }): React.JSX.Element {
  return (
    <div className="mb-1 flex min-h-[28px] items-center gap-2">
      <span className="text-muted">{icon}</span>
      <h3 className="text-[13.5px] font-semibold text-fg">{title}</h3>
      {right ? <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div> : null}
    </div>
  )
}

function Address({ status }: { status: SpeechStatus }): React.JSX.Element {
  // The address in use (AI Write moves its own server to the next free port when another program has this one).
  const saved = status.address
  const [value, setValue] = useState(saved)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const id = useId()
  // Settings moved it (another free port was taken): show the address in use.
  useEffect(() => setValue(saved), [saved])

  const check = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault()
    setChecking(true)
    setError(null)
    try {
      const next = value.trim() === saved ? await api.checkSpeech() : await api.setSpeechServerUrl(value)
      setSpeechStatus(next)
      await refreshSettings()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setChecking(false)
    }
  }

  return (
    <form className="p-4" onSubmit={(e) => void check(e)}>
      <MoreTitle icon={<Link2 size={14} />} title="Server address" />
      <p id={`${id}-hint`} className="mb-3 text-[12.5px] leading-relaxed text-muted">
        Where AI Write finds the speech engine. It has to be on this computer: localhost, 127.0.0.1 or ::1. AI Write’s own is at{' '}
        {SPEECH_SERVER_URL}.
      </p>
      <div className="flex items-start gap-2">
        <Input
          aria-label="Server address"
          aria-describedby={`${id}-hint`}
          aria-invalid={!!error}
          className="flex-1"
          value={value}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
        />
        <Button type="submit" className="shrink-0" loading={checking} aria-label="Check this address">
          Check
        </Button>
      </div>
      {error ? <p className="mt-1.5 text-[12px] leading-relaxed text-danger">{error}</p> : null}
    </form>
  )
}

function FindMCreader(): React.JSX.Element {
  return (
    <div className="p-4">
      <MoreTitle
        icon={<AudioLines size={14} />}
        title="MCreader v2’s voices"
        right={
          <Button size="sm" variant="ghost" onClick={() => void act(() => api.findMCreaderVoices())}>
            Find its folder…
          </Button>
        }
      />
      <p className="text-[12.5px] leading-relaxed text-muted">
        MCreader v2 wasn’t found on this computer. If it is here and its voices are downloaded, find its folder to use them instead of
        downloading them again.
      </p>
    </div>
  )
}

const formatSize = (bytes: number): string =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : bytes >= 1e6
      ? `${Math.round(bytes / 1e6)} MB`
      : bytes > 0
        ? `${Math.max(1, Math.round(bytes / 1e3))} KB`
        : '—'

const PART_NAMES: Record<SpeechDownloadKind, string> = {
  server: 'Speech engine',
  voices: 'Voices',
  parakeet: 'Parakeet',
  whisper: 'Whisper'
}

function Storage({ status }: { status: SpeechStatus }): React.JSX.Element {
  const [storage, setStorage] = useState<SpeechStorage | null>(null)
  const [removing, setRemoving] = useState(false)
  const installedKey = JSON.stringify(status.installed)
  const busy = status.download?.state === 'running'

  useEffect(() => {
    let live = true
    void api
      .getSpeechStorage()
      .then((s) => live && setStorage(s))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [installedKey])

  const remove = async (): Promise<void> => {
    setRemoving(true)
    const ok = await act(() => api.removeSpeechDownloads(), refreshSettings)
    setRemoving(false)
    if (!ok) return
    setStorage((s) => (s ? { ...s, total: 0, parts: s.parts.map((p) => ({ ...p, bytes: 0 })) } : s))
    toast('Speech downloads removed.', {
      action: {
        label: 'Undo',
        run: () => void act(() => api.undoRemoveSpeechDownloads(), refreshSettings)
      }
    })
  }

  const total = storage?.total ?? 0
  return (
    <div className="p-4">
      <MoreTitle
        icon={<FolderOpen size={14} />}
        title="Where things are kept"
        right={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void api.showSpeechFolder().catch((e: Error) => toast(e.message, { tone: 'danger' }))}
          >
            Show in folder
          </Button>
        }
      />
      <p className="truncate text-[12.5px] text-muted" title={status.folder}>
        {status.folder}
      </p>
      <p className="mt-1 text-[12px] tabular-nums text-faint">
        {storage
          ? storage.parts
              .filter((p) => p.bytes > 0)
              .map((p) => `${PART_NAMES[p.kind]} ${formatSize(p.bytes)}`)
              .join(' · ') || 'Nothing downloaded yet.'
          : ' '}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3">
        <p className="min-w-[220px] flex-1 text-[12.5px] leading-relaxed text-muted">
          Removing the downloads frees {total > 0 ? formatSize(total) : 'their space'} and turns “Start with AI Write” off. You can download
          them again at any time.
          {status.installed.voices === 'mcreader' ? ' MCreader’s copy of the voices is never touched.' : null}
        </p>
        <Button
          size="sm"
          variant="danger"
          icon={<Trash2 size={13} />}
          loading={removing}
          disabled={busy || total === 0}
          onClick={() => void remove()}
        >
          Remove downloads
        </Button>
      </div>
    </div>
  )
}
