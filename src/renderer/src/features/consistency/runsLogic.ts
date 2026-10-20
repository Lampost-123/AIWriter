// Every check run as the window knows it, in one place (the calm overhaul, 2026-10-19: the Issues tab and the Consistency
// page each kept their own, so a check started in one didn't show in the other, and only one of them said what it was
// waiting for). The runs come from the main process's events ('checks:progress', 'checks:done'), whoever started them:
// Adam (the top bar's Check, the binder, the palette, the Issues list, the Check room), marking a scene done, or a draft
// landing. Pure, so it is unit-tested; checkStore.ts keeps the state and listens.
import type { CheckDone, CheckProgress } from '@shared/contracts/checks'
import type { ID, MemoryStatus } from '@shared/types'

/** A run as its events tell it; `where` is the first scene it named (kept once it moves on). */
export type Run = CheckProgress & { background: boolean; where: string | null }

export interface RunsState {
  /** Runs going on or waiting their turn, in the order they were asked for (the first is the one checking now). */
  runs: Record<ID, Run>
  /** The last check that went wrong, per scene, in plain words; cleared when one of Adam's starts or one works. */
  failed: Record<ID, string>
}

/** Started by marking a scene done or by a draft landing, not by Adam. */
export const isBackgroundRun = (runId: ID): boolean => runId.startsWith('done:') || runId.startsWith('draft:')

/** The scenes a run covers. */
export const scenesOf = (r: Pick<CheckProgress, 'sceneIds' | 'target'>): ID[] => r.sceneIds ?? (r.target.scope === 'scene' ? [r.target.id] : [])

/** A run moved on (or started, or began or stopped waiting). One of Adam's starting clears the failures of its scenes. */
export function progressed(s: RunsState, p: CheckProgress): RunsState {
  const was = s.runs[p.runId]
  const run: Run = { ...p, background: was?.background ?? isBackgroundRun(p.runId), where: was?.where ?? p.current }
  const failed = { ...s.failed }
  if (!was && !run.background) for (const id of scenesOf(p)) delete failed[id]
  return { runs: { ...s.runs, [p.runId]: run }, failed }
}

/**
 * A run ended: it goes, and its scenes say it went wrong (any run's error, the automatic ones' too: a model that turns
 * explicit scenes down, say), or no longer do once one worked. `scenes`: the scenes whose issues to read again.
 */
export function ended(s: RunsState, d: CheckDone): { state: RunsState; run: Run | null; scenes: ID[] } {
  const run = s.runs[d.runId] ?? null
  const runs = { ...s.runs }
  delete runs[d.runId]
  const scenes = run ? scenesOf(run) : d.target.scope === 'scene' ? [d.target.id] : []
  const failed = { ...s.failed }
  if (d.status === 'error' && d.error) for (const id of scenes) failed[id] = d.error
  else if (d.status === 'complete') for (const id of scenes) delete failed[id]
  return { state: { runs, failed }, run, scenes }
}

/** The run checking this scene now (or waiting to), if any: Adam's own first. */
export function runFor(runs: Record<ID, Run>, sceneId: ID): Run | null {
  const covering = Object.values(runs).filter((r) => scenesOf(r).includes(sceneId))
  return covering.find((r) => !r.background) ?? covering[0] ?? null
}

/** The run this one waits behind (one at a time: the first asked for checks first), or null when it is the one checking. */
export function waitingBehind(runs: Record<ID, Run>, runId: ID): Run | null {
  const order = Object.values(runs)
  const at = order.findIndex((r) => r.runId === runId)
  return at > 0 ? order[0] : null
}

/** How far the memory has got catching up before the scene, when something waits on it (MemoryStatus.catchingUp). */
export function memoryFor(status: Pick<MemoryStatus, 'catchingUp'> | null | undefined, sceneId: ID | null | undefined): NonNullable<MemoryStatus['catchingUp']>[number] | null {
  if (!sceneId) return null
  const all = (status?.catchingUp ?? []).filter((c) => c.sceneId === sceneId)
  // Earlier scenes first: the scene's own read comes after them.
  return all.find((c) => c.stage === 'earlier') ?? all[0] ?? null
}

/** "Catching up the memory: scene 3 of 5" (`lead`: what is waiting, "Catching up the memory" or "Waiting for the memory"). */
export function memoryWords(m: { done: number; total: number; stage: 'earlier' | 'scene' } | null, lead = 'Catching up the memory'): string {
  if (!m) return `${lead}…`
  if (m.stage === 'scene') return `${lead}: this scene’s latest words…`
  if (m.total <= 1) return `${lead}: the scene before…`
  return `${lead}: scene ${Math.min(m.done + 1, m.total)} of ${m.total}`
}

/**
 * What a run is doing, in plain words, for the Issues list, the top bar's Check and the Check room:
 * "Waiting for the check of Ch 2, Sc 1 to finish…", "Waiting for the memory to catch up: scene 2 of 4",
 * "Checking Ch 3, Sc 2 · 2 of 5", "Comparing with Book 2". `what`: what Adam asked to check ("Ch 3"), when it was his.
 */
export function runLine(
  run: Pick<Run, 'runId' | 'done' | 'total' | 'current' | 'target' | 'waiting' | 'currentSceneId'>,
  o: { runs?: Record<ID, Run>; memory?: Pick<MemoryStatus, 'catchingUp'> | null; short?: boolean } = {}
): string {
  const ahead = o.runs ? waitingBehind(o.runs, run.runId) : null
  if (ahead) return `Waiting for the check of ${ahead.where ? short(ahead.where) : 'another scene'} to finish…`
  if (run.waiting === 'memory') return memoryWords(memoryFor(o.memory, run.currentSceneId), 'Waiting for the memory to catch up')
  if (run.current?.startsWith('Comparing')) return run.current
  const current = run.current ? (o.short ? short(run.current) : run.current) : null
  if (run.target.scope === 'scene' || run.total <= 1) return current ? `Checking ${current}` : 'Checking…'
  return `Checking ${current ?? '…'} · ${Math.min(run.done + 1, run.total)} of ${run.total}`
}

/** "Ch 3, Sc 2" from "Ch 3, Sc 2: The ferry". */
const short = (where: string): string => where.split(':')[0]
