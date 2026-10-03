// What variants cost, in words that read right for free models and tiny amounts too ("About Free for all
// three" and "about <$0.001" don't).
import { formatCost } from '@/features/generate/format'

/**
 * A cost inside a line: "Free", "under $0.001", "$0.04", or "about $0.04" when it's AI Write's own
 * estimate (the provider didn't say what it charged).
 */
export function costWords(usd: number, estimated = false): string {
  if (usd === 0) return 'Free'
  if (usd > 0 && usd < 0.001) return 'under $0.001'
  return `${estimated ? 'about ' : ''}${formatCost(usd)}`
}

/** The same, starting a line or standing on its own: "Free", "Under $0.001", "About $0.04". */
export function costLabel(usd: number, estimated = false): string {
  const words = costWords(usd, estimated)
  return words.charAt(0).toUpperCase() + words.slice(1)
}
