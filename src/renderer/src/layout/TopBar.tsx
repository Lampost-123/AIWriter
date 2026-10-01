import * as M from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Globe2, PanelLeft, PanelRight, Plus, Settings as SettingsIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { WorldSummary } from '@shared/types'
import { IconButton, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { NewWorldDialog } from '@/features/welcome/NewWorldDialog'

function SaveIndicator(): React.JSX.Element {
  const state = useApp((s) => s.saveState)
  const label = state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Not saved, retrying' : ''
  return (
    <span
      aria-live="polite"
      className={cn('min-w-[110px] text-right text-[12px] transition-opacity duration-300', state === 'error' ? 'text-danger' : 'text-faint', !label && 'opacity-0')}
    >
      {label || 'Saved'}
    </span>
  )
}

function WorldMenu(): React.JSX.Element {
  const world = useApp((s) => s.world)
  const openWorld = useApp((s) => s.openWorld)
  const [worlds, setWorlds] = useState<WorldSummary[]>([])
  const [newOpen, setNewOpen] = useState(false)

  return (
    <>
      <M.Root onOpenChange={(o) => o && void api.listWorlds().then(setWorlds)}>
        <M.Trigger className="flex h-7 max-w-[260px] items-center gap-1.5 rounded-md px-2 text-[13px] font-semibold text-fg hover:bg-surface-2">
          <Globe2 size={14} className="text-muted" />
          <span className="truncate">{world?.name ?? 'No world open'}</span>
          <ChevronDown size={13} className="text-muted" />
        </M.Trigger>
        <M.Portal>
          <M.Content align="start" sideOffset={4} className="z-50 min-w-[240px] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in">
            <M.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Worlds</M.Label>
            {worlds.map((w) => (
              <M.Item
                key={w.id}
                onSelect={() => {
                  if (w.id === world?.id) return
                  void flushAll()
                    .then(() => openWorld(w.id))
                    .catch((e: Error) => toast(e.message, { tone: 'danger' }))
                }}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] outline-none data-[highlighted]:bg-surface-2"
              >
                <span className="w-4">{w.id === world?.id ? <Check size={14} className="text-accent" /> : null}</span>
                <span className="truncate">{w.name}</span>
              </M.Item>
            ))}
            <M.Separator className="my-1 h-px bg-line" />
            <M.Item
              onSelect={() => setNewOpen(true)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] outline-none data-[highlighted]:bg-surface-2"
            >
              <Plus size={14} className="text-muted" /> New world…
            </M.Item>
          </M.Content>
        </M.Portal>
      </M.Root>
      <NewWorldDialog open={newOpen} onOpenChange={setNewOpen} />
    </>
  )
}

export function TopBar(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const view = useApp((s) => s.view)
  const navigate = useApp((s) => s.navigate)
  const words = useApp((s) => s.sceneWords)
  const layout = settings?.layout

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === ',') {
        e.preventDefault()
        navigate({ kind: 'settings', tab: 'models' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-surface px-2">
      <IconButton label="Show or hide the binder" active={layout?.binderOpen} onClick={() => layout && void update({ layout: { binderOpen: !layout.binderOpen } })}>
        <PanelLeft size={16} />
      </IconButton>
      <WorldMenu />
      <div className="flex-1" />
      {view.kind === 'write' ? <span className="mr-3 text-[12px] tabular-nums text-faint">{words.toLocaleString()} words</span> : null}
      <SaveIndicator />
      <IconButton label="Settings" active={view.kind === 'settings'} onClick={() => navigate(view.kind === 'settings' ? { kind: 'write' } : { kind: 'settings', tab: 'models' })}>
        <SettingsIcon size={16} />
      </IconButton>
      <IconButton
        label="Show or hide the scene panel"
        active={layout?.inspectorOpen}
        disabled={view.kind !== 'write'}
        onClick={() => layout && void update({ layout: { inspectorOpen: !layout.inspectorOpen } })}
      >
        <PanelRight size={16} />
      </IconButton>
    </header>
  )
}
