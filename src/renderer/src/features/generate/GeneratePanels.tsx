// Generate's panels, opened under the Generate button (GenerateControls) or above the desk's AI dock: "This scene
// already has text" (Replace it, Fresh take, Add below), "Choose a writer model first", the draft options
// (direction, length, creativity, polish), and the note that the story's cast is still being built (Wait, Write now). Rendered inside the caller's Popover root, anchored to the caller's button.
import { ArrowDownToLine, RefreshCw, Sparkles } from '@/components/ui/icons'
import { useId, type ReactNode } from 'react'
import type { Creativity } from '@shared/types'
import { CREATIVITY_PRESETS } from '@shared/defaults'
import { Button } from '@/components/ui'
import { modKey } from '@/lib/api'
import { cn } from '@/lib/cn'
import { costLabel } from '@/features/variants/cost'
import { setSteer, useDeskStore } from '@/features/desk/deskStore'
import { DirectionComposer } from '@/features/direction/DirectionComposer'
import { useDesk } from '@/features/look/look'
import { LengthField } from './LengthField'
import { setPolishOn } from './polishRun'
import { CREATIVITY_HINTS } from './format'
import { PopoverPanel, Segmented } from './parts'
import { DirectedToggle } from '@/features/director/DirectedToggle'
import { PlanFirstToggle } from '@/features/planReview/PlanFirstToggle'
import type { DraftMode, Generate } from './useGenerate'

const CREATIVITY_OPTIONS = (Object.keys(CREATIVITY_PRESETS) as Creativity[]).map((k) => ({ value: k, label: CREATIVITY_PRESETS[k].label }))

/** What the draft options say when the scene already has text (also Generate's tooltip). */
export const AFTER_TEXT = 'This scene already has text. You can replace it with the new draft, or add the draft below it.'

/** What Generate says while the story's cast is still being built (2026-10-17). */
export const BUILDING_NOTE = 'Your cast is still being built, so the AI will know more in a minute.'

/**
 * One of the two answers to "This scene already has text": a name, and a faint line saying what it does.
 * Opened from the keyboard, the answer that has the keyboard always shows it (a shortcut alone doesn't
 * make the browser show its focus ring), so Enter never picks one Adam can't see.
 */
