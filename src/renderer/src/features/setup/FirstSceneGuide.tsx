// The first scene's guide (milestone 6): a slim bar above the page of the scene the first-run setup opened, never
// over the words. One step at a time: fill in the scene card, Generate (Ctrl+G), make the draft your own, Mark
// done (Ctrl+Enter). It follows what Adam does rather than asking him to click Next, and goes away for good once
// the scene is marked done or the guide is closed (Settings.firstRun is cleared). On the desk it is a slip of paper
// tucked at the top of the sheet, above the scene's head (`slip`), and points at the AI dock rather than Generate.

import { Check, X } from '@/components/ui/icons'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ID } from '@shared/types'
import { Button, IconButton, Kbd, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { shortcutKeys } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { cardFilled, GUIDE_STEPS, guideStep, type GuideStep } from './setupLogic'

/** Shown above the page of the first scene only. */
export function FirstSceneGuide({ sceneId, slip }: { sceneId: ID; slip?: boolean }): React.JSX.Element | null {
  const firstRun = useApp((s) => s.settings?.firstRun ?? null)
  const worldId = useApp((s) => s.world?.id ?? null)
  if (!firstRun || firstRun.step !== 'guide' || firstRun.sceneId !== sceneId || firstRun.worldId !== worldId) return null
  return <Guide key={sceneId} sceneId={sceneId} slip={slip} />
}

/** The guide is over: it never shows again. */
async function endGuide(): Promise<void> {
  try {
    await api.endFirstSceneGuide()
    useApp.setState({ settings: await api.getSettings() })
  } catch (e) {
    toast((e as Error).message, { tone: 'danger' })
  }
}

function Guide({ sceneId, slip }: { sceneId: ID; slip?: boolean }): React.JSX.Element | null {
  const words = useApp((s) => s.sceneWords)
  const drafting = useApp((s) => s.activeGeneration?.sceneId === sceneId)
  const briefingRev = useApp((s) => s.briefingRev)
  const done = useOutlineStore((s) => s.outline?.scenes.find((x) => x.id === sceneId)?.status === 'done')
  const [card, setCard] = useState(false)
  const [edited, setEdited] = useState(false)

  // The card is read again whenever something the briefing is built from changes (the card's saves do that).
  useEffect(() => {
    let live = true
    api
      .getScene(sceneId)
      .then((s) => live && setCard(cardFilled(s.card)))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [sceneId, briefingRev])

  const step = guideStep({ card, words, drafting, edited, done })

  // Once there is a draft, anything Adam types, pastes or deletes in the page is his own edit (a draft streaming in
  // never fires these).
  useEffect(() => {
    if (step !== 'edit') return
    const onInput = (e: Event): void => {
      if (e.target instanceof Element && e.target.closest('.scene-prose')) setEdited(true)
    }
    document.addEventListener('beforeinput', onInput, true)
    return () => document.removeEventListener('beforeinput', onInput, true)
  }, [step])
  const ended = useRef(false)
  useEffect(() => {
    if (step !== 'finished' || ended.current) return
    ended.current = true
    toast('That’s your first scene done. The memory and its summary are catching up. Every shortcut is in the list under ?.', {
      tone: 'success'
    })
    void endGuide()
  }, [step])

  if (step === 'finished') return null
  const n = GUIDE_STEPS.indexOf(step)

  if (slip) {
    // The desk: a slip of paper at the top of the sheet, its steps as small rings.
    return (
      <div role="region" aria-label="Your first scene" data-desk-guide className="desk-paper desk-guide k-guide">
        <span className="s-head">
          <span className="desk-caps s-kind">Your first scene</span>
          <ol className="desk-guide-steps" aria-label={`Step ${n + 1} of ${GUIDE_STEPS.length}`}>
            {GUIDE_STEPS.map((s, i) => (
              <li key={s} aria-current={i === n ? 'step' : undefined} className={cn(i < n && 'is-done', i === n && 'is-on')}>
                {i < n ? <Check size={10} aria-label="done" /> : i + 1}
              </li>
            ))}
          </ol>
        </span>
        <p className="desk-guide-text" aria-live="polite">
          <StepText step={step} drafting={drafting} desk />
        </p>
        {step === 'card' ? (
          <span className="s-acts">
            <button type="button" className="desk-sec-sm press" onClick={openCard}>
              Open the scene card
            </button>
          </span>
        ) : null}
        <button type="button" className="desk-slip-x" aria-label="Close the guide" title="Close the guide" onClick={() => void endGuide()}>
          <X size={12} />
        </button>
      </div>
    )
  }

  return (
    <div role="region" aria-label="Your first scene" className="shrink-0 border-b border-line/70 bg-surface px-4 py-2 animate-fade-in">
      <div className="flex min-h-[40px] items-center gap-3">
        <span className="hidden shrink-0 text-[11.5px] font-semibold uppercase tracking-wide text-faint min-[760px]:inline">
          Your first scene
        </span>
        <ol className="flex shrink-0 items-center gap-1" aria-label={`Step ${n + 1} of ${GUIDE_STEPS.length}`}>
          {GUIDE_STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === n ? 'step' : undefined}
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums transition-colors duration-200',
                i < n ? 'bg-success-soft text-success' : i === n ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-faint'
              )}
            >
              {i < n ? <Check size={11} aria-label="done" /> : i + 1}
            </li>
          ))}
        </ol>
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-muted" aria-live="polite">
          <StepText step={step} drafting={drafting} />
        </p>
        {step === 'card' ? (
          <Button size="sm" className="shrink-0" onClick={openCard}>
            Open the scene card
          </Button>
        ) : null}
        <IconButton label="Close the guide" size="sm" className="shrink-0" onClick={() => void endGuide()}>
          <X size={14} />
        </IconButton>
      </div>
    </div>
  )
}

