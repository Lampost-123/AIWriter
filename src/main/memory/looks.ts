// A profile's "Typical clothing" once a piece of it is gone for good (the lab's bridge reviews B and C: Ash's "bandage
// round his head" stayed in his profile from Ch 3 on, though a change in the next scene said "bandage gone; wound
// closed"). The memory model gives what happened as a note and often leaves the field as it was, so when a change's note
// says a thing worn is gone for good (lost, thrown away, cut away; a bandage or a sling taken off) and the change doesn't
// set the clothing itself, the pieces of the clothing that name it go (memory/state.ts). Taken off for a while ("took
// his hat off to greet her") is not gone. Pure.

// ---------- Clothes off for a while are not what someone typically wears ----------
// A live test on 2026-10-16 (DeepSeek Flash): after an undressing scene the memory model set both lovers' "Typical
// clothing" to "none" and "nothing", and every later scene was told "Mara Venn, typical clothing: nothing" as something
// that must stay true. Clothes taken off for a while (to wash, to sleep, to make love) are where things stand
// (continuity/tracker.ts keeps each piece), never who someone is. So a Typical clothing value that says only that nothing
// is worn, or only what came off, is never taken from the text (keeper/apply.ts) nor counted when the memory is read
// (memory/state.ts), and the profile keeps what it said; nor is any Looks value that says only that someone is naked.

/** Nothing worn, said first: "none", "nothing at all", "naked except for her stockings", "nothing (undressed)". */
const UNDRESSED =
  /^(?:wearing nothing|nothing|none|naked|nude|in the nude|undressed|unclothed|stripped|bare|no clothes|(?:half|partly|partially)[- ](?:dressed|undressed|naked))(?:\s+(?:at all|on))?(?=\s*(?:$|[,;.:!(—–-])|\s+(?:but|except|save|apart|other than|besides|now)\b)/i
/** Naked, said first, for a Looks field other than clothing ("naked and flushed" is no build or skin). */
const NAKED = /^(?:naked|nude|undressed|unclothed)\b/i
/** Pieces of a value that each say only that something came off: "dress off", "boots removed", "barefoot". */
const OFF_PIECE = /(?<![\p{L}-])(?:off|removed|shed|discarded)(?![\p{L}-])|^(?:bare ?foot(?:ed)?|bare[- ]feet)$/iu
const KEPT_ON = /\b(?:not|never|without)\b|n['’]t\b/i

// ---------- Clothes as worn for a moment are not what someone typically wears ----------
// The same live test's long run (2026-10-16): on a cold train Nell's "Typical clothing" became "grey wool dress, laced
// boots, coat buttoned to the chin, the red wool scarf up round her jaw, …" and stayed so. A piece told as it is worn
// just then (buttoned to the chin, pulled up round her jaw, soaked, muddy, against the cold) is where things stand. So
// such pieces are left out of a Typical clothing value from the text (usualLook), unless the piece says it is usual
// ("always buttoned to the chin"); a value with nothing else left is never taken at all.

/** A piece told as worn for the moment: done up or undone, pulled up or round, wet or muddy, for the cold or the road. */
const MOMENT_PIECE =
  /\b(?:buttoned|unbuttoned|done up|undone|unlaced|half-laced|pulled|tugged|hitched|tucked|rolled up|turned up|wrapped|bundled|loosened|open at|up (?:round|around|over|to)|round (?:her|his|their) (?:jaw|chin|ears|face|mouth|nose)|to the (?:chin|throat|neck)|wet|soaked|sodden|damp|dripping|steaming|muddy|mud-|caked|splashed|dusty|snow-|rain-|torn|ripped|for the (?:cold|journey|train|road|weather|wedding|night)|against the (?:cold|wind|rain|frost|weather)|borrowed|lent)/i
/** Words that make such a piece what they always do: "always buttoned to the chin". */
const USUAL = /\b(?:always|usually|habitually|ever|every day|never without|as a rule)\b/i

/** The Looks fields (shared/fields.ts) a passing undress may reach. */
const LOOKS = new Set(['build', 'face', 'hair', 'eyes', 'skin', 'marks', 'clothing', 'movement'])

/**
 * True when a value for one of a character's Looks fields only says they are undressed for now (see above): for Typical
 * clothing, nothing worn ("none", "nothing", "naked but for her locket") or only what came off ("dress off, stockings
 * off"); for the other Looks fields, naked. Never for a value that says what they do wear.
 */
export function passingLook(field: string, value: string | null | undefined): boolean {
  const v = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!v || !LOOKS.has(field)) return false
  if (field !== 'clothing') return NAKED.test(v)
  if (UNDRESSED.test(v)) return true
  const pieces = v.split(/\s*[,;]\s*/).filter(Boolean)
  return pieces.length > 0 && pieces.every((p) => (OFF_PIECE.test(p) && !KEPT_ON.test(p)) || momentPiece(p))
}

const momentPiece = (piece: string): boolean => MOMENT_PIECE.test(piece) && !USUAL.test(piece)

/**
 * A Looks value from the text as kept for who someone is: Typical clothing without the pieces worn just for the moment
 * ("coat buttoned to the chin", "the red wool scarf up round her jaw"); '' when nothing is left, or when the value only
 * says they are undressed for now (passingLook). Other values as they are.
 */
export function usualLook(field: string, value: string | null | undefined): string {
  const v = (value ?? '').replace(/\s+/g, ' ').trim()
  if (passingLook(field, v)) return ''
  if (field !== 'clothing') return v
  const pieces = v.split(/\s*[,;]\s*/).filter(Boolean)
  const kept = pieces.filter((p) => !momentPiece(p))
  return kept.length === pieces.length ? v : kept.join(v.includes(';') ? '; ' : ', ')
}

/** A character's fields from the text without the Looks values a passing undress gave (passingLook). */
export function withoutPassingLooks(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(fields).filter(([k, v]) => !passingLook(k, v)))
}

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
