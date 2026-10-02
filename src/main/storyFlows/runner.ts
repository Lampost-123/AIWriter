// Runs the story flows of the open world in the background, one at a time per story and flow: a call
// while the same flow runs for that story waits and runs once the first has finished (a starting cast
// asked for meanwhile is drafted together). Stop drops what was waiting; a call after Stop runs once
// the stopped run has wound down. Keeps how each flow last went for this session, so story settings
// can show it as soon as they open; a run that follows one which changed something, and changes
// nothing itself, keeps the earlier result on show rather than "Nothing needed changing". Closing the
// world stops everything; nothing is written to a closed database. No Electron imports (index.ts
// connects it to the window).

import type Database from 'better-sqlite3'
import type { ID, WritingPrefs } from '@shared/types'
import type { StoryFlowKind, StoryFlowStatus } from '@shared/contracts/storyFlows'
import type { FlowModel } from './call'
import { runFlow, runningMessage, STOPPED, STOPPED_AFTER, type FlowArgs, type JobResult } from './jobs'

export interface RunnerDeps {
  db: Database.Database
  model: () => FlowModel | { error: string }
  prefs: () => WritingPrefs
  emitStatus: (s: StoryFlowStatus) => void
  /** After a flow wrote to the memory: which entries it touched. */
  emitChanged: (p: { sceneId: null; entryIds: ID[] }) => void
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

type Done = Extract<JobResult, { status: 'done' }>

interface Slot {
  args: FlowArgs
  controller: AbortController
  /** Asked for while this one runs: runs next. */
  next: FlowArgs | null
  /** The latest result in this chain of runs that changed something, to report if the later ones change nothing. */
  earlier: Done | null
  done: Promise<void>
}

const keyOf = (storyId: ID, flow: StoryFlowKind): string => `${storyId}:${flow}`

/** A call asked for while the same flow runs: the cast asked for is added up, otherwise the latest wins. */
function merge(a: FlowArgs | null, b: FlowArgs): FlowArgs {
  if (a?.flow === 'starting-cast' && b.flow === 'starting-cast') return { ...b, entryIds: [...new Set([...a.entryIds, ...b.entryIds])] }
  return b
}

export class FlowRunner {
  private readonly slots = new Map<string, Slot>()
  private readonly last = new Map<string, StoryFlowStatus>()
  private closed = false

  constructor(private readonly deps: RunnerDeps) {}

  get db(): Database.Database {
    return this.deps.db
  }

  /** Starts a flow in the background (or after the one running for the same story), and returns at once. */
  start(args: FlowArgs): void {
    if (this.closed) return
    const key = keyOf(args.storyId, args.flow)
    const slot = this.slots.get(key)
    if (slot) {
      slot.next = merge(slot.next, args)
      return
    }
    this.run(key, args, null)
  }

  private run(key: string, args: FlowArgs, earlier: Done | null): void {
    const controller = new AbortController()
    const slot: Slot = { args, controller, next: null, earlier, done: Promise.resolve() }
    this.slots.set(key, slot)
    this.status(args, 'running', this.safe(() => runningMessage(this.deps.db, args), 'Working…'))
    slot.done = runFlow(
      {
        db: this.deps.db,
        model: this.deps.model,
        prefs: this.deps.prefs(),
        signal: controller.signal,
        closed: () => this.closed,
        fetchImpl: this.deps.fetchImpl,
        retryDelays: this.deps.retryDelays
      },
      args
    )
      .then((r) => this.finished(key, slot, r))
      .catch((e) => console.error('A story flow could not report how it went', e))
  }

  private finished(key: string, slot: Slot, r: JobResult): void {
    if (this.slots.get(key) === slot) this.slots.delete(key)
    if (this.closed) return
    if (r.status === 'done' && r.runId) this.deps.emitChanged({ sceneId: null, entryIds: r.entryIds })
    const changed = r.status === 'done' && r.runId ? r : slot.earlier
    // Asked for again meanwhile (Stop drops what was waiting, so this was asked for after any Stop).
    if (slot.next) {
      this.run(key, slot.next, changed)
      return
    }
    if (r.status === 'failed') this.status(slot.args, 'failed', r.message)
    else if (r.status === 'stopped') this.status(slot.args, 'done', changed ? STOPPED_AFTER : STOPPED)
    else this.status(slot.args, 'done', r.runId || !changed ? r.message : changed.message)
  }

  /** Stops the flow running for this story (and drops one waiting after it). Nothing it worked out is kept. */
  stop(storyId: ID, flow: StoryFlowKind): void {
    const slot = this.slots.get(keyOf(storyId, flow))
    if (!slot) return
    slot.next = null
    slot.controller.abort()
  }

  /** The flows running for this story and how the others last went. */
  list(storyId: ID): StoryFlowStatus[] {
    return [...this.last.values()].filter((s) => s.storyId === storyId)
  }

  /** The world is closing: everything stops, and nothing more is written. */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const slot of this.slots.values()) {
      slot.next = null
      slot.controller.abort()
    }
  }

  /** Resolves once nothing is running (for tests). */
  async idle(): Promise<void> {
    while (this.slots.size) await Promise.all([...this.slots.values()].map((s) => s.done))
  }

  private status(args: FlowArgs, state: StoryFlowStatus['state'], message: string): void {
    const s: StoryFlowStatus = { storyId: args.storyId, flow: args.flow, state, message }
    this.last.set(keyOf(args.storyId, args.flow), s)
    this.deps.emitStatus(s)
  }

  private safe<T>(fn: () => T, fallback: T): T {
    try {
      return fn()
    } catch {
      return fallback
    }
  }
}
