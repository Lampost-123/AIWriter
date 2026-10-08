// The desk's drawing library (UI overhaul, D5.4): about forty small drawings (src/renderer/src/components/art/
// motifShapes.ts draws them), one picked for each entry in the world and for each story's book cover. The pick is free,
// offline and instant: the words of an entry's name, one-liner, description and a few telling fields are matched against
// each drawing's words, and the best match wins (ties to the drawing that suits the entry's kind). With no match at all,
// each kind has a few drawings of its own and the entry's name chooses among them, so it is always the same one. Adam's
// own pick is kept in the world (src/shared/contracts/art.ts) and always wins; his own portrait wins over both.
// Pure, so it is unit-tested (motifs.test.ts).
import type { EntryKind } from './types'

export interface MotifDef {
  id: string
  /** What it shows, in plain words: "A lantern". */
  label: string
  /** The kinds it suits best (a tie goes to these). */
  kinds: EntryKind[]
  /** Words that call for it, lower case. A word also matches its plural ("keys"), and "keeper’s" reads as "keeper". */
  words: string[]
}

export const MOTIFS: MotifDef[] = [
  { id: 'lantern', label: 'A lantern', kinds: ['character', 'item'], words: ['lantern', 'lamp', 'lamplighter', 'keeper', 'wick', 'oil', 'lights', 'glow', 'torch', 'watchman'] },
  { id: 'letter', label: 'A sealed letter', kinds: ['character', 'item', 'thread'], words: ['letter', 'sealed', 'seal', 'clerk', 'message', 'messenger', 'envelope', 'courier', 'post', 'note', 'scribe', 'secretary', 'correspondence', 'writ'] },
  { id: 'ship', label: 'A sailing ship', kinds: ['place', 'item', 'group', 'event'], words: ['ship', 'ferry', 'sail', 'sailor', 'captain', 'fleet', 'vessel', 'navy', 'voyage', 'crew', 'pirate', 'admiral', 'galleon'] },
  { id: 'boat', label: 'A small boat', kinds: ['item', 'place', 'character'], words: ['boat', 'rowboat', 'fishing', 'fisherman', 'fishermen', 'fisher', 'oar', 'oars', 'rower', 'skiff', 'dinghy', 'boatman'] },
  { id: 'anchor', label: 'An anchor', kinds: ['place', 'group'], words: ['anchor', 'harbour', 'harbor', 'port', 'quay', 'dock', 'docks', 'wharf', 'mooring', 'harbourmaster', 'harbormaster', 'pier', 'marina'] },
  { id: 'key', label: 'An old key', kinds: ['item', 'character', 'lore'], words: ['key', 'lock', 'locked', 'door', 'secret', 'jailer', 'gaoler', 'warden', 'vault', 'unlock'] },
  { id: 'sword', label: 'A sword', kinds: ['character', 'item', 'event'], words: ['sword', 'blade', 'knight', 'soldier', 'warrior', 'fighter', 'duel', 'battle', 'war', 'mercenary', 'guard', 'swordsman', 'army'] },
  { id: 'shield', label: 'A shield', kinds: ['group', 'character', 'item'], words: ['shield', 'guard', 'guards', 'order', 'protector', 'defender', 'watch', 'garrison', 'militia', 'legion', 'oath'] },
  { id: 'crown', label: 'A crown', kinds: ['character', 'group', 'item'], words: ['crown', 'king', 'queen', 'prince', 'princess', 'royal', 'throne', 'monarch', 'heir', 'emperor', 'empress', 'court', 'lord', 'lady', 'duke', 'duchess', 'noble'] },
  { id: 'ring', label: 'A ring', kinds: ['item', 'character'], words: ['ring', 'wedding', 'betrothed', 'engaged', 'jewel', 'jeweller', 'gem', 'bride', 'groom', 'husband', 'wife', 'marriage', 'signet'] },
  { id: 'cup', label: 'A chalice', kinds: ['item', 'place', 'lore'], words: ['cup', 'chalice', 'goblet', 'wine', 'tavern', 'inn', 'innkeeper', 'brew', 'ale', 'feast', 'grail', 'priest', 'priestess'] },
  { id: 'coin', label: 'Coins', kinds: ['item', 'character', 'group'], words: ['coin', 'gold', 'money', 'merchant', 'trader', 'trade', 'wages', 'pay', 'pays', 'paid', 'debt', 'tax', 'bank', 'banker', 'thief', 'treasure', 'market', 'wealth', 'rich'] },
  { id: 'tower', label: 'A stone tower', kinds: ['place'], words: ['tower', 'keep', 'turret', 'spire', 'prison', 'fort', 'fortress', 'watchtower', 'citadel', 'wizard'] },
  { id: 'castle', label: 'A castle', kinds: ['place', 'group'], words: ['castle', 'palace', 'stronghold', 'kingdom', 'realm', 'manor', 'hall', 'estate', 'city', 'capital'] },
  { id: 'lighthouse', label: 'A lighthouse', kinds: ['place'], words: ['lighthouse', 'beacon', 'headland', 'lightkeeper', 'foghorn', 'promontory'] },
  { id: 'house', label: 'A cottage', kinds: ['place'], words: ['house', 'cottage', 'home', 'town', 'village', 'roof', 'hamlet', 'farm', 'farmhouse', 'street', 'lane', 'kitchen', 'hearth', 'family'] },
  { id: 'bridge', label: 'A stone bridge', kinds: ['place', 'event'], words: ['bridge', 'river', 'crossing', 'ford', 'arch', 'canal', 'span'] },
  { id: 'gate', label: 'An arched gate', kinds: ['place', 'lore'], words: ['gate', 'gateway', 'doorway', 'portal', 'entrance', 'threshold', 'wall', 'walls', 'border', 'passage'] },
  { id: 'stairs', label: 'Stone steps', kinds: ['place'], words: ['steps', 'step', 'stair', 'stairs', 'staircase', 'causeway', 'stairway', 'climb', 'terrace'] },
  { id: 'tree', label: 'A broad tree', kinds: ['place', 'lore', 'character'], words: ['tree', 'oak', 'orchard', 'garden', 'gardener', 'grove', 'yew', 'elm', 'ash', 'roots', 'herbalist', 'druid'] },
  { id: 'forest', label: 'Three pines', kinds: ['place'], words: ['forest', 'wood', 'woods', 'pine', 'pines', 'woodland', 'hunter', 'huntress', 'ranger', 'wilderness', 'wild'] },
  { id: 'mountain', label: 'Mountains', kinds: ['place'], words: ['mountain', 'peak', 'peaks', 'range', 'hill', 'hills', 'cliff', 'cliffs', 'pass', 'summit', 'highlands', 'snow', 'valley'] },
  { id: 'wave', label: 'A wave', kinds: ['place', 'event', 'lore'], words: ['sea', 'wave', 'waves', 'ocean', 'tide', 'storm', 'flood', 'shore', 'coast', 'drowned', 'water', 'gale', 'surf', 'bay'] },
  { id: 'moon', label: 'A crescent moon', kinds: ['lore', 'event', 'character'], words: ['moon', 'night', 'dark', 'darkness', 'dusk', 'midnight', 'dream', 'dreams', 'sleep', 'shadow', 'witch', 'midwinter', 'winter'] },
  { id: 'sun', label: 'The sun', kinds: ['lore', 'event', 'place'], words: ['sun', 'summer', 'dawn', 'day', 'morning', 'desert', 'heat', 'harvest', 'bright', 'solstice'] },
  { id: 'star', label: 'A star', kinds: ['lore', 'character', 'event'], words: ['star', 'stars', 'astronomer', 'navigator', 'fate', 'destiny', 'prophecy', 'omen', 'hope', 'wish', 'heaven'] },
  { id: 'flame', label: 'A flame', kinds: ['lore', 'event', 'character'], words: ['fire', 'flame', 'flames', 'burn', 'burns', 'burning', 'burned', 'blaze', 'ember', 'embers', 'smith', 'blacksmith', 'forge', 'dragon', 'rebel', 'rebellion'] },
  { id: 'candle', label: 'A candle', kinds: ['item', 'lore', 'character'], words: ['candle', 'vigil', 'chapel', 'prayer', 'monk', 'nun', 'temple', 'shrine', 'mourning', 'funeral', 'wax'] },
  { id: 'bell', label: 'A bell', kinds: ['item', 'place', 'event'], words: ['bell', 'bells', 'buoy', 'chime', 'church', 'alarm', 'toll', 'warning', 'ringing'] },
  { id: 'book', label: 'A bound book', kinds: ['item', 'lore', 'character', 'glossary'], words: ['book', 'books', 'library', 'librarian', 'scholar', 'study', 'student', 'teacher', 'school', 'history', 'historian', 'ledger', 'record', 'records', 'archive', 'tome'] },
  { id: 'quill', label: 'A quill and ink', kinds: ['character', 'item', 'glossary'], words: ['quill', 'ink', 'writer', 'poet', 'author', 'pen', 'diary', 'journal', 'write', 'writes', 'notary', 'copyist'] },
  { id: 'scroll', label: 'A scroll', kinds: ['lore', 'item', 'group'], words: ['scroll', 'charter', 'law', 'laws', 'decree', 'contract', 'treaty', 'rule', 'rules', 'custom', 'edict', 'deed', 'will', 'legend', 'myth', 'board', 'council'] },
  { id: 'map', label: 'A map', kinds: ['item', 'place', 'thread'], words: ['map', 'maps', 'route', 'journey', 'travel', 'traveller', 'traveler', 'explorer', 'surveyor', 'quest', 'search', 'lost', 'missing'] },
  { id: 'compass', label: 'A compass', kinds: ['item', 'character', 'thread'], words: ['compass', 'north', 'direction', 'wayfinder', 'pilot', 'guide', 'scout', 'expedition', 'east', 'west', 'south'] },
  { id: 'hourglass', label: 'An hourglass', kinds: ['item', 'event', 'thread', 'lore'], words: ['hourglass', 'time', 'clock', 'hour', 'hours', 'deadline', 'weeks', 'days', 'years', 'age', 'old', 'elder', 'countdown', 'until', 'before'] },
  { id: 'eye', label: 'An eye', kinds: ['character', 'lore', 'group'], words: ['eye', 'eyes', 'spy', 'watcher', 'seer', 'oracle', 'witness', 'detective', 'inspector', 'sees', 'vision', 'blind', 'sight'] },
  { id: 'mask', label: 'A mask', kinds: ['character', 'group', 'event'], words: ['mask', 'masked', 'actor', 'actress', 'player', 'theatre', 'theater', 'disguise', 'liar', 'lies', 'false', 'stranger', 'imposter', 'masquerade', 'performer'] },
  { id: 'rose', label: 'A rose', kinds: ['character', 'item', 'lore'], words: ['rose', 'roses', 'flower', 'flowers', 'love', 'lover', 'beloved', 'romance', 'heart', 'beauty', 'daughter', 'sister', 'garden'] },
  { id: 'bird', label: 'A gull', kinds: ['place', 'character', 'lore'], words: ['gull', 'gulls', 'bird', 'birds', 'wing', 'wings', 'flight', 'fly', 'free', 'freedom', 'sky', 'feather', 'feathers'] },
  { id: 'raven', label: 'A raven', kinds: ['character', 'lore', 'group'], words: ['raven', 'ravens', 'crow', 'crows', 'death', 'dead', 'ghost', 'grave', 'graves', 'omen', 'curse', 'cursed', 'necromancer', 'killer', 'murder'] },
  { id: 'wolf', label: 'A wolf', kinds: ['character', 'group', 'lore'], words: ['wolf', 'wolves', 'hound', 'dog', 'pack', 'beast', 'hunt', 'feral', 'werewolf', 'loyal'] },
  { id: 'horse', label: 'A horse', kinds: ['character', 'item', 'group'], words: ['horse', 'horses', 'rider', 'riders', 'cavalry', 'stable', 'groom', 'mare', 'stallion', 'knight', 'carriage', 'coach'] }
]

