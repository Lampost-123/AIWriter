// The Generate button and its draft options, in the scene's toolbar.
// Generate (Ctrl+G) drafts the scene from its card into the editor; while it
// streams the button becomes Stop (Esc also stops) and the text so far stays.
// The draft itself is kept in draftRun.ts, so it keeps writing into its scene while
// Adam opens another one, and this button shows Stop again when he comes back.
// When the scene already has text, Generate first asks whether the new draft
// replaces it or goes below it. Once picked, the keyboard goes into the page, and
// Ctrl+Z on the Generate button works there too, so "Ctrl+Z undoes it" holds.
// With "Polish after drafting" on (in the draft options), a finished draft is then
// polished: the button shows Stop and "Polishing…" until the revision is ready.
import * as P from '@radix-ui/react-popover'
import { ChevronDown, Sparkles, Square } from '@/components/ui/icons'
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { ID } from '@shared/types'
import { Button } from '@/components/ui'
import { modKey } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatCost } from './format'
import { AFTER_TEXT, GeneratePanels } from './GeneratePanels'
import { useGenerate } from './useGenerate'
import { useDesk, useNewLook } from '@/features/look/look'

/**
 * Below this header width the writer model's name is left out, so Generate always fits and the scene's
 * title stays whole beside the scene's tools (Variants, Beat by beat, History, Listen).
 */
const COMPACT_BELOW = 640
/** The New look's Mark done keeps its words down to a narrower header, so the model name needs more room there. */
const COMPACT_BELOW_NEW = 680

/** True when the header around `ref` is too narrow for the model name next to Generate. */
function useNarrowHeader(ref: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false)
  const below = useNewLook() ? COMPACT_BELOW_NEW : COMPACT_BELOW
  // Measured before paint, so the header never shows one layout and then jumps to the other.
  useLayoutEffect(() => {
    const el = ref.current
    const host = el?.closest('header') ?? el?.parentElement
    if (!host) return
    const measure = (): void => setNarrow(host.getBoundingClientRect().width < below)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    return () => ro.disconnect()
  }, [ref, below])
  return narrow
}

export function GenerateControls({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const desk = useDesk()
  // Generate's workings (useGenerate.ts), with its keys: Ctrl+G, Esc to stop, Ctrl+Z on the button.
  const g = useGenerate(sceneId, { keys: true })
  const { writer, phase, busy, popover, setPopover, hasText, checkText, loadCard, hasPrices, polishOn, draftCost, modelName } = g
  const { generate, stop, written, status, statusTitle, showStatus, openSettings } = g
  const rootRef = useRef<HTMLDivElement>(null)
  const compact = useNarrowHeader(rootRef)
  const afterText = AFTER_TEXT

  return (
    <div ref={rootRef} data-generate-controls className="flex items-center gap-1.5">
      {compact ? (
        // Narrow header: only the amber light while writing (its slot is always kept, so nothing moves).
        <span role="status" title={showStatus ? (statusTitle ?? status) : undefined} className="flex h-8 w-4 items-center justify-center">
          {showStatus ? (
            <>
              <span className="h-2 w-2 rounded-full bg-ai animate-pulse" aria-hidden />
              <span className="sr-only">{status}</span>
            </>
          ) : null}
        </span>
      ) : (
        // Wide enough for the longest words that show while drafting ("Updating memory…"), so they never
        // spill over the buttons beside them whatever the writer model is called.
        <div className="relative flex h-8 min-w-[150px] items-center justify-end">
          <button
            type="button"
            onClick={openSettings}
            tabIndex={showStatus ? -1 : 0}
            title={writer ? `Writer model: ${writer.label || writer.modelId}. Change it in Settings › Models.` : 'Choose a writer model in Settings › Models.'}
            className={cn(
              'flex h-7 max-w-[230px] items-center gap-1.5 rounded-md px-2 text-[12px] text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg',
              showStatus && 'invisible'
            )}
          >
            <span className="truncate">{modelName ?? 'No writer model'}</span>
            {writer && hasPrices ? (
              <span
                className="w-[50px] shrink-0 text-left tabular-nums text-faint"
                title={polishOn ? 'Estimated cost of a draft, with the polish pass (about twice as much)' : 'Estimated cost of a draft'}
              >
                {draftCost != null ? `· ${formatCost(draftCost)}` : ''}
              </span>
            ) : null}
          </button>
          {showStatus ? (
            <span
              role="status"
              title={statusTitle}
              className="absolute inset-0 flex items-center justify-end gap-2 overflow-hidden whitespace-nowrap pr-2 text-[12.5px] font-medium text-ai animate-fade-in"
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-ai animate-pulse" aria-hidden />
              <span className="truncate">{status}</span>
              {written !== null && written > 0 ? (
                <span className="shrink-0 font-normal tabular-nums opacity-80">· {written.toLocaleString()} words</span>
              ) : null}
            </span>
          ) : null}
        </div>
      )}

      <P.Root open={popover !== null} onOpenChange={(o) => !o && setPopover(null)}>
        <P.Anchor asChild>
          <div className="flex w-[132px] shrink-0">
            {busy ? (
              // Also while the draft is starting (perhaps waiting for the memory to catch up first).
              <Button
                variant="secondary"
                // The New look: amber, with a slow shimmer while the draft is written (styles.css, .gen-running).
                className="gen-running w-full"
                icon={<Square size={11} fill="currentColor" />}
                onClick={stop}
                disabled={phase === 'stopping'}
                title={phase === 'polishing' ? 'Stop polishing (Esc). The draft stays as it was written.' : 'Stop writing (Esc). The text so far is kept.'}
              >
                Stop
              </Button>
            ) : (
              <>
                <Button
                  // The desk: the AI's own amber (its other buttons are warm ink).
                  variant={desk ? 'ai' : 'primary'}
                  className="flex-1 rounded-r-none"
                  icon={<Sparkles size={14} />}
                  onClick={() => void generate()}
                  onPointerEnter={() => {
                    loadCard()
                    checkText()
                  }}
                  onFocus={checkText}
                  title={`Draft this scene from its card (${modKey()}+G)${hasText ? `\n${afterText}` : ''}`}
                >
                  Generate
                </Button>
                <Button
                  variant={desk ? 'ai' : 'primary'}
                  className="w-7 rounded-l-none border-l border-accent-fg/25 px-0! desk:border-ai-fg/25"
                  aria-label="Draft options"
                  title="Draft options: direction, length, creativity and polish"
                  onClick={() => {
                    if (popover === 'options') setPopover(null)
                    else {
                      loadCard(true)
                      checkText()
                      setPopover('options')
                    }
                  }}
                >
                  <ChevronDown size={14} />
                </Button>
              </>
            )}
          </div>
        </P.Anchor>

        {/* Each panel is its own popover (keyed), so switching from one to another opens it afresh. */}
        <GeneratePanels g={g} />
      </P.Root>
    </div>
  )
}
