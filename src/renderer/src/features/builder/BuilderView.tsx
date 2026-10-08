// The character builder and the lighter builders for places, groups and items. Two ways in: Quick
// start (notes in, a whole saved profile out, in one click) and Guided (the steps, with AI help only
// where Adam wants it). Opened from the entry lists, from a passage in a scene, or for an existing
// entry ("Open in the builder").
import { useCallback, useEffect, useState } from 'react'
import type { BuilderKind, BuilderStart } from '@shared/contracts/builder'
import type { Entry, ID } from '@shared/types'
import { Button, Notice, Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { useSlow } from '@/features/world/parts/useSlow'
import { Guided } from './Guided'
import { QuickStart } from './QuickStart'

// Each time the builder is opened (a new `start`, even for the same kind) it starts afresh.
const opened = new WeakMap<object, number>()
let openings = 0
const openingOf = (start: BuilderStart | undefined): number => {
  if (!start) return 0
  let n = opened.get(start)
  if (n === undefined) {
    n = ++openings
    opened.set(start, n)
  }
  return n
}

export function BuilderView({ kind, entryId, start }: { kind: BuilderKind; entryId: ID | null; start?: BuilderStart }): React.JSX.Element {
  const key = `${kind}|${entryId ?? ''}|${openingOf(start)}`
  return entryId ? <ExistingBuild key={key} kind={kind} entryId={entryId} step={start?.step} /> : <NewBuild key={key} kind={kind} start={start} />
}

/** A new entry: Quick start first (unless Adam asked for the steps), and the steps whenever he likes. */
function NewBuild({ kind, start }: { kind: BuilderKind; start?: BuilderStart }): React.JSX.Element {
  const [mode, setMode] = useState<'quick' | 'guided'>(start?.mode === 'guided' ? 'guided' : 'quick')
  // What Quick start built, once Adam opens it to look it over.
  const [built, setBuilt] = useState<Entry | null>(null)
  // Where it opens: Review once the follow-up questions built it, else the first step.
  const [builtStep, setBuiltStep] = useState<string | undefined>(undefined)
  // The steps stay put (hidden) while Quick start shows, so nothing typed in them is lost. Once Quick
  // start's profile is opened to look over, it is done with.
  const [guidedOpened, setGuidedOpened] = useState(mode === 'guided')
  const toGuided = useCallback(() => {
    setGuidedOpened(true)
    setMode('guided')
  }, [])
  return (
    <div className="h-full">
      {built ? null : (
        <div className={mode === 'quick' ? 'h-full' : 'hidden'}>
          <QuickStart
            kind={kind}
            start={start}
            onLookOver={(e, step) => {
              setBuiltStep(step)
              setBuilt(e)
              toGuided()
            }}
            onGuided={toGuided}
          />
        </div>
      )}
      {guidedOpened ? (
        <div className={mode === 'guided' ? 'h-full' : 'hidden'}>
          <Guided key={built?.id ?? 'new'} kind={kind} initial={built} firstStep={builtStep ?? start?.step} onQuickStart={built ? undefined : () => setMode('quick')} />
        </div>
      ) : null}
    </div>
  )
}

/** An existing entry, opened in the builder: its steps, starting at Basics (or the step asked for). */
function ExistingBuild({ kind, entryId, step }: { kind: BuilderKind; entryId: ID; step?: string }): React.JSX.Element {
  const [state, setState] = useState<{ entry: Entry | null; error: string | null }>({ entry: null, error: null })
  const load = useCallback(() => {
    setState({ entry: null, error: null })
    api
      .getEntry(entryId)
      .then((entry) => setState({ entry, error: null }))
      .catch((e: Error) => setState({ entry: null, error: e.message || 'Something went wrong.' }))
  }, [entryId])
  useEffect(load, [load])
  const slow = useSlow(!state.entry && !state.error)

  if (state.error) {
    return (
      <div className="mx-auto max-w-md px-6 pt-16">
        <Notice
          tone="danger"
          action={
            <Button size="sm" onClick={load}>
              Try again
            </Button>
          }
        >
          Couldn’t open it in the builder. {state.error}
        </Notice>
      </div>
    )
  }
  if (!state.entry) {
    // Opening takes a few milliseconds: nothing rather than a flash of a spinner.
    return slow ? (
      <div className="flex h-full items-center justify-center text-faint">
        <Spinner />
      </div>
    ) : (
      <div />
    )
  }
  const e = state.entry
  const entryKind = e.kind === 'character' || e.kind === 'place' || e.kind === 'group' || e.kind === 'item' ? e.kind : kind
  return <Guided kind={entryKind} initial={e} firstStep={step} fromPage />
}
