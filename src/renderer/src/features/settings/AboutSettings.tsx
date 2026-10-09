import { BookOpen, CircleCheck, Download, ExternalLink, FolderOpen, Info, RefreshCw, Sparkles } from '@/components/ui/icons'
import { useEffect, useState } from 'react'
import type { AppInfo, UpdateStatus } from '@shared/types'
import { RELEASES_URL } from '@shared/defaults'
import { Button, Card, SettingsSection, Spinner, toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { useNewLook } from '@/features/look/look'
import { notesFor } from './releaseNotes'
// The notes this build was made with (the release page's words).
import releaseNotes from '../../../../../build/release-notes.md?raw'

export function AboutSettings(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let alive = true
    void api
      .getAppInfo()
      .then((i) => alive && setInfo(i))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const isNew = useNewLook()
  if (isNew) return <NewAbout info={info} onChanged={setInfo} />
  return (
    <div className="flex flex-col gap-9">
      <Card className="flex items-center gap-4 p-5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-soft">
          <BookOpen size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-[19px] font-semibold leading-tight text-fg">AI Write</h2>
          <p className="mt-0.5 h-[19px] text-[13px] text-muted">{info ? `Version ${info.version}` : ''}</p>
        </div>
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-accent transition-colors hover:bg-accent-soft"
        >
          All versions on GitHub
          <ExternalLink size={13} />
        </a>
      </Card>

      <Updates />
      <LibraryFolder info={info} onChanged={setInfo} />
    </div>
  )
}

/**
 * The New look: the version on a card of its own beside the updates, what's new in it, then the library folder. The
 * update's state has its own picture: a check turning while it looks, a ring filling while it downloads.
 */
function NewAbout({ info, onChanged }: { info: AppInfo | null; onChanged: (i: AppInfo) => void }): React.JSX.Element {
  const notes = notesFor(releaseNotes, info?.version ?? null)
  return (
    <div className="@container flex flex-col gap-6">
      <div className="grid gap-4 @[760px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="ab-version flex items-center gap-4 p-5">
          <span aria-hidden className="ab-mark grid h-14 w-14 shrink-0 place-items-center rounded-[16px]">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21h6M10 21l.6-9h2.8l.6 9" />
              <path d="M8.5 12h7M9.5 12V8h5v4" />
              <path d="M9 8l3-3 3 3" />
              <circle cx="12" cy="10" r="0.9" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-[22px] font-semibold leading-tight text-fg">AI Write</p>
            <p className="mt-0.5 h-[20px] text-[13.5px] tabular-nums text-muted">{info ? `Version ${info.version}` : ''}</p>
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"
            >
              All versions on GitHub
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
        <Updates />
      </div>
      {notes ? (
        <SettingsSection title={`What’s new in ${notes.version}`} description="The changes in the version you’re running.">
          <ul className="ab-notes flex flex-col gap-2.5">
            {notes.points.map((p, i) => (
              <li key={i} className="flex gap-3 text-[13.5px] leading-relaxed text-fg" style={{ animationDelay: `${i * 40}ms` }}>
                <span aria-hidden className="ab-dot" />
                <span className="min-w-0">{p}</span>
              </li>
            ))}
          </ul>
        </SettingsSection>
      ) : null}
      <LibraryFolder info={info} onChanged={onChanged} />
    </div>
  )
}

function Updates(): React.JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    let alive = true
    void api
      .getUpdateStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => undefined)
    const off = onEvent('update:status', setStatus)
    return () => {
      alive = false
      off()
    }
  }, [])

  const check = async (): Promise<void> => {
    setStatus({ state: 'checking' })
    try {
      setStatus(await api.checkForUpdates())
    } catch (e) {
      setStatus({ state: 'error', message: (e as Error).message })
    }
  }

  const restart = async (): Promise<void> => {
    setRestarting(true)
    try {
      await flushAll()
      await api.installUpdate()
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
      setRestarting(false)
    }
  }

  const busy = status?.state === 'checking' || status?.state === 'downloading'
  const isNew = useNewLook()
  // The New look: the section is the card already, so the status sits straight on it.
  const Box = isNew ? 'div' : Card

  return (
    <SettingsSection title="Updates" className={isNew ? 'ab-updates' : undefined}>
      <Box className={isNew ? undefined : 'p-4'}>
        <div className="flex min-h-[40px] items-center gap-3">
          <StatusIcon status={status} />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium text-fg">{headline(status)}</p>
            <p className="text-[12.5px] leading-relaxed text-muted">{detail(status)}</p>
          </div>
          {status?.state === 'ready' ? (
            <Button variant="primary" loading={restarting} onClick={() => void restart()}>
              Restart to update
            </Button>
          ) : status?.state === 'disabled' ? (
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-line bg-surface px-3 text-[13.5px] font-medium text-fg transition-[background-color,border-color] duration-150 hover:border-line-strong hover:bg-surface-2"
            >
              <ExternalLink size={13} />
              Open GitHub
            </a>
          ) : (
            <Button icon={<RefreshCw size={13} />} disabled={!status || busy} onClick={() => void check()}>
              Check for updates
            </Button>
          )}
        </div>
        {status?.state === 'downloading' ? (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={status.percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${status.percent}%` }} />
          </div>
        ) : null}
        {status?.state === 'ready' && status.notes ? (
          <div className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-faint">What's new</p>
            <p className="max-h-40 overflow-auto whitespace-pre-line text-[13px] leading-relaxed text-fg">{status.notes}</p>
          </div>
        ) : null}
      </Box>
    </SettingsSection>
  )
}

function StatusIcon({ status }: { status: UpdateStatus | null }): React.JSX.Element {
  const isNew = useNewLook()
  // The New look: a ring that fills while the new version downloads.
  if (isNew && status?.state === 'downloading') {
    const C = 2 * Math.PI * 14
    return (
      <div className="relative grid h-9 w-9 shrink-0 place-items-center text-accent">
        <svg aria-hidden viewBox="0 0 36 36" className="absolute inset-0">
          <circle cx="18" cy="18" r="14" fill="none" stroke="var(--surface-3)" strokeWidth="3" />
          <circle
            cx="18"
            cy="18"
            r="14"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(status.percent / 100) * C} ${C}`}
            transform="rotate(-90 18 18)"
            className="transition-[stroke-dasharray] duration-(--dur-base)"
          />
        </svg>
        <Download size={14} />
      </div>
    )
  }
  const base = cn('flex shrink-0 items-center justify-center rounded-full', isNew ? 'h-9 w-9' : 'h-8 w-8')
  if (!status || status.state === 'checking') {
    return (
      <div className={cn(base, 'bg-surface-2 text-muted')}>
        <Spinner size={15} className={cn(!status && 'opacity-0')} />
      </div>
    )
  }
  if (status.state === 'none') {
    return (
      <div className={cn(base, 'bg-success-soft text-success')}>
        <CircleCheck size={16} />
      </div>
    )
  }
  if (status.state === 'downloading') {
    return (
      <div className={cn(base, 'bg-accent-soft text-accent')}>
        <Download size={15} />
      </div>
    )
  }
  if (status.state === 'ready') {
    return (
      <div className={cn(base, 'bg-accent-soft text-accent')}>
        <Sparkles size={15} />
      </div>
    )
  }
  return (
    <div className={cn(base, 'bg-surface-2 text-muted')}>
      <Info size={16} />
    </div>
  )
}

