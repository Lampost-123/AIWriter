// The writer's own tags (ai/speakerTags.ts) put on a draft's paragraphs as read aloud keeps its marks: who says each
// line and how, and how the narrator reads it. The narrator's mood carries on from the writer's last tilde tag until
// its next one (dialogue tags such as "he said" included), so a paragraph the writer tagged in full needs no AI call.
// Pure, so it is tested on its own.
import type { WriterSpeaker } from '../ai/speakerTags'
import { memberNamed, type CastMember } from './cast'
import { spansIn, withLabels, type Para } from './speakers'
import type { LineDelivery, ParagraphMarks } from './types'

/** A tag's note as a mark: its tone, pace and sound, or nothing when it gave none. */
export function deliveryOf(g: Pick<WriterSpeaker, 'tone' | 'pace' | 'sound'>): LineDelivery | undefined {
  const how: LineDelivery = { ...(g.tone ? { tone: g.tone } : {}), ...(g.pace ? { pace: g.pace } : {}), ...(g.sound ? { sound: g.sound } : {}) }
  return Object.keys(how).length ? how : undefined
}

/** A mood that carries on: its tone and pace, not a sound (that happens once). */
const carried = (how: LineDelivery): LineDelivery => ({ ...(how.tone ? { tone: how.tone } : {}), ...(how.pace ? { pace: how.pace } : {}) })

/**
 * The writer's tags on the paragraphs in `only` (all when left out), in order, each tag used once, where nothing is
 * kept yet. With `tone` (Mark who says what), a paragraph's narration the writer left untagged takes the mood of its
 * last tilde tag before it. Returns the paragraphs with new marks, and the tags no paragraph took.
 */
export function writerBlocks(o: {
  paragraphs: readonly { pid: string; text: string }[]
  given: readonly WriterSpeaker[]
  cast: CastMember[]
  kept: ReadonlyMap<string, ParagraphMarks>
  tone: boolean
  only?: ReadonlySet<string>
}): { blocks: Para[]; left: WriterSpeaker[] } {
  const left = [...o.given]
  const take = (key: string): WriterSpeaker | undefined => {
    const i = left.findIndex((g) => g.key === key)
    return i < 0 ? undefined : left.splice(i, 1)[0]
  }
  const blocks: Para[] = []
  let mood: LineDelivery | undefined
  for (const p of o.paragraphs) {
    if (o.only && !o.only.has(p.pid)) continue
    const had = o.kept.get(p.pid)
    const speakers: Record<string, string> = {}
    const delivery: Record<string, LineDelivery> = {}
    const spans = spansIn(p.text)
    for (const q of spans) {
      if (!q.quote) {
        const how = had?.delivery?.[q.key] === undefined ? take(q.key) : undefined
        const note = how && deliveryOf(how)
        if (note) {
          delivery[q.key] = note
          mood = carried(note)
        }
        continue
      }
      if (had?.speakers?.[q.key] !== undefined) continue
      const g = take(q.key)
      if (!g) continue
      speakers[q.key] = memberNamed(o.cast, g.who)?.name ?? g.who
      // A line the writer gave no note on how it is said has none kept, so Mark who says what (now or later) notes it.
      const note = deliveryOf(g)
      if (note) delivery[q.key] = note
    }
    const narration = spans.filter((x) => !x.quote)
    const told = narration.some((x) => delivery[x.key] !== undefined || had?.delivery?.[x.key] !== undefined)
    if (o.tone && mood && narration.length && !told) delivery[narration[0].key] = { ...mood }
    if (!Object.keys(speakers).length && !Object.keys(delivery).length) continue
    const block = withLabels({ id: p.pid, text: p.text, ...had }, speakers)
    blocks.push({ ...block, delivery: { ...delivery, ...(had?.delivery ?? {}) } })
  }
  return { blocks, left }
}
