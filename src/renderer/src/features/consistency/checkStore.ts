// The consistency checker as the binder, the palette and the Consistency page see it (milestone 5,
// Reports part): open issues per scene for the binder's badges, the check that is running (one at a
// time, started from the binder's row menus, the palette or the Consistency page) and how it ended.
// Listens to the checks:* and issues:changed events once, the first time anything here is used.
import { useEffect } from 'react'
import { create } from 'zustand'
import { ALL_CHECKS, DONE_CHECKS, type CheckKind, type CheckTarget } from '@shared/contracts/checks'
import type { ID, Outline } from '@shared/types'
import { toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { flushAll } from '@/lib/flush'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'

export type IssueCount = { count: number; mustFix: number }

export interface CheckRun {
  runId: ID
  target: CheckTarget
  storyId: ID
  /** What is being checked, in plain words: "Ch 3, Sc 2", "Ch 3", "Book 1". */
  what: string
  /** Scenes checked so far and in all; null until the first progress arrives. */
  done: number | null
  total: number | null
  /** The scene being checked now ("Ch 3, Sc 2: The ferry"). */
  current: string | null
  stopping: boolean
}

interface CheckState {
  /** Open issues per scene, for the story they were loaded for. */
  counts: { storyId: ID | null; byScene: Record<ID, IssueCount> }
  /** Bumped on every issues:changed, so lists of issues reload. */
  issuesRev: number
  run: CheckRun | null
  /** The last check that ended in an error, said on the Consistency page until dismissed or another starts. */
  failure: { storyId: ID; message: string } | null
}

export const useChecks = create<CheckState>(() => ({
  counts: { storyId: null, byScene: {} },
  issuesRev: 0,
  run: null,
  failure: null
}))

const get = useChecks.getState
const set = useChecks.setState

// ---------- Badges ----------

let countsTicket = 0

/** Loads the open issues per scene of a story; the badges keep showing the last counts meanwhile. */
export async function loadCounts(storyId: ID): Promise<void> {
  const mine = ++countsTicket
  try {
    const byScene = await api.issueCounts(storyId)
    if (mine === countsTicket) set({ counts: { storyId, byScene } })
  } catch {
    // The badges stay as they were; the next change tries again.
  }
}

/**
 * Keeps the badges in step with a story: when it opens, when the world changes and on issues:changed,
 * never on word counts (outlineRev moves with every word).
 */
export function useIssueCounts(storyId: ID | null): void {
  const worldId = useApp((s) => s.world?.id ?? null)
  const rev = useChecks((s) => s.issuesRev)
  useEffect(() => {
    listen()
    if (storyId) void loadCounts(storyId)
    else set({ counts: { storyId: null, byScene: {} } })
  }, [storyId, worldId, rev])
}

/** "2 issues, 1 must fix", for screen readers and the badge's tooltip. */
export function countWords({ count, mustFix }: IssueCount): string {
  const issues = `${count} ${count === 1 ? 'issue' : 'issues'}`
  return mustFix ? `${issues}, ${mustFix} must fix` : issues
}

// ---------- Checking ----------

/** What a target is, in plain words, from the story's outline. */
async function whatOf(target: CheckTarget, storyId: ID): Promise<string> {
  if (target.scope === 'story') return useApp.getState().stories.find((s) => s.id === storyId)?.title || 'this story'
  const held = useOutlineStore.getState().outline
  const o: Outline | null = held && held.story.id === storyId ? held : await api.getOutline(storyId).catch(() => null)
  if (!o) return target.scope === 'scene' ? 'this scene' : 'this chapter'
  const chapterNo = (id: ID): number => o.chapters.findIndex((c) => c.id === id) + 1
  if (target.scope === 'chapter') return `Ch ${chapterNo(target.id)}`
  const scene = o.scenes.find((s) => s.id === target.id)
  if (!scene) return 'this scene'
  const sceneNo = o.scenes.filter((s) => s.chapterId === scene.chapterId).findIndex((s) => s.id === scene.id) + 1
  return `Ch ${chapterNo(scene.chapterId)}, Sc ${sceneNo}`
}

/**
 * Starts checking a scene (every check), or a chapter or story (facts, knowledge and timeline, unless
 * `checks` says more). Progress shows on the Consistency page and in a quiet line in the binder.
 */
export async function startCheck(target: CheckTarget, storyId: ID, checks?: CheckKind[]): Promise<void> {
  listen()
  if (get().run) {
    toast('A check is already running. Stop it, or wait for it to finish, then try again.')
    return
  }
  const runId = crypto.randomUUID()
  const run: CheckRun = { runId, target, storyId, what: '', done: null, total: null, current: null, stopping: false }
  set({ run, failure: null })
  /** This run while it is still the one showing (the world changing clears it). */
  const mine = (): CheckRun | null => (get().run?.runId === runId ? get().run : null)
  /** Stop was pressed before the check went out: it never starts. */
  const calledOff = (): boolean => {
    const now = mine()
    if (now && !now.stopping) return false
    if (now) {
      set({ run: null })
      toast(`Check of ${now.what || 'it'} stopped.`)
    }
    return true
  }
  try {
    const what = await whatOf(target, storyId)
    if (mine()) set({ run: { ...mine()!, what } })
    // The checks read the scenes as saved: words typed a moment ago go in first.
    await flushAll()
    if (calledOff()) return
    await api.startCheck({ runId, target, checks: checks ?? (target.scope === 'scene' ? ALL_CHECKS : DONE_CHECKS) })
    sent.add(runId)
    // Stop pressed (or the world changed) while it was being started: stop it now it can be.
    if (!mine() || mine()!.stopping) await api.stopCheck(runId).catch(() => undefined)
  } catch (e) {
    if (!mine()) return
    set({ run: null })
    failed(storyId, plainReason(e))
  }
}

/** Runs the main process has been asked to start: until then, Stop only marks the run, and it never starts. */
const sent = new Set<ID>()

export const checkScene = (sceneId: ID, storyId: ID): Promise<void> => startCheck({ scope: 'scene', id: sceneId }, storyId)
export const checkChapter = (chapterId: ID, storyId: ID): Promise<void> => startCheck({ scope: 'chapter', id: chapterId }, storyId)
export const checkStory = (storyId: ID, checks?: CheckKind[]): Promise<void> => startCheck({ scope: 'story', id: storyId }, storyId, checks)

export async function stopCheck(): Promise<void> {
  const run = get().run
  if (!run || run.stopping) return
  set({ run: { ...run, stopping: true } })
  if (!sent.has(run.runId)) return
  try {
    await api.stopCheck(run.runId)
  } catch (e) {
    if (get().run?.runId === run.runId) set({ run: { ...get().run!, stopping: false } })
    toast(`The check couldn’t be stopped. ${plainReason(e)}`, { tone: 'danger' })
  }
}

/** A run that couldn't start or ended in an error: on the Consistency page, and in a toast elsewhere. */
function failed(storyId: ID, message: string): void {
  set({ failure: { storyId, message } })
  const view = useApp.getState().view
  if (view.kind === 'consistency' && view.storyId === storyId) return
  const settings = /Settings/.test(message)
  toast(message, {
    tone: 'danger',
    action: settings ? { label: 'Settings', run: () => useApp.getState().navigate({ kind: 'settings', tab: 'models' }) } : undefined
  })
}

export const dismissFailure = (): void => set({ failure: null })

/** Opens a story's Consistency page. */
export function openConsistency(storyId: ID): void {
  useApp.getState().navigate({ kind: 'consistency', storyId })
}

// ---------- Events ----------

let listening = false

function listen(): void {
  if (listening) return
  listening = true
  onEvent('checks:progress', (p) => {
    const run = get().run
    if (run?.runId !== p.runId) return
    set({ run: { ...run, done: p.done, total: p.total, current: p.current } })
  })
  onEvent('checks:done', (d) => {
    const run = get().run
    sent.delete(d.runId)
    if (run?.runId !== d.runId) return
    set({ run: null })
    if (d.status === 'error') return failed(run.storyId, d.error || 'The check stopped with a problem. Please try again.')
    const view = useApp.getState().view
    const here = view.kind === 'consistency' && view.storyId === run.storyId
    if (d.status === 'stopped') {
      toast(d.found ? `Check of ${run.what} stopped. ${found(d.found)} so far.` : `Check of ${run.what} stopped.`)
      return
    }
    toast(d.found ? `Checked ${run.what}. ${found(d.found)}.` : `Checked ${run.what}. Nothing new to look at.`, {
      tone: d.found ? 'neutral' : 'success',
      action: here || !d.found ? undefined : { label: 'Show', run: () => openConsistency(run.storyId) }
    })
  })
  // The badges (useIssueCounts) and the Consistency page reload from this.
  onEvent('issues:changed', () => set({ issuesRev: get().issuesRev + 1 }))
  // A check and its failure belong to the world they were started in.
  useApp.subscribe((now, before) => {
    if (now.world?.id !== before.world?.id) set({ run: null, failure: null, counts: { storyId: null, byScene: {} } })
  })
}

const found = (n: number): string => (n === 1 ? '1 new issue' : `${n} new issues`)
