// The handlers for src/shared/contracts/chapterWriter.ts: Write the whole chapter. The work is done in
// src/main/chapterWriter/; this file connects it to the open world, the settings, the writer, the checks, the critic,
// History, the saves (the way the editor's go, so the memory keeper and search follow) and the window.
import type { Handlers } from './index'
import type { ChapterWriterApi } from '@shared/contracts/chapterWriter'
import type { DraftOptions, ID } from '@shared/types'
import { ALL_CHECKS } from '@shared/contracts/checks'
import { cardLength } from '@shared/defaults'
import * as world from '../world'
import * as repo from '../db/repo'
import * as providers from '../ai/providers'
import { emit } from '../events'
import { getSettings, getWritingPrefs } from '../settings'
import { jobModel } from '../ai/jobModel'
import { draftBriefing, providerNotes, writerModel } from '../ai/draftFlow'
import { isDrafting, startDraftJob, stopDraft } from '../ai/drafts'
import { stopTask } from '../ai/tasks'
import { catchUpBeforeDraft } from '../ai/gather'
import { currentKeeper } from '../keeper'
import { currentHistory } from '../history'
import { checkScene } from '../checks/run'
import { runCritique } from '../critique/run'
import { pausedNote } from '../usage/gate'
import { isStartingBeat } from '../beats'
import { variantsBusy } from '../variants'
import { newId, UserError } from '../util'
import { coreHandlers } from './core'
import { isStartingDraft } from './ai'
import { ChapterRun, chapterScenes, ownTitle, type RunDeps } from '../chapterWriter/run'
import { activeRun, setActiveRun } from '../chapterWriter/active'
import { loadBefore, loadReport, saveReport } from '../chapterWriter/store'
import type { Page } from '../chapterWriter/page'

/** How long a check waits for the memory to catch up before checking with what it has (as the checks do). */
const CATCH_UP_MS = 60_000

const sources = () => ({ settings: getSettings(), getProvider: providers.getProvider, providerTarget: providers.providerTarget })

/** Resolves when the promise does, after `ms`, or as soon as `signal` is aborted, whichever is first. */
const within = (p: Promise<unknown>, ms: number, signal: AbortSignal): Promise<void> =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const done = (): void => {
      clearTimeout(t)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const t = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    void p.finally(done)
  })

/** Runs `fn` with a task Stop wired to `signal`. */
async function withStop<T>(signal: AbortSignal, stop: () => void, fn: () => Promise<T>): Promise<T> {
  signal.addEventListener('abort', stop, { once: true })
  try {
    return await fn()
  } finally {
    signal.removeEventListener('abort', stop)
  }
}

/** A scene something else is writing into right now. */
const busy = (sceneId: ID): boolean => isDrafting(sceneId) || isStartingDraft(sceneId) || isStartingBeat(sceneId) || variantsBusy(sceneId)

let watching = false

function deps(runId: ID): RunDeps {
  const db = world.db()
  if (!watching) {
    watching = true
    // Closing a world stops its run first.
    world.onWorldClosing((w) => {
      const run = activeRun()
      if (run && run.dbIs(w.db)) void run.stop()
    })
  }
  const closed = (): boolean => world.maybeCurrentWorld()?.db !== db
  const writer = writerModel()
  return {
    db,
    agentModel: jobModel('chapter', sources()),
    prefs: getWritingPrefs(),
    history: currentHistory(),
    // The agent's calls go quietly: the run says how it goes itself (chapterWriter:progress).
    taskEmit: () => undefined,
    progress: (p) => emit('chapterWriter:progress', p),
    sceneChanged: (sceneId: ID, page: Page) => emit('chapterWriter:sceneChanged', { runId, sceneId, doc: page.doc, text: page.text }),
    draft: async (sceneId, o) => {
      if (busy(sceneId)) return { status: 'error', text: '', error: 'A draft is being written in this scene. Stop it, then start again.' }
      const card = repo.getScene(db, sceneId).card
      const options: DraftOptions = { direction: o.direction, targetWords: cardLength(card), creativity: getSettings().creativity, fresh: true }
      const extraBlocks = o.notes.trim()
        ? [{ id: 'chapter-brief', title: 'Notes for this scene, from studying the chapter (keep to these)', text: o.notes.trim() }]
        : []
      let b: Awaited<ReturnType<typeof draftBriefing>>
      try {
        b = await draftBriefing(sceneId, options, { extras: { extraBlocks }, signal: o.signal })
      } catch (e) {
        if (o.signal.aborted) return { status: 'stopped', text: '', error: null }
        if (e instanceof UserError) return { status: 'error', text: '', error: e.message }
        throw e
      }
      const started = startDraftJob({
        db,
        sceneId,
        partOf: { chapterWriter: { runId } },
        options: b.input.options,
        preview: b.preview,
        provider: b.target,
        model: b.choice,
        thinking: b.thinking,
        intensity: b.input.style.intensity,
        entryVersions: b.entryVersions,
        // The run puts the words in the scene itself; the window hears it from chapterWriter:sceneChanged.
        emit: () => undefined,
        ...providerNotes(b.target.id)
      })
      return withStop(o.signal, () => void stopDraft(started.generationId), () => started.done)
    },
    save: (sceneId, page, label) => {
      const now = repo.getScene(db, sceneId)
      if ((now.text ?? '').trim()) currentHistory()?.take({ sceneId, kind: 'ai', label, doc: now.doc, text: now.text })
      coreHandlers.saveSceneText(sceneId, page.doc, page.text)
    },
    check: async (sceneId, signal) => {
      // As the checks do: the memory reads earlier scenes first, then this scene's own waiting read.
      await catchUpBeforeDraft(db, sceneId, CATCH_UP_MS, signal)
      const k = currentKeeper()
      if (k && k.db === db && !signal.aborted) await within(k.whenRead(sceneId), CATCH_UP_MS, signal)
      if (signal.aborted) return { status: 'stopped' }
      let task: ID | null = null
      const r = await withStop(
        signal,
        () => {
          if (task) void stopTask(task)
        },
        () =>
          checkScene(
            {
              db,
              model: jobModel('check', sources()),
              prefs: getWritingPrefs(),
              stopped: () => signal.aborted || closed(),
              closed,
              onTask: (t) => (task = t),
              onKeyRejected: () => undefined
            },
            sceneId,
            ALL_CHECKS
          )
      )
      return r.status === 'error' ? { status: 'error', error: r.error } : { status: r.status }
    },
    critique: async (target, again, signal) => {
      const taskId = newId()
      try {
        return await withStop(
          signal,
          () => void stopTask(taskId),
          () =>
            runCritique(
              {
                db,
                model: jobModel('writer', sources()),
                prefs: getWritingPrefs(),
                emit: () => undefined,
                onKeyRejected: providerNotes(writer.target.id).onKeyRejected,
                closed
              },
              { taskId, target, again }
            )
        )
      } catch (e) {
        if (e instanceof UserError) return { status: 'error', error: e.message }
        throw e
      }
    },
    limitNote: pausedNote,
    closed
  }
}

