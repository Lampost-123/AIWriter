// The top bar's Scene details button (the New look's desk layout), beside the command bar: shows and hides the scene
// drawer (its card, context, cast, issues and drafts), lit while it is open, with the scene's open issues counted on it.
// Only on the writing page with a scene open. Its words shorten in a smaller window so the bar still fits: "Scene
// details", then "Details", then the icon alone (its name and tooltip always say it in full).
import type { ID } from '@shared/types'
import { PanelRight } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { openCount } from '@/features/issues/issuesLogic'
import { useSceneIssues } from '@/features/issues/issuesStore'

function Toggle({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const open = useApp((s) => !!s.settings?.layout.inspectorOpen && !s.askOpen)
  const { issues } = useSceneIssues(sceneId)
  const { count, mustFix } = openCount(issues)
  const toggle = (): void => {
    const a = useApp.getState()
    // Ask the world in the drawer gives way to the scene's details.
    if (a.askOpen) a.setAskOpen(false)
    void a.updateSettings({ layout: { inspectorOpen: !open } })
  }
  const issueWords = count ? `, ${count} open ${count === 1 ? 'issue' : 'issues'}` : ''
  return (
    <button
      type="button"
      data-drawer-toggle
      aria-pressed={open}
      aria-label={`Scene details${issueWords}`}
      title="Show or hide this scene’s card, context, cast, issues and drafts"
      onClick={toggle}
      className={cn('desk-drawer-toggle relative flex h-9 shrink-0 items-center gap-1.5 rounded-[11px] px-2.5 text-[13px] font-medium', open && 'is-on')}
    >
      <PanelRight size={16} selected={open} />
      <span className="max-[1599px]:hidden">Scene details</span>
      <span className="hidden max-[1599px]:inline max-[1359px]:hidden">Details</span>
      {count ? (
        <span aria-hidden className={cn('desk-drawer-count min-w-[18px] rounded-full px-1.5 text-center text-[10.5px] font-semibold leading-[18px] tabular-nums', mustFix && 'is-must')}>
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </button>
  )
}

export function DrawerToggle(): React.JSX.Element | null {
  const sceneId = useApp((s) => (s.view.kind === 'write' ? s.sceneId : null))
  return sceneId ? <Toggle sceneId={sceneId} /> : null
}
