// Getting a draft's briefing ready, in one place: the writer model's checks, the memory catching up with
// earlier scenes first, the briefing fitted to the writer model, and the "too long" checks, all in plain
// words. Generate uses it, and so do milestone 4's Variants and Beat by beat, with their own closing
// instruction and (for a beat) the scene so far. Works on the open world and the app's settings.

import type { ContextPreview, DraftOptions, ID, ModelChoice, ThinkingLevel } from '@shared/types'
import { UserError } from '../util'
import * as world from '../world'
import { getSettings, getWritingPrefs } from '../settings'
import * as providers from './providers'
import type { ChatTarget } from './client'
import {
  cachedCounter,
  finishContext,
  lengthTooLong,
  prepareContext,
  sentEntryVersions,
  type ContextExtras,
  type ContextInput
} from './context'
import { catchUpBeforeDraft, gatherContextInput } from './gather'
import { countTokens } from './tokenService'
import { isLocalUrl, providerWho } from './errors'

/** The preview is made again as Adam edits the scene card: only the blocks that changed are counted again. */
const countCached = cachedCounter(countTokens)

/** The writer model and how to reach it, or a plain-words UserError saying what to set up in Settings › Models. */
export function writerModel(): { choice: ModelChoice; target: ChatTarget & { id: ID }; thinking: ThinkingLevel } {
  const settings = getSettings()
  const choice = settings.models.writer
  if (!choice) throw new UserError('Choose a writer model first, in Settings › Models.', 'no-writer-model')
  const provider = providers.getProvider(choice.providerId)
  if (!provider)
    throw new UserError("The writer model's provider has been removed. Choose a writer model in Settings › Models.", 'no-writer-model')
  const target = providers.providerTarget(provider)
  if (!target.apiKey && !(provider.kind === 'custom' && isLocalUrl(provider.baseUrl))) {
    throw new UserError(`${providerWho(provider)} needs an API key. Add it in Settings › Models.`, 'no-key')
  }
  return { choice, target, thinking: settings.thinking?.writer ?? 'off' }
}

/** Assembles the briefing for a scene with the current writer model's context length. */
export async function assemble(
  sceneId: ID,
  options: Partial<DraftOptions> | undefined,
  extras?: ContextExtras
): Promise<{ input: ContextInput; preview: ContextPreview }> {
  const settings = getSettings()
  const input = gatherContextInput(world.db(), sceneId, options, {
    prefs: getWritingPrefs(),
    contextLength: settings.models.writer?.contextLength ?? null,
    maxOutput: settings.models.writer?.maxOutput ?? null,
    creativity: settings.creativity
  })
  // With reading aloud on, the writer says who speaks each line as it writes (ai/speakerTags.ts).
  const speech = settings.speech
  // With Mark who says what, how the narration is read too.
  const tags = speech?.readAloud || speech?.showSpeakers ? { narration: !!speech.markSpeakers } : undefined
  const prepared = prepareContext(input, { ...extras, speakerTags: tags })
  const counts = await countCached(prepared.texts)
  return { input, preview: finishContext(prepared, counts) }
}

/** Adam stopped the draft before it began: nothing more is done or sent. */
export const stoppedBeforeStart = (): UserError => new UserError('The draft was stopped before it began.', 'cancelled')

export interface DraftBriefing {
  input: ContextInput
  preview: ContextPreview
  choice: ModelChoice
  target: ChatTarget & { id: ID }
  thinking: ThinkingLevel
  /** The version of each entry actually sent, for "What the AI saw". */
  entryVersions: Map<ID, string>
}

/**
 * Everything a draft needs before it is sent. Earlier scenes the memory hasn't read yet are read first,
 * so the briefing is up to date (spec, Memory upkeep): this never waits long, a failure drafts with what
 * the memory has, and `signal` ends the wait at once (then this fails with the code 'cancelled').
 * `catchUp: false` skips that (a later beat of the same draft, say, right after the first).
 */
export async function draftBriefing(
  sceneId: ID,
  options: Partial<DraftOptions> | undefined,
  o: { extras?: ContextExtras; signal?: AbortSignal; catchUp?: boolean } = {}
): Promise<DraftBriefing> {
  const { choice, target, thinking } = writerModel()
  const db = world.db()
  if (o.catchUp !== false) await catchUpBeforeDraft(db, sceneId, undefined, o.signal)
  if (o.signal?.aborted) throw stoppedBeforeStart()
  if (world.maybeCurrentWorld()?.db !== db) throw new UserError('The world was closed before the draft could start.')
  const { input, preview } = await assemble(sceneId, options, o.extras)
  if (o.signal?.aborted) throw stoppedBeforeStart()
  if (world.maybeCurrentWorld()?.db !== db) throw new UserError('The world was closed before the draft could start.')
  // A model whose window is known can't take a reply longer than what's left of it: say so
  // before sending, rather than letting the provider turn it down with a message about the briefing.
  const tooLong = choice.contextLength != null && choice.contextLength > 0 ? lengthTooLong(preview.budget) : null
  if (tooLong) {
    if (tooLong.maxWords >= 100 && input.options.targetWords == null) {
      // Auto came down as far as it goes (AUTO_LENGTH.min) and still doesn't fit: a set length can.
      throw new UserError(
        `This model can write about ${tooLong.maxWords.toLocaleString('en-GB')} words in one go, less than Auto needs. Set a length in the draft options or on the scene card, or pick a model that can read more in Settings › Models.`,
        'too-long'
      )
    }
    if (tooLong.maxWords >= 100) {
      throw new UserError(
        `This model can write about ${tooLong.maxWords.toLocaleString('en-GB')} words in one go. Lower the length in the draft options or on the scene card, or pick a model that can read more in Settings › Models.`,
        'too-long'
      )
    }
    throw new UserError(
      "This model can't read the style guide and the scene card and still write the scene. Pick a model that can read more in Settings › Models, or shorten the scene card or the style guide.",
      'briefing-too-long'
    )
  }
  return { input, preview, choice, target, thinking, entryVersions: sentEntryVersions(input.memory, preview.blocks) }
}

/** Provider bookkeeping every draft does: a key turned down shows in Settings; a provider that writes works again. */
export function providerNotes(providerId: ID): { onKeyRejected: () => void; onWorked: () => void } {
  return {
    onKeyRejected: () => providers.markCheck(providerId, false),
    onWorked: () => {
      if (providers.getProvider(providerId)?.lastCheck?.ok === false) providers.markCheck(providerId, true)
    }
  }
}
