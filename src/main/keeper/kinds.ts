// Is a new "character" really a thing? (Adam, 2026-10-07)
// A memory model sometimes files an object someone wants, carries or gives (a blue glass bead promised to a child)
// as a character, and the character's page then gets eyes, fears and lines of dialogue for it. A new entry the
// keeper is about to make as a character is made as an item instead when it is described like an object (its name
// or summary says what kind of thing it is, or it is "it") and nothing shows it acting: no line in the scene has it
// speak, think or feel, and the memory model's own reply gives it no words, no knowledge and no feelings.
// Only ever asked about an entry the keeper is making from the text: entries already in the world (Adam's above
// all) are never changed here. Pure.

import { plain } from './text'

/** Words for things, as the head of a name ("Pell's blue bead") or of a summary ("A glass bead sold at…"). */
const THINGS = new Set(
  `bead ring necklace locket pendant brooch amulet talisman charm bracelet earring crown coronet tiara diadem coin purse wallet
  key box chest casket case trunk bag satchel sack pouch basket letter map chart book journal diary ledger scroll deed contract
  document survey seal signet sword blade knife dagger axe bow arrow spear staff wand sceptre scepter hammer pistol gun rifle musket
  shield helmet armour armor compass lantern lamp candle torch cup goblet chalice bottle flask vial jar kettle bowl cloak coat hat
  cap boot shoe glove scarf ribbon shawl veil mask gem jewel shell feather bell whistle flute harp fiddle drum clock watch mirror
  painting portrait statue figurine doll toy button needle thimble comb quill pen inkwell ticket token badge medal banner flag rope
  chain cart wagon carriage boat raft sled blanket quilt rug tapestry chair stool desk cradle coffin urn vase idol relic artefact
  artifact heirloom keepsake trinket bauble gift parcel package envelope photograph photo picture telescope spyglass lens
  spectacles saddle bridle harness whip tinderbox pipe potion elixir poison salve`.split(/\s+/)
)

/** Words for people and animals: an entry named or summed up by one of these is someone, whatever else it says. */
const BEINGS = new Set(
  `man men woman women boy girl child children baby lad lass gentleman lady lord king queen prince princess duke duchess knight soldier guard priest
  monk nun witch wizard mage sorcerer merchant trader pedlar peddler farmer smith clerk servant maid mother father son daughter
  brother sister wife husband uncle aunt cousin grandmother grandfather widow stranger friend captain sailor ferryman innkeeper
  keeper master mistress apprentice warden magistrate judge thief beggar hunter witness person figure someone people folk
  creature beast monster dragon spirit ghost horse gelding mare stallion pony foal colt filly donkey mule ox cow bull calf dog
  hound puppy pup cat kitten wolf fox bird crow raven owl hawk falcon eagle rat mouse goat sheep ram ewe lamb pig boar bear deer
  stag hare rabbit snake serpent toad frog`.split(/\s+/)
)

/** Small words that end the phrase naming what something is ("a bead sold by a man": "sold" ends it at "by"). */
const STOPS = new Set(
  'of with who whom whose which that from by for in on at to and or but as into onto under over than when where while once sold bought given kept made found worn carried promised wanted'.split(
    ' '
  )
)

/** Words that say a thing is alive or speaks ("a talking sword"). */
const ALIVE = /\b(talking|talks|speaks|speaking|sentient|alive|living|thinks|thinking|voice|soul)\b/i

/** Speaking, thinking and feeling: what someone does, and a thing never does. */
const ACTS =
  'said|says|asked|asks|replied|replies|answered|answers|whispered|whispers|shouted|shouts|cried|cries|told|tells|laughed|laughs|smiled|smiles|grinned|grins|nodded|nods|frowned|frowns|sighed|sighs|thought|thinks|wondered|wonders|knew|knows|wanted|wants|decided|decides|spoke|speaks|muttered|mutters|murmured|murmurs|growled|growls|snapped|sang|sings|yelled|yells|screamed|screams|wept|weeps|walked|walks|slept|sleeps|hoped|hopes|promised|promises|agreed|agrees|refused|refuses|begged|begs'