export const MOTIF_IDS: string[] = MOTIFS.map((m) => m.id)

const BY_ID = new Map(MOTIFS.map((m) => [m.id, m]))

/** The drawing's definition, or null for an id that isn't one (a choice saved by a newer version). */
export const motifById = (id: string | null | undefined): MotifDef | null => (id ? (BY_ID.get(id) ?? null) : null)

/** Each kind's own drawings, for an entry no words call for: its name picks one, always the same. */
const FALLBACK: Record<EntryKind, string[]> = {
  character: ['quill', 'rose', 'mask', 'star', 'eye', 'key', 'ring', 'compass'],
  place: ['house', 'tower', 'mountain', 'forest', 'bridge', 'gate', 'tree'],
  group: ['shield', 'crown', 'bell', 'scroll'],
  item: ['key', 'ring', 'cup', 'coin', 'compass', 'book'],
  lore: ['book', 'scroll', 'star', 'moon'],
  event: ['flame', 'star', 'hourglass', 'bell'],
  thread: ['map', 'compass', 'hourglass', 'key'],
  glossary: ['book', 'quill', 'scroll']
}

/** The fields that say most about what someone or something is. */
const TELLING = ['role', 'occupation', 'job', 'title', 'category', 'type', 'species', 'purpose', 'goals', 'traits', 'history', 'atmosphere', 'rules', 'promise']

