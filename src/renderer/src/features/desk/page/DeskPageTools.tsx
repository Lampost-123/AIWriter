// The desk page's tools, floating at the foot of the sheet where the AI dock will go (UI overhaul, phase 3): the scene's
// status, Mark done, the scene tools (format, variants, beat by beat, history, listen), Ask the world, the scene panel,
// and Generate (with Continue, Add below and its options behind it), exactly the parts the panels' toolbar has, so
// nothing is lost and every shortcut they carry (Ctrl+G, Ctrl+Enter, Ctrl+L, Esc to stop) works the same. While a
// beat-by-beat session has the foot of the page, they step out of sight (still listening for their keys).
import type { ID, SceneStatus } from '@shared/types'
import { PanelRight } from '@/components/ui/icons'
import { IconButton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { AskButton } from '@/features/ask/AskButton'
import { useBeats } from '@/features/beats/session'
import { useOutline } from '@/features/binder/outlineStore'
import { DoneButton } from '@/features/editor/DoneButton'
import { StatusMenu } from '@/features/editor/SceneHeader'
import { SceneTools } from '@/features/editor/SceneTools'
import { GenerateControls } from '@/features/generate/GenerateControls'

export function DeskPageTools({ sceneId, fallbackStatus }: { sceneId: ID; fallbackStatus: SceneStatus }): React.JSX.Element {
  const { outline } = useOutline()
  const status = outline?.scenes.find((s) => s.id === sceneId)?.status ?? fallbackStatus
  const beats = useBeats((s) => s.session?.sceneId === sceneId)
  const panelOpen = useApp((s) => !!s.settings?.layout.inspectorOpen && !s.askOpen)
  const update = useApp((s) => s.updateSettings)
  const askOpen = useApp((s) => s.askOpen)

  return (
    // A header, so the controls inside size themselves by it (as they do in the panels' toolbar).
    <header
      role="toolbar"
      aria-label="Scene tools"
      data-focus-chrome
      data-desk-tools
      inert={beats}
      className={cn('desk-tools @container pointer-events-auto flex h-14 w-full items-center gap-2 rounded-[18px] pl-3 pr-2', beats && 'is-away')}
    >
      <StatusMenu sceneId={sceneId} status={status} />
      <DoneButton sceneId={sceneId} status={status} />
      <i aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-line" />
      <SceneTools sceneId={sceneId} />
      <div className="min-w-0 flex-1" />
      <AskButton />
      <IconButton
        label="Scene panel"
        title="The scene’s card, context, cast, issues and drafts"
        active={panelOpen}
        aria-pressed={panelOpen}
        onClick={() => {
          if (askOpen) useApp.getState().setAskOpen(false)
          void update({ layout: { inspectorOpen: !panelOpen } })
        }}
      >
        <PanelRight size={16} />
      </IconButton>
      <div className="flex shrink-0 items-center">
        <GenerateControls sceneId={sceneId} />
      </div>
    </header>
  )
}