function Keys({ id }: { id: 'generate' | 'markDone' | 'stop' }): React.JSX.Element {
  return (
    <span className="inline-flex translate-y-[-1px] items-center gap-0.5 align-middle">
      {shortcutKeys(id).map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  )
}

const Strong = ({ children }: { children: ReactNode }): React.JSX.Element => <strong className="font-medium text-fg">{children}</strong>

function StepText({ step, drafting, desk }: { step: GuideStep; drafting: boolean; desk?: boolean }): React.JSX.Element {
  if (step === 'card')
    return (
      <>
        <Strong>Fill in the scene card</Strong> {desk ? 'in Scene details' : 'on the right'}: who’s in it, where it happens and what should
        happen.
      </>
    )
  if (step === 'generate')
    return drafting ? (
      <>
        <Strong>The AI is writing the scene.</Strong> Read along as it goes; <Keys id="stop" /> stops it.
      </>
    ) : desk ? (
      <>
        <Strong>Press Draft the scene</Strong> at the foot of the page <Keys id="generate" /> and the AI drafts it from its card and your world.
      </>
    ) : (
      <>
        <Strong>Press Generate</Strong> <Keys id="generate" /> and the AI drafts the scene from its card and your world.
      </>
    )
  if (step === 'edit')
    return (
      <>
        <Strong>Make it yours.</Strong> Change anything you like in the page. It saves as you type, and the memory keeps up.
      </>
    )
  return (
    <>
      <Strong>Mark it done</Strong> <Keys id="markDone" /> when you’re happy with it. That’s the whole loop: card, draft, edit, done.
    </>
  )
}

/** Shows the scene card in the scene panel (opening the panel if it is closed). */
function openCard(): void {
  const app = useApp.getState()
  app.peekEntry(null)
  app.setAskOpen(false)
  app.setInspectorTab('card')
  if (app.settings && !app.settings.layout.inspectorOpen) void app.updateSettings({ layout: { inspectorOpen: true } })
}