function headline(s: UpdateStatus | null): string {
  switch (s?.state) {
    case undefined:
      return ' '
    case 'idle':
      return 'Automatic updates'
    case 'checking':
      return 'Checking for updates…'
    case 'none':
      return "You're on the latest version"
    case 'downloading':
      return `Downloading the new version… ${s.percent}%`
    case 'ready':
      return `Version ${s.version} is ready to install`
    case 'disabled':
      return 'Get new versions from GitHub'
    case 'error':
      return "Couldn't check for updates"
  }
}

function detail(s: UpdateStatus | null): string {
  switch (s?.state) {
    case undefined:
      return ' '
    case 'idle':
      return 'AI Write checks for a new version each time it starts.'
    case 'checking':
      return 'This only takes a moment.'
    case 'none':
      return 'AI Write checks again each time it starts.'
    case 'downloading':
      return "It downloads in the background. You'll be asked before AI Write restarts."
    case 'ready':
      return 'Restart when it suits you. Your work is saved first.'
    case 'disabled':
    case 'error':
      return s.message
  }
}

function LibraryFolder({ info, onChanged }: { info: AppInfo | null; onChanged: (i: AppInfo) => void }): React.JSX.Element {
  const [changing, setChanging] = useState(false)

  const change = async (): Promise<void> => {
    // A draft keeps writing while Settings is open; moving the library would cut it off.
    if (useApp.getState().activeGeneration) {
      toast('A draft is being written. Stop it or let it finish, then change the folder.')
      return
    }
    setChanging(true)
    try {
      await flushAll()
      const path = await api.chooseLibraryFolder()
      if (!path) return
      onChanged(await api.getAppInfo())
      await useApp.getState().init()
      useApp.getState().navigate({ kind: 'write' })
      toast('Your library folder has changed. Pick or create a world in it.', { tone: 'success' })
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    } finally {
      setChanging(false)
    }
  }

  return (
    <SettingsSection
      title="Library folder"
      description="Where your worlds are kept. Each world is a folder you can copy to move it to another computer or keep a copy by hand. Your API keys are never stored here."
    >
      <Card className="p-4">
        <div className="flex flex-col gap-2">
          <div className="flex min-h-8 items-center rounded-md border border-line bg-page px-2.5 py-1.5 text-[13px] text-fg" title={info?.libraryPath}>
            <span className="break-all">{info?.libraryPath ?? ' '}</span>
          </div>
          <div className="flex gap-2">
            <Button icon={<FolderOpen size={13} />} disabled={!info} onClick={() => info && void api.showInFolder(info.libraryPath)}>
              Open folder
            </Button>
            <Button loading={changing} onClick={() => void change()}>
              Change folder…
            </Button>
          </div>
        </div>
      </Card>
    </SettingsSection>
  )
}
