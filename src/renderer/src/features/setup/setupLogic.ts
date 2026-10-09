// The first run's logic (milestone 6): the steps in order, the writer model it recommends, what the read-aloud step
// offers, and where the first scene's guide is. Pure, so it is unit-tested; FirstRun.tsx, ReadAloudStep.tsx and
// FirstSceneGuide.tsx show it.

import type { ModelInfo, SceneCard } from '@shared/types'
import { SETUP_STEPS, type SetupStep } from '@shared/contracts/setup'
import type { SpeechDownloadKind, SpeechStatus } from '@shared/contracts/speech'
import { voicesChecks } from '../speech/voiceNeeds'

// ---------- Steps ----------

/** Each step's short name, for the progress line. */
export const STEP_NAMES: Record<SetupStep, string> = {
  world: 'Your world',
  connect: 'Connect',
  model: 'Writer model',
  style: 'Style',
  voices: 'Read aloud',
  builder: 'Lay it out'
}

export const stepNumber = (step: SetupStep): number => SETUP_STEPS.indexOf(step) + 1

export const nextStep = (step: SetupStep): SetupStep | null => SETUP_STEPS[SETUP_STEPS.indexOf(step) + 1] ?? null

export const previousStep = (step: SetupStep): SetupStep | null => SETUP_STEPS[SETUP_STEPS.indexOf(step) - 1] ?? null

// ---------- The writer model it recommends ----------

/** Special editions left out of a suggestion ("-preview", "-mini" and the like), except DeepSeek Flash. */
const SPECIAL = /-(preview|mini|nano|lite|flash|exp|beta|instruct|vision|audio)\b/i

/** DeepSeek models that aren't for writing prose: reasoners, coders and the like. */
const DEEPSEEK_NOT_PROSE = /reason|-r\d\b|prover|coder|ocr|distill|math/i

/** DeepSeek's own API, as the DeepSeek preset in Settings › Models connects it. */
const DEEPSEEK_API = /^https?:\/\/api\.deepseek\.com(\/|$)/i

/** A DeepSeek model: any model on DeepSeek's own API, or one named for DeepSeek elsewhere ("deepseek/…" on OpenRouter). */
const isDeepSeek = (id: string, baseUrl?: string): boolean => (!!baseUrl && DEEPSEEK_API.test(baseUrl)) || /^deepseek[/-]/i.test(id)

/** A maker's models by name, special editions left out. */
const named =
  (match: RegExp) =>
  (id: string): boolean =>
    match.test(id) && !SPECIAL.test(id)

/**
 * Kinds of model that write good prose, best first, each with why in plain words. DeepSeek comes first, Flash above
 * all (as tests/traps/models.ts pickFlash finds it): good prose for very little, which long stories need. Shown as a
 * suggestion with a "Use this" button: never chosen for Adam without his say.
 */
const WRITER_PICKS: { match: (id: string, deepseek: boolean) => boolean; why: string }[] = [
  { match: (id, deepseek) => deepseek && /flash/i.test(id), why: 'Good prose, quickly, for very little: the best value for long stories.' },
  { match: (id, deepseek) => deepseek && !DEEPSEEK_NOT_PROSE.test(id) && !SPECIAL.test(id), why: 'Good prose for very little.' },
  { match: named(/^anthropic\/claude-[\w.-]*sonnet[\w.-]*$/i), why: 'Natural, careful prose that follows a scene card closely, at a fair price.' },
  { match: named(/^anthropic\/claude-[\w.-]*opus[\w.-]*$/i), why: 'Rich, careful prose. It costs more per word than most.' },
  { match: named(/^google\/gemini-[\d.]+-pro[\w.-]*$/i), why: 'Good prose and reads a great deal at once, at a fair price.' },
  { match: named(/^openai\/gpt-[\d.]+[\w.-]*$/i), why: 'Good, dependable prose at a fair price.' }
]

/** The numbers in a model's id, to put newer versions first ("claude-sonnet-4.5" before "claude-3.7-sonnet"). */
const versionOf = (id: string): number[] => (id.match(/\d+/g) ?? []).map(Number)

function newer(a: string, b: string): number {
  const x = versionOf(a)
  const y = versionOf(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? -1) - (x[i] ?? -1)
    if (d) return d
  }
  return 0
}

/**
 * The writer model to suggest from a provider's list (baseUrl is that provider's address): the newest of the first
 * kind on WRITER_PICKS that the list has, never a variant (":free", ":thinking"). Null when none fits.
 */
export function recommendWriter(models: ModelInfo[], baseUrl?: string): { model: ModelInfo; why: string } | null {
  const plain = models.filter((m) => !m.id.includes(':'))
  for (const pick of WRITER_PICKS) {
    const found = plain.filter((m) => pick.match(m.id, isDeepSeek(m.id, baseUrl))).sort((a, b) => newer(a.id, b.id))
    if (found.length) return { model: found[0], why: pick.why }
  }
  return null
}

// ---------- Read aloud ----------

type SpeechFacts = Pick<SpeechStatus, 'installed' | 'download' | 'queued' | 'nvidia' | 'nvidiaMemoryMb' | 'nvidiaComputeCap'>

const READ_ALOUD_KINDS: SpeechDownloadKind[] = ['voices', 'studio']

/**
 * What the read-aloud step offers: 'ready' when the voices and the studio voices are downloaded; 'downloading' while
 * either is downloading, waiting or stopped (its card in the step says which); 'cant-run' when this computer's
 * graphics card can't run the voices, with Settings' own words for why; else 'offer'. A card not known yet is offered.
 */
export function readAloudOffer(s: SpeechFacts): { kind: 'ready' | 'downloading' | 'offer' } | { kind: 'cant-run'; why: string } {
  if (s.installed.voices && s.installed.studio) return { kind: 'ready' }
  const d = s.download
  if ((d && d.state !== 'done' && READ_ALOUD_KINDS.includes(d.kind)) || s.queued.some((k) => READ_ALOUD_KINDS.includes(k))) {
    return { kind: 'downloading' }
  }
  // The card alone: the disk space is checked by the download itself.
  const card = voicesChecks({ nvidia: s.nvidia, nvidiaMemoryMb: s.nvidiaMemoryMb, nvidiaComputeCap: s.nvidiaComputeCap })[0]
  if (card && !card.ok && !s.installed.voices) return { kind: 'cant-run', why: card.text }
  return { kind: 'offer' }
}

// ---------- The first scene's guide ----------

export type GuideStep = 'card' | 'generate' | 'edit' | 'done'

export const GUIDE_STEPS: GuideStep[] = ['card', 'generate', 'edit', 'done']

/** True once the scene card says something about the scene (who, where, when or what happens). */
export function cardFilled(card: SceneCard | null): boolean {
  if (!card) return false
  const words = [card.goal, card.conflict, card.outcome, card.mood, card.when, card.notes, ...card.beats]
  return words.some((w) => w.trim() !== '') || !!card.povId || !!card.locationId || card.presentIds.length > 0
}

export interface GuideFacts {
  card: boolean
  /** Words in the scene now. */
  words: number
  /** A draft is being written into it. */
  drafting: boolean
  /** Adam has changed the words himself since the draft. */
  edited: boolean
  /** The scene is marked done. */
  done: boolean
}

/** Where the guide is: the step to show, or 'finished' once the scene is marked done. */
export function guideStep(f: GuideFacts): GuideStep | 'finished' {
  if (f.done) return 'finished'
  if (f.drafting || f.words === 0) return f.card || f.drafting ? 'generate' : 'card'
  return f.edited ? 'done' : 'edit'
}
