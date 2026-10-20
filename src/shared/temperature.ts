// Writing temperature (Settings › Models; Adam, 2026-10-20): Auto, or Adam's own temperature for every request that
// writes the story's words. Shared by the main process (what is sent) and the interface (the slider and its hints).
//
// The rule, kept simple: a custom temperature takes the place of the creativity's temperature; the creativity (the
// default, or a draft's own) still sets top_p and min_p, as before. Each provider gets it within the range it takes
// (Claude: 0 to 1), and a model that sets its own creativity is sent none at all (ai/client.ts), as before.
import type { ThinkingLevel } from './types'
import { isAnthropicApi } from './urls'

export const WRITING_TEMPERATURE_MIN = 0
export const WRITING_TEMPERATURE_MAX = 2
export const WRITING_TEMPERATURE_STEP = 0.05
/** What DeepSeek suggests for creative writing, and where the slider starts when Adam first turns Custom on. */
export const DEEPSEEK_STORY_TEMPERATURE = 1.5

const round = (n: number): number => Math.round(n / WRITING_TEMPERATURE_STEP) * WRITING_TEMPERATURE_STEP

/** A stored Writing temperature made safe: null (Auto) unless it is a number, then 0 to 2 in steps of 0.05. */
export function cleanWritingTemperature(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const n = Math.min(WRITING_TEMPERATURE_MAX, Math.max(WRITING_TEMPERATURE_MIN, round(v)))
  return Number(n.toFixed(2))
}

/** True for a DeepSeek model: DeepSeek's own API, or a DeepSeek model through OpenRouter or another service. */
export function isDeepSeek(baseUrl: string | null | undefined, modelId: string | null | undefined): boolean {
  return (!!baseUrl && /^https?:\/\/api\.deepseek\.com(\/|$)/i.test(baseUrl.trim())) || /deepseek/i.test(modelId ?? '')
}

/** True for a Claude model (Anthropic's own API, or a Claude model elsewhere): Claude takes a temperature of 0 to 1. */
export function isClaude(baseUrl: string | null | undefined, modelId: string | null | undefined): boolean {
  return isAnthropicApi(baseUrl) || /anthropic|claude/i.test(modelId ?? '')
}

/** The highest temperature this model takes: 1 for Claude, 2 for the rest (OpenAI's range, which DeepSeek and most others use). */
export function temperatureCeiling(baseUrl: string | null | undefined, modelId: string | null | undefined): number {
  return isClaude(baseUrl, modelId) ? 1 : WRITING_TEMPERATURE_MAX
}

/**
 * The temperature a writing request is sent at: Adam's own Writing temperature, within what the model takes, or (Auto)
 * the creativity's temperature as before.
 */
export function writingTemperatureFor(auto: number, custom: unknown, target: { baseUrl: string }, modelId: string): { temperature: number; own: boolean } {
  const own = cleanWritingTemperature(custom)
  if (own == null) return { temperature: auto, own: false }
  return { temperature: Math.min(own, temperatureCeiling(target.baseUrl, modelId)), own: true }
}

/**
 * Why the writer model won't use a temperature, in plain words; null when it will. `sampling` false: the provider says the
 * model sets its own. A DeepSeek model that is thinking (its reasoner, or the writer's Thinking asked for) ignores it.
 */
export function temperatureIgnored(
  model: { baseUrl: string | null | undefined; modelId: string; sampling?: boolean | null },
  thinking: ThinkingLevel | undefined
): string | null {
  if (model.sampling === false) return 'This model sets its own temperature, so this setting won’t change its writing. Choose another writer model to use it.'
  if (isDeepSeek(model.baseUrl, model.modelId)) {
    if (/reasoner|(^|[/-])r1([-:]|$)/i.test(model.modelId))
      return 'This DeepSeek model always thinks before it writes, and DeepSeek ignores the temperature while it thinks. Choose a DeepSeek chat model to use it.'
    if (thinking === 'low' || thinking === 'medium' || thinking === 'high')
      return 'DeepSeek ignores the temperature while it thinks. Set the writer’s Thinking to Off above for this to take effect.'
  }
  return null
}
