// A profile's "Typical clothing" once a piece of it is gone for good (the lab's bridge reviews B and C: Ash's "bandage
// round his head" stayed in his profile from Ch 3 on, though a change in the next scene said "bandage gone; wound
// closed"). The memory model gives what happened as a note and often leaves the field as it was, so when a change's note
// says a thing worn is gone for good (lost, thrown away, cut away; a bandage or a sling taken off) and the change doesn't
// set the clothing itself, the pieces of the clothing that name it go (memory/state.ts). Taken off for a while ("took
// his hat off to greet her") is not gone. Pure.

/** Things worn that a profile's clothing may name. */
const GEAR =
  'boots?|shoes?|slippers?|coat|greatcoat|cloak|oilskin|hat|cap|bonnet|hood|gloves?|mittens?|stockings?|shawl|scarf|apron|belt|sash|bandages?|sling|dressing|splint|eyepatch|jumper|shirt|jacket|waistcoat|vest|spectacles|glasses|ring|necklace|locket|bracelet|earrings?|brooch|veil|mask|pack|satchel|sword belt|spurs?'
/** Things worn to mend a hurt: taken off, they are gone, as a hat taken off is not. */
const MENDING = new Set(['bandage', 'sling', 'dressing', 'splint', 'eyepatch'])

/** Words that say it went for good, after the thing ("bandage gone", "hat lost in the river"). */
const GONE_AFTER = /^(?:gone|lost|removed|discarded|burnt|burned|ruined|destroyed|stolen|cut away|cut off|thrown away|given away|taken away|left behind)\b(?!\s+(?:grey|gray|yellow|red|dark|stiff|wet|dry|over|up|down|tight))/i
/** The same, before the thing ("lost his hat", "cut away the bandage"). */
const GONE_BEFORE = /\b(?:lost|loses|discarded|discards|removed|removes|burnt|burned|burns|threw away|throws away|gave away|gives away|cut away|cuts away|cut off|sold|pawned|no longer wears|no longer wearing|no longer has)\s*$/i
/** For a thing worn to mend a hurt only: taken off ("took the bandage off", "sling off"). */
const OFF_AFTER = /^(?:off|taken off|came off|unwound|unwrapped)\b(?!\s+(?:to|for)\b)/i
const OFF_BEFORE = /\b(?:took off|takes off|taken off|pulled off|unwound|unwinds|unwrapped|unwraps|cut|cuts)\s*$/i
/** A clause that says it didn't, or not yet: "never took his hat off", "would lose the bandage soon". */
const NOT_DONE = /\b(?:not|never|nearly|almost|would|will|might|may|could|should|wants?|tries|tried|refuses|refused)\b|n['’]t\b/i
/** Words before the thing, between it and the verb, that may stand there: "lost his good hat". */
const LEAD = /^(?:(?:the|a|an|his|her|their|its|one|both|old|good|new|best|only|grey|gray|black|white|red|blue|green|brown|wide-brimmed|bloody|stained|filthy|torn)\s+){0,3}$/i

/** The single form of a thing worn, as compared ("boots" is "boot"). */
const single = (w: string): string => w.toLowerCase().replace(/(?<!s)s$/, '')

/** The things worn a note says are gone for good, by their single form. */
export function goneForGood(note: string): string[] {
  const out = new Set<string>()
  for (const clause of note.split(/[.;!?]|,?\s+(?:and|but|then)\s+/i)) {
    if (!clause.trim() || NOT_DONE.test(clause)) continue
    for (const m of clause.matchAll(new RegExp(`\\b(${GEAR})\\b`, 'gi'))) {
      const noun = single(m[1])
      const at = m.index ?? 0
      const before = clause.slice(0, at).trimEnd()
      const after = clause.slice(at + m[0].length).replace(/^\s+/, '')
      // The verb before it, with only small words between ("lost his good hat").
      const verb = (re: RegExp): boolean => {
        const words = before.split(/\s+/)
        for (let k = 0; k <= 3 && k < words.length; k++) {
          const head = words.slice(0, words.length - k).join(' ')
          const between = words.slice(words.length - k).join(' ')
          if (re.test(head) && LEAD.test(between ? `${between} ` : '')) return true
        }
        return false
      }
      const mending = MENDING.has(noun)
      if (GONE_AFTER.test(after) || verb(GONE_BEFORE) || (mending && (OFF_AFTER.test(after) || verb(OFF_BEFORE)))) out.add(noun)
    }
  }
  return [...out]
}

/**
 * A profile's typical clothing without the pieces a change's note says are gone for good (see above), each piece being
 * what is between commas and semicolons: "coat patched at the elbows, bandage round his head" after "bandage gone; wound
 * closed" is "coat patched at the elbows". Null when nothing goes.
 */
export function clothingAfter(clothing: string, note: string): string | null {
  const gone = goneForGood(note)
  if (!gone.length || !clothing.trim()) return null
  const pieces = clothing.split(/\s*[;,]\s*/)
  const names = (piece: string): boolean => [...piece.matchAll(new RegExp(`\\b(${GEAR})\\b`, 'gi'))].some((m) => gone.includes(single(m[1])))
  const kept = pieces.filter((p) => p.trim() && !names(p))
  if (kept.length === pieces.filter((p) => p.trim()).length) return null
  const sep = clothing.includes(';') ? '; ' : ', '
  return kept.join(sep)
}
