import { BookOpen, CircleCheck, Download, ExternalLink, FolderOpen, Info, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppInfo, UpdateStatus } from '@shared/types'
import { RELEASES_URL } from '@shared/defaults'
import { Button, Card, SectionTitle, Spinner, toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'

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

  return (
    <div className="flex flex-col gap-8">
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

  return (
    <section>
      <SectionTitle>Updates</SectionTitle>
      <Card className="p-4">
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
      </Card>
    </section>
  )
}

function StatusIcon({ status }: { status: UpdateStatus | null }): React.JSX.Element {
  const base = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full'
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
    <section>
      <SectionTitle>Library folder</SectionTitle>
      <Card className="p-4">
        <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
          Where your worlds are kept. Each world is a folder you can copy to move it to another computer or keep a copy by hand. Your API keys are never
          stored here.
        </p>
        <div className="flex items-center gap-2">
          <div
            className="flex h-8 min-w-0 flex-1 items-center rounded-md border border-line bg-page px-2.5 text-[13px] text-fg"
            title={info?.libraryPath}
          >
            <span className="truncate">{info?.libraryPath ?? ' '}</span>
          </div>
          <Button icon={<FolderOpen size={13} />} disabled={!info} onClick={() => info && void api.showInFolder(info.libraryPath)}>
            Open folder
          </Button>
          <Button loading={changing} onClick={() => void change()}>
            Change folder…
          </Button>
        </div>
      </Card>
    </section>
  )
}
