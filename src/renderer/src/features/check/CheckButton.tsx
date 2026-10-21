// The top bar's Check (the calm overhaul, 2026-10-19): the one way to ask for a check, on both layouts. A menu: this scene,
// this chapter or the whole story, "Craft notes too" (the critic reads as well), and Show the issues. While a check runs
// the button says how it is going, calmly ("Checking 2 of 5", "Waiting for the memory…"), and the menu has Stop, and
// Check now while it waits for the memory to catch up. Everything here goes through runCheck.ts.
import * as M from '@radix-ui/react-dropdown-menu'
import { ChevronDown, ListChecks } from '@/components/ui/icons'
import { Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { checkWithoutWaiting, openConsistency, stopCheck, useChecks, useRunWords } from '@/features/consistency/checkStore'
import { useCritiqueStore } from '@/features/critique/critiqueStore'
import { showIssues } from '@/features/issues/issuesStore'
import { useCalmLine } from '@/features/waits/useDraftWait'
import { keyboardDriven } from '@/features/look/motion'
import { runCheck, useCheckPrefs, type CheckScope } from './runCheck'
import { modelSuffix, useModelName } from '@/features/progress/useModelName'

const item = 'flex flex-col rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-45'

export function CheckButton(): React.JSX.Element | null {
  const storyId = useApp((s) => s.storyId)
  const sceneId = useApp((s) => s.sceneId)
  const hasWorld = useApp((s) => !!s.world)
  const run = useChecks((s) => s.run)
  const live = useChecks((s) => (s.run ? (s.runs[s.run.runId] ?? null) : null))
  // The Check room of the story being checked shows the check's progress itself: the button stays still there.
  const roomShows = useApp((s) => !!run && s.view.kind === 'consistency' && s.view.storyId === run.storyId)
  const reading = useCritiqueStore((s) => Object.keys(s.runs).length > 0)
  const craft = useCheckPrefs((s) => s.craft)
  const setCraft = useCheckPrefs((s) => s.setCraft)
  const words = useCalmLine(useRunWords(run, true))
  // The model at work, named on the hover: the check model, or the writer model while the critic reads.
  const checkModel = useModelName('check')
  const criticModel = useModelName('writer')
  if (!hasWorld || !storyId) return null
  const busy = !!run || reading
  const busyWords = run ? words : 'The critic is reading…'
  const start = (scope: CheckScope): void => void runCheck(scope)

  return (
    <M.Root modal={false}>
      <M.Trigger
        data-check-button
        aria-label={busy ? `Check: ${busyWords}` : 'Check this scene, chapter or story'}
        title={busy ? `${busyWords}${modelSuffix(run ? checkModel : criticModel)}` : 'Check this scene, chapter or story for slips and questions'}
        className={cn(
          'flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium text-muted outline-none transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40 data-[state=open]:bg-surface-2 data-[state=open]:text-fg',
          // The desk: the same paper button as Scene details beside it.
          'desk-drawer-toggle desk:h-9 desk:rounded-[11px] desk:px-2.5 desk:text-[13px] desk:focus-visible:ring-0'
        )}
      >
        {busy && !(roomShows && !reading) ? <Spinner size={14} className="shrink-0" /> : <ListChecks size={16} className="shrink-0" />}
        {/* The word when the bar has room for it (the desk's is fuller: the word goes sooner there); its name says it always. */}
        <span className="max-[1279px]:hidden desk:max-[1679px]:hidden">Check</span>
        <ChevronDown size={13} className="shrink-0 opacity-70 desk:max-[1599px]:hidden" aria-hidden />
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          // Chosen with the pointer, the keyboard stays where Adam was (the page), rather than lighting the button.
          onCloseAutoFocus={(e) => {
            if (!keyboardDriven()) e.preventDefault()
          }}
          aria-label="Check"
          className="z-50 w-[310px] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
        >
          {busy ? (
            <div role="status" className="flex items-center gap-2 border-b border-line px-2.5 pb-2 pt-1.5">
              <Spinner size={13} className="shrink-0" />
              <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted">{busyWords}</span>
            </div>
          ) : null}
          {run && live?.waiting === 'memory' ? (
            <M.Item className={item} onSelect={() => void checkWithoutWaiting(run.runId)}>
              <span className="text-[13.5px] font-medium text-fg">Check now</span>
              <span className="mt-0.5 text-[12px] leading-snug text-muted">Don’t wait for the memory: check with what it knows.</span>
            </M.Item>
          ) : null}
          {run ? (
            <M.Item className={item} disabled={run.stopping} onSelect={() => void stopCheck()}>
              <span className="text-[13.5px] font-medium text-fg">Stop the check</span>
              <span className="mt-0.5 text-[12px] leading-snug text-muted">What it found so far is kept.</span>
            </M.Item>
          ) : (
            <>
              <M.Item className={item} disabled={!sceneId} onSelect={() => start('scene')}>
                <span className="text-[13.5px] font-medium text-fg">Check this scene</span>
                <span className="mt-0.5 text-[12px] leading-snug text-muted">Facts, who knows what, timeline and place, voices, style and tone.</span>
              </M.Item>
              <M.Item className={item} disabled={!sceneId} onSelect={() => start('chapter')}>
                <span className="text-[13.5px] font-medium text-fg">Check this chapter</span>
                <span className="mt-0.5 text-[12px] leading-snug text-muted">Facts, who knows what and the timeline in each of its scenes.</span>
              </M.Item>
              <M.Item className={item} onSelect={() => start('story')}>
                <span className="text-[13.5px] font-medium text-fg">Check the whole story</span>
                <span className="mt-0.5 text-[12px] leading-snug text-muted">The same for every scene. Takes longer, and costs more.</span>
              </M.Item>
            </>
          )}
          <M.Separator className="my-1 h-px bg-line" />
          <M.CheckboxItem
            checked={craft}
            onCheckedChange={(on) => setCraft(on === true)}
            // Ticking it leaves the menu open, so the check can be chosen next.
            onSelect={(e) => e.preventDefault()}
            className={cn(item, 'relative pl-8')}
          >
            <span className="absolute left-2.5 top-2.5 grid h-4 w-4 place-items-center rounded border border-line-strong bg-page text-accent">
              <M.ItemIndicator>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </M.ItemIndicator>
            </span>
            <span className="text-[13.5px] font-medium text-fg">Craft notes too</span>
            <span className="mt-0.5 text-[12px] leading-snug text-muted">The critic reads the scene or chapter as well: pacing, tension, voices, the prose. Costs more.</span>
          </M.CheckboxItem>
          <M.Separator className="my-1 h-px bg-line" />
          <M.Item className={item} onSelect={() => (sceneId ? void showIssues(sceneId) : openConsistency(storyId))}>
            <span className="text-[13.5px] font-medium text-fg">Show the issues</span>
            <span className="mt-0.5 text-[12px] leading-snug text-muted">
              {sceneId ? 'This scene’s Issues list: slips, questions, craft notes, plot threads and the memory.' : 'The story’s issues, chapter by chapter.'}
            </span>
          </M.Item>
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}