function ModeChoice({
  mode,
  icon,
  label,
  hint,
  keyboard,
  onClick
}: {
  mode: DraftMode
  icon: ReactNode
  label: string
  hint: string
  keyboard: boolean
  onClick: () => void
}): React.JSX.Element {
  const id = useId()
  return (
    <button
      type="button"
      data-choice={mode}
      onClick={onClick}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-hint`}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left transition-[background-color,border-color] duration-150 hover:border-line-strong hover:bg-surface-2',
        keyboard && 'focus:outline-2 focus:outline-offset-2 focus:outline-[var(--focus)]'
      )}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted transition-colors duration-150 group-hover:bg-surface-3 group-hover:text-fg"
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span id={`${id}-label`} className="block text-[13px] font-medium leading-5 text-fg">
          {label}
        </span>
        <span id={`${id}-hint`} className="block text-[12px] leading-[18px] text-faint">
          {hint}
        </span>
      </span>
    </button>
  )
}

/** The open panel, if any: each is its own popover (keyed), so switching from one to another opens it afresh. */
export function GeneratePanels({ g, side }: { g: Generate; side?: 'top' | 'bottom' }): React.JSX.Element | null {
  const { popover, setPopover, popoverRef, beforeChoice, choiceByKey, choiceFromOptions, generate, opts, updateOpts } = g
  // The direction for the next draft. On the desk it is the dock's steer box (one box, in sight, used once); on the
  // panels the draft options keep it, shown beside Generate until a draft has used it (features/direction).
  const desk = useDesk()
  const steer = useDeskStore((s) => s.steer[g.sceneId] ?? '')
  const direction = desk ? steer : opts.direction
  const setDirection = (text: string): void => (desk ? setSteer(g.sceneId, text) : updateOpts({ direction: text }))
  if (popover === 'choose') {
    return (
      <PopoverPanel
        key="choose"
        className="w-[340px]"
        side={side}
        onOpenAutoFocus={(e) => {
          // From the keyboard, Add below takes the keyboard: Enter then does what Ctrl+G always did,
          // and replacing the text takes a deliberate step. From a click, the panel does (nothing
          // looks picked before Adam picks it); Tab or the arrow keys then reach the answers.
          e.preventDefault()
          const panel = e.currentTarget instanceof HTMLElement ? e.currentTarget : null
          const first = choiceByKey ? panel?.querySelector<HTMLElement>('[data-choice="add"]') : panel
          first?.focus({ preventScroll: true })
        }}
        onEscapeKeyDown={(e) => {
          // Asked from the draft options: Esc goes back to them, with the direction as it was.
          if (!choiceFromOptions) return
          e.preventDefault()
          setPopover('options')
        }}
        onKeyDown={(e) => {
          // Up and down move between the two answers.
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
          const answers = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-choice]')]
          if (!answers.length) return
          e.preventDefault()
          const at = answers.indexOf(document.activeElement as HTMLElement)
          const step = e.key === 'ArrowDown' ? 1 : answers.length - 1
          const next = at < 0 ? (e.key === 'ArrowDown' ? 0 : answers.length - 1) : (at + step) % answers.length
          answers[next].focus()
        }}
        onCloseAutoFocus={(e) => {
          // Back to where the keyboard was (the page, for Ctrl+G), unless Adam clicked somewhere else.
          // (This runs a moment after closing: if the choice was opened again since, it has the keyboard.)
          e.preventDefault()
          if (popoverRef.current === 'choose') return
          const back = beforeChoice.current
          beforeChoice.current = null
          const here = document.activeElement
          if (back?.isConnected && (!here || here === document.body)) back.focus({ preventScroll: true })
        }}
      >
        <div data-generate-controls>
          <h3 className="text-[13.5px] font-semibold text-fg">This scene already has text</h3>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">Where should the new draft go?</p>
          <div className="mt-3 flex flex-col gap-2">
            <ModeChoice
              mode="replace"
              icon={<RefreshCw size={14} />}
              label="Replace it"
              hint="The new draft takes its place."
              keyboard={choiceByKey}
              onClick={() => void generate('replace')}
            />
            <ModeChoice
              mode="fresh"
              icon={<Sparkles size={14} />}
              label="Fresh take"
              hint="Replaces it with a new take that doesn’t build on this draft."
              keyboard={choiceByKey}
              onClick={() => void generate('fresh')}
            />
            <ModeChoice
              mode="add"
              icon={<ArrowDownToLine size={15} />}
              label="Add below"
              hint="The new draft goes below a scene break."
              keyboard={choiceByKey}
              onClick={() => void generate('add')}
            />
          </div>
          <p className="mt-3 text-[12px] text-faint">Either way, {modKey()}+Z undoes it.</p>
        </div>
      </PopoverPanel>
    )
  }
  if (popover === 'building') {
    // Writing during a build (2026-10-17): a quiet note, never a dialog. Closing it drafts nothing.
    return (
      <PopoverPanel
        key="building"
        className="w-[320px]"
        side={side}
        onOpenAutoFocus={(e) => {
          // Wait takes the keyboard: Enter waits for the cast, as the note suggests.
          e.preventDefault()
          const panel = e.currentTarget instanceof HTMLElement ? e.currentTarget : null
          panel?.querySelector<HTMLElement>('[data-wait]')?.focus({ preventScroll: true })
        }}
      >
        <div data-generate-controls data-build-note>
          <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted">
            <Sparkles size={13} className="mt-[3px] shrink-0 text-ai" aria-hidden />
            {BUILDING_NOTE}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" onClick={g.writeNow}>
              Write now
            </Button>
            <Button variant="primary" size="sm" data-wait onClick={g.waitForBuild}>
              Wait
            </Button>
          </div>
        </div>
      </PopoverPanel>
    )
  }
  if (popover === 'need-model') {
    return (
      <PopoverPanel key="need-model" className="w-[300px]" side={side}>
        <h3 className="text-[13.5px] font-semibold text-fg">Choose a writer model first</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          AI Write needs a model to write with. Connect OpenRouter or another provider, then pick a writer model.
        </p>
        <Button variant="primary" size="sm" className="mt-3" onClick={g.openSettings}>
          Open Settings › Models
        </Button>
      </PopoverPanel>
    )
  }
  if (popover === 'options') {
    const { cardPlanned, cardWords, creativity, fixedCreativity, polishOn, modelName, draftCost } = g
    return (
      <PopoverPanel key="options" className="w-[340px]" side={side}>
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-[13.5px] font-semibold text-fg">Draft options</h3>
            <p className="text-[12px] leading-relaxed text-muted">{g.hasText ? AFTER_TEXT : "For this scene's next draft."}</p>
          </div>
          <DirectionComposer
            label="Direction for this draft (optional)"
            value={direction}
            onChange={setDirection}
            minRows={2}
            maxRows={6}
            placeholder="Make it tense, end on the knock at the door"
            side={side}
            // Enter (or Ctrl+Enter) drafts with it; Shift+Enter starts a new line.
            onSubmit={() => void generate(undefined, true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void generate(undefined, true)
              }
            }}
          />
          {cardPlanned === false && !direction.trim() ? (
            <p className="-mt-2 text-[12px] leading-relaxed text-faint">
              Tip: add a beat or two on the scene card, so the AI knows what happens in this scene.
            </p>
          ) : null}
          <LengthField value={opts.targetWords} cardWords={cardWords} onChange={(targetWords) => updateOpts({ targetWords })} />
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-muted">Creativity</span>
            {fixedCreativity ? (
              <p className="text-[12px] leading-relaxed text-faint">This model sets its own creativity, so there's nothing to choose here.</p>
            ) : (
              <>
                <Segmented label="Creativity" value={creativity} onChange={(c) => updateOpts({ creativity: c })} options={CREATIVITY_OPTIONS} className="w-full" />
                <p className="text-[12px] text-faint">{CREATIVITY_HINTS[creativity]}</p>
              </>
            )}
          </div>
          <label className="-mt-1 flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={polishOn}
              onChange={(e) => setPolishOn(e.target.checked)}
              className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
            />
            <span className="min-w-0">
              <span className="block text-[12.5px] font-medium text-fg">Polish after drafting</span>
              <span className="block text-[12px] leading-relaxed text-faint">
                A second pass tightens the draft against clichés, needless explaining and your style guide. You accept or reject the
                result in one step. Costs about twice as much.
              </span>
            </span>
          </label>
          {/* Directed writing, for this draft (src/main/director). */}
          <DirectedToggle sceneId={g.sceneId} />
          {/* Show me the plan first, for this draft (src/main/plan/review.ts). */}
          <PlanFirstToggle sceneId={g.sceneId} />
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3 text-[12px] text-muted">
            <span className="min-w-0 truncate">
              Writer:{' '}
              <button type="button" onClick={g.openSettings} className="font-medium text-fg hover:underline">
                {modelName ?? 'none chosen'}
              </button>
            </span>
            {draftCost != null ? (
              <span className="shrink-0 tabular-nums">
                {draftCost === 0 ? 'Free' : `${costLabel(draftCost, true)} a draft${polishOn ? ', polished' : ''}`}
              </span>
            ) : null}
          </div>
          <Button variant="primary" className="w-full" icon={<Sparkles size={14} />} onClick={() => void generate()}>
            Generate draft
            <span className="ml-1 text-[11.5px] font-normal opacity-70">{modKey()}+G</span>
          </Button>
        </div>
      </PopoverPanel>
    )
  }
  return null
}