export const chapterWriterHandlers: Handlers<keyof ChapterWriterApi> = {
  chapterWriterPlan: (chapterId) => {
    const db = world.db()
    const chapter = repo.getChapter(db, chapterId)
    const n = repo.getOutline(db, chapter.storyId).chapters.findIndex((c) => c.id === chapterId) + 1
    return {
      chapterId,
      title: `Chapter ${n}${ownTitle(chapter.title) ? `: ${ownTitle(chapter.title)}` : ''}`,
      scenes: chapterScenes(db, chapterId).map((s) => ({ sceneId: s.ref.id, label: s.ref.label, hasWords: s.words > 0, ready: s.ready })),
      busy: !!activeRun()
    }
  },
  startChapterWriter: (input) => {
    const runId = String(input?.runId ?? '')
    const chapterId = String(input?.chapterId ?? '')
    if (!runId || !chapterId) throw new UserError('Something went wrong starting that. Try again.')
    if (activeRun()) throw new UserError('The AI is already writing a chapter. Stop it first, or wait for it to finish.')
    const run = new ChapterRun(deps(runId), runId, chapterId)
    run.prepare()
    if (run.sceneIds.some(busy)) throw new UserError('A draft is being written in one of this chapter’s scenes. Stop it first, or wait for it to finish.')
    setActiveRun(run)
    void run
      .run()
      .then((report) => emit('chapterWriter:done', { runId, chapterId, report }))
      .catch((e) => console.error('The chapter writer failed', e))
      .finally(() => {
        if (activeRun() === run) setActiveRun(null)
      })
    return { runId }
  },
  stopChapterWriter: async (runId) => {
    const run = activeRun()
    if (run && run.runId === runId) await run.stop()
  },
  chapterWriterNow: () => activeRun()?.progressNow() ?? null,
  getChapterWriterReport: (chapterId) => loadReport(world.db(), chapterId),
  undoChapterWriter: (chapterId) => {
    const db = world.db()
    const run = activeRun()
    if (run && run.chapterId === chapterId) throw new UserError('The AI is still writing this chapter. Stop it first, then undo.')
    const report = loadReport(db, chapterId)
    const before = loadBefore(db, chapterId)
    if (!report || !before.length || report.undone) throw new UserError('There is nothing to undo for this chapter.')
    let restored = 0
    for (const b of before) {
      let now: ReturnType<typeof repo.getScene>
      try {
        now = repo.getScene(db, b.sceneId)
      } catch {
        continue // The scene has been deleted since: it stays as it is.
      }
      if ((now.text ?? '') === b.text) continue
      if ((now.text ?? '').trim()) currentHistory()?.take({ sceneId: b.sceneId, kind: 'restore', label: 'Before undoing Write the whole chapter', doc: now.doc, text: now.text })
      coreHandlers.saveSceneText(b.sceneId, b.doc, b.text)
      emit('chapterWriter:sceneChanged', { runId: report.runId, sceneId: b.sceneId, doc: b.doc, text: b.text })
      restored++
    }
    saveReport(db, { ...report, undone: true })
    return { restored }
  }
}
