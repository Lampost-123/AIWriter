import * as M from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Globe2, PanelLeft, PanelRight, PenLine, Plus, Settings as SettingsIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { WorldSummary } from '@shared/types'
import { IconButton, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { flushBeforeWorldChange } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { NewWorldDialog } from '@/features/welcome/NewWorldDialog'
import { InlineTitle } from '@/features/binder/InlineTitle'

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

/** Renames the open world (only its name inside the world; the folder on disk keeps its name). */
async function renameWorld(name: string): Promise<void> {
  const clean = name.trim()
  if (!clean) return
  useApp.setState((s) => (s.world ? { world: { ...s.world, name: clean } } : {}))
  try {
    await api.updateWorld({ name: clean })
  } catch (e) {
    toast((e as Error).message, { tone: 'danger' })
  } finally {
    await useApp.getState().refreshWorld().catch(() => undefined)
  }
}

const menuItem = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] outline-none data-[highlighted]:bg-surface-2'

function WorldMenu(): React.JSX.Element {
  const world = useApp((s) => s.world)
  const openWorld = useApp((s) => s.openWorld)
  const [worlds, setWorlds] = useState<WorldSummary[]>([])
  const [newOpen, setNewOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  // Set when the chosen item moves focus elsewhere (the name box, the New world dialog),
  // so the closing menu doesn't pull focus back to its button.
  const keepFocus = useRef(false)

  if (renaming && world) {
    return (
      <div className="flex h-7 w-[260px] items-center gap-1.5 px-2">
        <Globe2 size={14} className="shrink-0 text-muted" />
        <InlineTitle
          label="World name"
          value={world.name}
          className="h-6 text-[13px] font-semibold"
          onCommit={(n) => renameWorld(n)}
          onDone={() => setRenaming(false)}
        />
      </div>
    )
  }

  return (
    <>
      <M.Root
        onOpenChange={(o) => {
          if (!o) return
          keepFocus.current = false
          void api.listWorlds().then(setWorlds)
        }}
      >
        <M.Trigger className="flex h-7 max-w-[260px] items-center gap-1.5 rounded-md px-2 text-[13px] font-semibold text-fg hover:bg-surface-2">
          <Globe2 size={14} className="shrink-0 text-muted" />
          <span className="truncate">{world?.name ?? 'No world open'}</span>
          <ChevronDown size={13} className="shrink-0 text-muted" />
        </M.Trigger>
        <M.Portal>
          <M.Content
            align="start"
            sideOffset={4}
            onCloseAutoFocus={(e) => {
              if (keepFocus.current) e.preventDefault()
              keepFocus.current = false
            }}
            className="z-50 min-w-[240px] max-w-[360px] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
          >
            <M.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Worlds</M.Label>
            {worlds.map((w) => (
              <M.Item
                key={w.id}
                onSelect={() => {
                  if (w.id === world?.id) return
                  void flushBeforeWorldChange()
                    .then(() => openWorld(w.id))
                    .catch((e: Error) => toast(e.message, { tone: 'danger' }))
                }}
                className={menuItem}
              >
                <span className="w-4 shrink-0">{w.id === world?.id ? <Check size={14} className="text-accent" /> : null}</span>
                <span className="truncate">{w.name}</span>
              </M.Item>
            ))}
            <M.Separator className="my-1 h-px bg-line" />
            {world ? (
              <M.Item
                onSelect={() => {
                  keepFocus.current = true
                  setRenaming(true)
                }}
                className={menuItem}
              >
                <PenLine size={14} className="text-muted" /> Rename this world
              </M.Item>
            ) : null}
            <M.Item
              onSelect={() => {
                keepFocus.current = true
                setNewOpen(true)
              }}
              className={menuItem}
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
  const sceneId = useApp((s) => s.sceneId)
  const drafting = useApp((s) => s.activeGeneration !== null)
  const layout = settings?.layout
  // The scene panel belongs to an open scene in the writing view; elsewhere the button rests.
  const panelAvailable = view.kind === 'write' && !!sceneId

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
      {view.kind === 'write' ? (
        <span className="mr-3 text-[12px] tabular-nums text-faint">{words.toLocaleString()} words</span>
      ) : drafting ? (
        // A draft keeps writing into the scene while another page is open; this goes back to it.
        <button
          type="button"
          onClick={() => navigate({ kind: 'write' })}
          title="A draft is being written into the scene. Click to go back to it."
          className="mr-2 flex h-7 items-center gap-2 rounded-md px-2 text-[12.5px] font-medium text-ai transition-colors duration-150 hover:bg-surface-2 animate-fade-in"
        >
          <span className="h-2 w-2 rounded-full bg-ai animate-pulse" aria-hidden />
          Writing…
        </button>
      ) : null}
      <SaveIndicator />
      <IconButton label="Settings" active={view.kind === 'settings'} onClick={() => navigate(view.kind === 'settings' ? { kind: 'write' } : { kind: 'settings', tab: 'models' })}>
        <SettingsIcon size={16} />
      </IconButton>
      <IconButton
        label="Show or hide the scene panel"
        active={panelAvailable && layout?.inspectorOpen}
        disabled={!panelAvailable}
        onClick={() => layout && void update({ layout: { inspectorOpen: !layout.inspectorOpen } })}
      >
        <PanelRight size={16} />
      </IconButton>
    </header>
  )
}
