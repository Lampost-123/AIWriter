// Reading the Recipe maker's answers: the recipe (a "Name:" line, then each part under "## <Part>") and the
// "fix" answer (parts under the same headings). Forgiving: headings may be "#", "###" or bold, with or without a
// colon, in any order; anything before the first heading other than the name is ignored. Pure.

import type { RecipePartId, RecipeParts } from '@shared/contracts/recipes'
import { PART_HEADINGS } from './prompts'

const HEADING_TO_PART = new Map<string, RecipePartId>([
  ...(Object.entries(PART_HEADINGS) as [RecipePartId, string][]).map(([k, v]) => [v.toLowerCase(), k] as [string, RecipePartId]),
  ['theme', 'themes'],
  ['style', 'style'],
  ['prose style', 'style'],
  ['pov', 'pov'],
  ['narrative point of view', 'pov'],
  ['sample', 'sample'],
  ['structure', 'shape'],
  ['cast', 'cast'],
  ['roles', 'cast'],
  ['story beats', 'beats'],
  ['devices and motifs', 'devices'],
  ['genre', 'feel'],
  ['genres', 'feel'],
  ['genre and content levels', 'feel']
])

/** "## Writing style", "**Writing style:**", "### Themes" → its part; null for any other line. */
function headingPart(line: string): RecipePartId | null {
  const m = /^\s*(?:#{1,4}\s*|\*\*)([^#*:]+?)(?:\*\*)?\s*:?\s*(?:\*\*)?\s*$/.exec(line)
  if (!m) return null
  if (!/^\s*#/.test(line) && !/^\s*\*\*/.test(line)) return null
  return HEADING_TO_PART.get(m[1].trim().toLowerCase()) ?? null
}

const tidy = (s: string): string =>
  s
    .replace(/^```[a-z]*\s*$/gim, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export interface ParsedRecipe {
  name: string
  parts: Partial<RecipeParts>
}

export function parseRecipe(text: string): ParsedRecipe {
  let name = ''
  const parts: Partial<Record<RecipePartId, string[]>> = {}
  let current: RecipePartId | null = null
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const part = headingPart(line)
    if (part) {
      current = part
      parts[part] ??= []
      continue
    }
    if (!current) {
      const n = /^\s*(?:\*\*)?name(?:\*\*)?\s*:\s*(.+)$/i.exec(line)
      if (n && !name) name = n[1].replace(/\*\*/g, '').trim().replace(/^["“]|["”]$/g, '').trim()
      continue
    }
    parts[current]!.push(line)
  }
  const out: Partial<RecipeParts> = {}
  for (const [k, lines] of Object.entries(parts) as [RecipePartId, string[]][]) {
    const t = tidy(lines.join('\n'))
    if (t) out[k] = t
  }
  return { name: name.slice(0, 120), parts: out }
}

/** The parts every recipe has, empty when the answer left one out. */
export const emptyParts = (): RecipeParts => ({
  themes: '',
  tone: '',
  pov: '',
  tense: '',
  style: '',
  sample: '',
  shape: '',
  beats: '',
  cast: '',
  pacing: '',
  devices: '',
  feel: ''
})