/** The words of a text, lower case, possessives and plain plurals read as the word ("keeper’s", "keys"). */
export function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? []).map((w) => w.replace(/['’]s$/, '').replace(/['’]/g, ''))
}

const matches = (word: string, key: string): boolean => word === key || word === `${key}s` || word === `${key}es`

/** A steady small number for a name, to choose among a kind's own drawings. */
function steady(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

export interface MotifSource {
  kind: EntryKind
  name: string
  summary?: string
  description?: string
  fields?: Record<string, string>
}

/**
 * Each drawing's score for some weighted text: every word of a drawing's found counts its weight. Exposed for tests and
 * for the picker, which shows the best few first.
 */
export function motifScores(parts: { text: string; weight: number }[], kind: EntryKind | null): Map<string, number> {
  const scores = new Map<string, number>()
  for (const { text, weight } of parts) {
    if (!text) continue
    const words = wordsOf(text)
    for (const m of MOTIFS) {
      let s = 0
      for (const w of words) if (m.words.some((k) => matches(w, k))) s += weight
      if (s) scores.set(m.id, (scores.get(m.id) ?? 0) + s)
    }
  }
  // A lean towards the drawings that suit the kind (a lamp named in a lighthouse's page doesn't make it a lantern).
  if (kind) for (const [id, s] of scores) if (BY_ID.get(id)!.kinds.includes(kind)) scores.set(id, s + 1)
  return scores
}

const best = (scores: Map<string, number>): string | null => {
  let top: string | null = null
  let topS = 0
  for (const m of MOTIFS) {
    const s = scores.get(m.id) ?? 0
    if (s > topS) {
      top = m.id
      topS = s
    }
  }
  return top
}

/** The drawing for an entry: the one its words call for most, else one of its kind's own, chosen by its name. */
export function pickMotif(entry: MotifSource): string {
  const fields = entry.fields ?? {}
  const telling = TELLING.map((k) => fields[k] ?? '').filter(Boolean).join('. ')
  const scores = motifScores(
    [
      { text: entry.name, weight: 3 },
      { text: entry.summary ?? '', weight: 2 },
      { text: telling, weight: 1.5 },
      { text: entry.description ?? '', weight: 1 }
    ],
    entry.kind
  )
  const top = best(scores)
  if (top) return top
  const own = FALLBACK[entry.kind] ?? FALLBACK.item
  return own[steady(entry.name.trim().toLowerCase()) % own.length]
}

/** The drawing for a story's cover: from its title (most) and its premise; a lantern when nothing calls for one. */
export function pickStoryMotif(story: { title: string; premise: string }): string {
  return best(motifScores([
    { text: story.title, weight: 3 },
    { text: story.premise, weight: 1 }
  ], null)) ?? 'lantern'
}