/** The singular of a word ("beads" to "bead", "boxes" to "box"), as far as these lists need it. */
function single(w: string): string {
  if (w.length > 4 && w.endsWith('es') && /(?:x|ch|sh|ss)es$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

const tokens = (s: string): string[] => s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*|[,;:.()—–]/gu) ?? []
const possessive = (t: string): boolean => /['’]s$/i.test(t) || /s['’]$/i.test(t)

/** What a word says the entry is: a thing, a being, or neither. */
function sort(word: string): 'thing' | 'being' | null {
  const w = single(word.toLowerCase())
  if (BEINGS.has(w) || BEINGS.has(word.toLowerCase())) return 'being'
  if (THINGS.has(w) || THINGS.has(word.toLowerCase())) return 'thing'
  return null
}

/**
 * What the phrase at the start of a text says the entry is, by the last word of that phrase this knows: "A glass bead
 * sold by a man" is a thing (bead), "Wren's grandmother's brass pocket compass" a thing, "A boy with Ash's drove" a
 * being, "A key witness" a being. The phrase ends at a small word ("of", "with", "by"…), a comma or after six words.
 */
export function phraseSays(text: string): 'thing' | 'being' | null {
  let found: 'thing' | 'being' | null = null
  let n = 0
  for (const t of tokens(text.trim())) {
    if (/^[,;:.()—–]$/.test(t)) break
    const w = t.toLowerCase()
    if (n === 0 && /^(a|an|the|one|some|this|that)$/.test(w)) continue
    if (STOPS.has(w)) break
    if (possessive(t)) continue // the owner: "Pell's" in "Pell's blue bead"
    found = sort(w) ?? found
    if (++n >= 6) break
  }
  return found
}

/**
 * What a name says the entry is, by its last word ("Pell's blue bead": bead), before any "of" ("the Sword of Kings":
 * sword). A last word with a capital is taken as a name ("Mother Agate", "Cinder") unless the name begins with "the".
 */
export function nameSays(name: string): 'thing' | 'being' | null {
  const head = name.split(/\s+of\s+/i)[0]
  const words = tokens(head).filter((t) => !/^[,;:.()—–]$/.test(t))
  const last = words[words.length - 1]
  if (!last || possessive(last)) return null
  const named = /^\p{Lu}/u.test(last) && !/^(the|a|an)$/i.test(words[0] ?? '')
  if (named) return null
  return sort(last)
}

export interface NewEntry {
  name: string
  aliases: string[]
  summary: string
  /** The fields the reply gave it (pronouns among them, perhaps). */
  fields: Record<string, string>
  /** The short id the reply gave it ("N1"), so its other items can be found. */
  ref: string
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const said = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * True when the memory model's reply has the new entry speak, know, or feel something about someone: what only a
 * someone does. `add` is the reply's list of new facts.
 */
export function replyShowsActing(e: Pick<NewEntry, 'name' | 'ref'>, add: unknown[]): boolean {
  const me = new Set([e.ref.toUpperCase(), plain(e.name)].filter(Boolean))
  const is = (v: unknown): boolean => {
    const s = said(v)
    return !!s && (me.has(s.toUpperCase()) || me.has(plain(s)))
  }
  for (const a of add) {
    if (!isObj(a)) continue
    const type = said(a.type).toLowerCase()
    if ((type === 'said' || type === 'voice' || type === 'knows') && is(a.entry)) return true
    if (type === 'relationship' && ((is(a.entry) && said(a.feels)) || (is(a.other) && said(a.otherFeels)))) return true
  }
  return false
}

/** True when a paragraph has one of these names speak, think or feel ("the bead said", "said the bead"). */
export function textShowsActing(names: string[], paragraphs: string[]): boolean {
  const ns = names.map((n) => plain(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter((n) => n.length > 1)
  if (!ns.length) return false
  const who = `(?:${ns.join('|')})`
  const after = new RegExp(`(?:^|[^\\p{L}\\p{N}])${who},? (?:\\p{L}+ly )?(?:${ACTS})\\b`, 'u')
  const before = new RegExp(`\\b(?:said|asked|replied|answered|whispered|shouted|cried|called) ${who}(?=[^\\p{L}\\p{N}]|$)`, 'u')
  return paragraphs.some((p) => {
    const t = plain(p)
    return after.test(t) || before.test(t)
  })
}

/**
 * True when a new entry the memory model calls a character is a thing: described like an object, by its name, its
 * summary or "it" for pronouns, with nothing saying it is a person or an animal, and nothing in the scene or the reply
 * showing it acting. `paragraphs`: the scene's words; `add`: the reply's new facts.
 */
export function thingNotCharacter(e: NewEntry, paragraphs: string[], add: unknown[]): boolean {
  const pronouns = plain(e.fields.pronouns ?? '')
  if (/\b(he|him|his|she|her|hers|they|them|their|xe|ze)\b/.test(pronouns)) return false
  const signs = [nameSays(e.name), ...e.aliases.map(nameSays), phraseSays(e.summary)]
  if (signs.includes('being') || ALIVE.test(e.summary)) return false
  const thing = signs.includes('thing') || /^it\b/.test(pronouns)
  if (!thing) return false
  return !replyShowsActing(e, add) && !textShowsActing([e.name, ...e.aliases], paragraphs)
}
