// Where the trap run's models come from: DeepSeek's own API (the default, as Adam would connect it in Settings ›
// Models with the app's DeepSeek preset) or OpenRouter. Pure, so the choice can be tested.

export type TrapProvider = 'deepseek' | 'openrouter'

/** The app's DeepSeek preset (features/settings/ModelsSettings.tsx PRESETS): a custom, OpenAI-compatible provider. */
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'

/** The environment variable each provider's key is read from (and nowhere else). */
export const KEY_VARIABLE: Record<TrapProvider, string> = { deepseek: 'DEEPSEEK_API_KEY', openrouter: 'OPENROUTER_API_KEY' }

/**
 * DeepSeek Flash from a provider's model list: ids with "flash" in them (on OpenRouter, DeepSeek's own), never a
 * variant (an id with ':', like ':free'), newest first by name. Null when there is none.
 */
export function pickFlash(ids: string[], provider: TrapProvider): string | null {
  const found = ids
    .filter((id) => /flash/i.test(id) && !id.includes(':') && (provider !== 'openrouter' || /^deepseek\//i.test(id)))
    .sort()
    .reverse()
  return found[0] ?? null
}
