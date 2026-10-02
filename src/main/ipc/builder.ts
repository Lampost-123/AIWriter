// Milestone 3: the handlers for src/shared/contracts/builder.ts (one part owns both files). The work is
// done in src/main/builder/*; this file connects it to the open world, the settings and the window.
import type { Handlers } from './index'
import type { BuilderApi, BuilderKind } from '@shared/contracts/builder'
import type { ID } from '@shared/types'
import * as world from '../world'
import * as repo from '../db/repo'
import * as providers from '../ai/providers'
import { getSettings, getWritingPrefs } from '../settings'
import { emit } from '../events'
import { UserError } from '../util'
import { builderTarget } from '../builder/model'
import { gatherWorld } from '../builder/context'
import { startFleshOut, startInterview, startOptions, startQuickStart, stopJob, stopJobsFor, type JobContext } from '../builder/jobs'
import { createBuilt, isBuilderKind, keepSuggestions, restoreField } from '../builder/save'

// Closing a world stops its builder jobs first, saving what Quick start has while the database is still open.
world.onWorldClosing((w) => stopJobsFor(w.db))

function kindOf(kind: string): BuilderKind {
  if (!isBuilderKind(kind)) throw new UserError('The builder makes characters, places, groups and items.')
  return kind
}

/** What every job needs: the open world, the builder's model (or why there is none) and the window. */
function jobContext(): JobContext {
  const db = world.db()
  const model = builderTarget({ settings: getSettings(), getProvider: providers.getProvider, providerTarget: providers.providerTarget })
  return {
    db,
    model,
    emit,
    // The memory changed: lists and pages showing the entry reload, and backups see the world changed.
    onSaved: (entryId) => {
      if (!db.open) return
      repo.touchWorld(db)
      emit('memory:changed', { sceneId: null, entryIds: [entryId] })
    },
    onKeyRejected: () => providers.markCheck(model.target.id, false)
  }
}

const brief = (ctx: JobContext, kind: BuilderKind, excludeId: ID | null, storyId: ID | null | undefined) =>
  gatherWorld(ctx.db, { kind, excludeId, storyId, prefs: getWritingPrefs() })

export const builderHandlers: Handlers<keyof BuilderApi> = {
  startQuickStart: (input) => {
    const kind = kindOf(input.kind)
    const ctx = jobContext()
    startQuickStart(ctx, { ...input, kind }, brief(ctx, kind, input.entryId ?? null, input.storyId))
  },
  startFleshOut: (input) => {
    const kind = kindOf(input.kind)
    const ctx = jobContext()
    startFleshOut(ctx, { ...input, kind }, brief(ctx, kind, input.entryId, input.storyId))
  },
  startOptions: (input) => {
    const kind = kindOf(input.kind)
    const ctx = jobContext()
    startOptions(ctx, { ...input, kind }, brief(ctx, kind, input.entryId, input.storyId))
  },
  startInterview: (input) => {
    const ctx = jobContext()
    startInterview(ctx, input, brief(ctx, 'character', input.entryId, input.storyId))
  },
  stopBuilder: (jobId) => stopJob(jobId),
  createBuilderEntry: (input) => {
    const db = world.db()
    const e = createBuilt(db, kindOf(input.kind), input.values, input.aiKeys ?? [], input.storyId ?? null)
    repo.touchWorld(db)
    return e
  },
  keepSuggestions: (entryId, values, opts) => {
    const db = world.db()
    const e = keepSuggestions(db, entryId, values, !!opts?.replace)
    repo.touchWorld(db)
    return e
  },
  restoreBuilderField: (entryId, key, value, origin) => {
    const db = world.db()
    const e = restoreField(db, entryId, key, String(value ?? ''), origin === 'text' || origin === 'ai' ? origin : 'adam')
    repo.touchWorld(db)
    return e
  }
}
