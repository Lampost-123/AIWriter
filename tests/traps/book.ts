// Story version 4, "the book": "The Winter Ledger", an invented novel of 40 scenes in 10 chapters (over 50,000 words),
// frozen in story-v4.json, so the memory changes of the long-story plan (research report "Long story memory and
// consistency", change 6) can be scored before and after on a story long enough to forget in. Version 3 (47,000
// words, chains in one scene after it) stays the default; `--story book` runs this one.
//
// Invented for the harness, written by hand (Claude, 2026-10-15) from a bible of facts, never by the model being scored,
// and nothing in it comes from Adam's own stories. It scores four things the report asks for:
//   1. Facts set early (chapters 1 to 3, 0 to 30% of the book) and asked about late (45 to 100%), each probe aimed at
//      its facts in other words: no probe's direction shares a key word with the sentence that set the fact (NoLiMa:
//      matching words hides forgetting). The unit tests check what Adam would type: the directions and the beats a
//      probe sets.
//   2. Facts that change: the wrist broken, splinted and healed; the secret told to one person after another; six dogs
//      then five; three pigeons sent one by one; the watch pawned then sold; the key moved into a boot heel; the thaw
//      bell closing the river. Probes come both before and after a change.
//   3. Planted contradictions, the FlawedFictions way: short passages after the book's end, twelve with one slip each and
//      six without (four of them "decoys": a real change that a careless checker calls a slip). The app's own
//      consistency checks are run on each, and the report says how many slips they caught and how often they cried wolf.
//   4. ConStory-Bench's five kinds of error: every check and every planted slip is one of timeline and plot logic,
//      characterisation, world-building and setting, factual and detail consistency, or narrative and style.
//
// The story's text lives in story-v4.json (scenes, cards and codex); this file holds what is tested: the traps, where
// each fact is set (the exact sentence), the probes and the planted passages. The facts tested are kept out of the three
// scenes before each probe and out of its page (the unit tests check that too), so a probe can only be passed by
// remembering.

import type { PatternCheck } from './patterns'
import type { Check, ProbeKind, Tripwire } from './story'

/** Bump when the probes, the checks or the planted passages change: reports say "book probes vN" and don't compare across. */
export const BOOK_PROBES_VERSION = 1

// ---------- What is tested ----------

/** ConStory-Bench's five kinds of consistency error (arXiv 2603.05890). */
export type ConStoryKind = 'timeline' | 'character' | 'world' | 'detail' | 'style'

export const CONSTORY_KINDS: { id: ConStoryKind; name: string; covers: string }[] = [
  { id: 'timeline', name: 'Timeline and plot logic', covers: 'one person or thing in one place at a time, nothing out of nowhere, threads not dropped, how long things take' },
  { id: 'character', name: 'Characterisation', covers: 'what people remember, what they know, what they can and can’t do' },
  { id: 'world', name: 'World-building and setting', covers: 'the world’s own rules and laws, and where places are' },
  { id: 'detail', name: 'Factual and detail consistency', covers: 'how people look, what things are called, numbers, injuries' },
  { id: 'style', name: 'Narrative and style', covers: 'whose eyes the story is told through, its tense and its register' }
]

/** What kind of remembering a check needs. */
export type MemoryKind = 'early' | 'changed' | 'style'

export const MEMORY_KINDS: { id: MemoryKind; name: string }[] = [
  { id: 'early', name: 'Set early, asked late in other words' },
  { id: 'changed', name: 'Changed during the book' },
  { id: 'style', name: 'How the story is told' }
]

export interface BookTrap {
  id: string
  name: string
  tests: string
  kind: ConStoryKind
  memory: MemoryKind
  /**
   * The words of the sentences that set the fact. No probe direction or beat that tests this trap may use any of them
   * (the unit tests check), so a probe never finds the fact by matching words.
   */
  words?: RegExp
}

export const BOOK_TRAPS: BookTrap[] = [
  { id: 'swim', name: 'Tamsin can’t swim', tests: 'Tamsin never learned to swim (s3); she crosses deep water any way but swimming.', kind: 'character', memory: 'early', words: /\b(?:swim\w*|swam|drown\w*|millrace)\b/i },
  { id: 'read', name: 'Pim can’t read', tests: 'Pim never learned to read a word (s1); someone reads letters to him.', kind: 'character', memory: 'early', words: /\b(?:read\w*|literate|illiterate|unlettered)\b/i },
  { id: 'hollish', name: 'Who speaks Hollish', tests: 'Tamsin speaks Hollish, her mother’s tongue (s2); Kit has none (s8).', kind: 'character', memory: 'early', words: /\b(?:Hollish|lowland|tongue|language|hill speech)\b/i },
  { id: 'father', name: 'How her parents died', tests: 'Her father drowned through the ice below Corran Weir eleven winters ago; her mother died of the marsh fever when she was nine (s2).', kind: 'character', memory: 'early', words: /\b(?:drown\w*|father|Aldous|mother|fever|eleven)\b/i },
  { id: 'secret', name: 'Who knows about the debt', tests: 'Only Tamsin (s2), then Fane (s6), Kit (s16), Wilmot by overhearing (s19), and Pim only once she tells him (s35).', kind: 'character', memory: 'changed', words: /\b(?:debt|crowns?|owe[sd]?|ledger|secret)\b/i },
  { id: 'wrist', name: 'Her right wrist', tests: 'Broken on day 3 (s5), splinted until Isla cuts the splint off on day 33 (s26), healed after.', kind: 'detail', memory: 'changed', words: /\b(?:wrist|splint\w*|sling|broken|hand|arm)\b/i },
  { id: 'sum', name: 'The sum owed', tests: 'Four hundred and twelve crowns (s2).', kind: 'detail', memory: 'early', words: /\b(?:crowns?|hundred|twelve|412)\b/i },
  { id: 'title', name: 'Slade’s title', tests: 'Corvin Slade is the Warden of the Wharf (s4).', kind: 'detail', memory: 'early', words: /\b(?:Warden|Wharf)\b/i },
  { id: 'looks', name: 'How Slade looks', tests: 'Pale, washed-blue eyes; a silver-headed cane for his right knee (s4).', kind: 'detail', memory: 'early', words: /\b(?:pale|blue|eyes?|cane|knee|limp\w*)\b/i },
  { id: 'sledge', name: 'The sledge’s name', tests: 'Kit’s sledge is the Long Patience (s8).', kind: 'detail', memory: 'early', words: /\b(?:Long Patience|patience|backboard)\b/i },
  { id: 'dogs', name: 'How many dogs', tests: 'Six dogs until Tansy is hurt (s15) and stays at Dunmere (s18); five after.', kind: 'detail', memory: 'changed', words: /\b(?:Tansy|six|five)\b/i },
  { id: 'pigeons', name: 'Pigeons left', tests: 'Three (s7); one sent from Corran (s12) and one from Dunmere (s18), one left in Hollin; the last sent on day 41 (s29), none after.', kind: 'detail', memory: 'changed', words: /\b(?:pigeons?|birds?|basket|loft)\b/i },
  { id: 'rule', name: 'How guild pigeons fly', tests: 'By daylight only, never after dark, and only home to their own loft (s7).', kind: 'world', memory: 'early', words: /\b(?:pigeons?|birds?|daylight|loft)\b/i },
  { id: 'bell', name: 'The thaw bell’s law', tests: 'Once the thaw bell rings, no runner may go out on the river ice (s12); it rings on day 43 (s31).', kind: 'world', memory: 'changed', words: /\b(?:bell|law|closed)\b/i },
  { id: 'bridge', name: 'Where the Guildhall is', tests: 'Gilt Street is on the west bank, the Guildhall on the east, the Chain Bridge between (s1).', kind: 'world', memory: 'early', words: /\b(?:bridge|bank|Chain|cross\w*|east|west)\b/i },
  { id: 'river', name: 'Which way home is', tests: 'The Varrow flows south; Hollin is north, upriver; Callowmere south, downriver (s8).', kind: 'world', memory: 'early', words: /\b(?:south\w*|north\w*|upriver|downriver|upstream|downstream)\b/i },
  { id: 'watch', name: 'Her father’s watch', tests: 'Pawned in Dunmere (s18) and sold (s30): after s18 she has no watch.', kind: 'timeline', memory: 'changed', words: /\b(?:watch|pawn\w*|time)\b/i },
  { id: 'key', name: 'Where Leckie’s key is', tests: 'Hidden in the heel of her left boot from day 40 (s28) until she opens the vault (s38).', kind: 'timeline', memory: 'changed', words: /\b(?:boot|heel|hid\w*|hollow)\b/i },
  { id: 'whereabouts', name: 'Where Slade is', tests: 'Slade never leaves Callowmere in winter (s19): he can’t be in Hollin.', kind: 'timeline', memory: 'early', words: /\b(?:Callowmere|never leaves|knee|Slade)\b/i },
  { id: 'snowbell', name: 'The promise to Fane', tests: 'Tamsin promised Fane a snowbell from Hollin (s6), was given one (s27), and gives it to him (s40).', kind: 'timeline', memory: 'early', words: /\b(?:snowbells?|promise\w*|Elsbet|flower\w*|Hollin)\b/i },
  { id: 'pov', name: 'Whose eyes', tests: 'Close third person, past tense, Tamsin’s view only.', kind: 'style', memory: 'style' },
  { id: 'register', name: 'No modern words', tests: 'The story’s own register: no modern slang.', kind: 'style', memory: 'style' }
]

/** The trap list as the report wants it. */
export const TRAPS4 = BOOK_TRAPS.map(({ id, name, tests }) => ({ id, name, tests }))

/**
 * Where each fact is set or changes: the exact sentence (story-v4.json has it word for word; the unit tests check).
 */
export const BOOK_PLANTS: { id: string; trap: string; scene: string; sentence: string }[] = [
  { id: 'bridge', trap: 'bridge', scene: 's1', sentence: 'Gilt Street ran along the west bank of the Varrow and the Guildhall stood on the east bank, and the only way between them was the Chain Bridge.' },
  { id: 'read', trap: 'read', scene: 's1', sentence: 'Pim could take a clock apart in the dark and put it together again by touch, but letters slid about on a page for him like minnows in a stream, and he had never learned to read a word.' },
  { id: 'sum', trap: 'sum', scene: 's2', sentence: 'Four hundred and twelve crowns, borrowed against the house and everything in it.' },
  { id: 'father', trap: 'father', scene: 's2', sentence: 'Her father had drowned eleven winters ago, when the ice gave way under him below Corran Weir, the winter Tamsin turned thirteen.' },
  { id: 'hollish', trap: 'hollish', scene: 's2', sentence: 'Her mother had been a Hollin woman, and she had raised Tamsin to speak Hollish before she ever spoke the lowland tongue.' },
  { id: 'mother', trap: 'father', scene: 's2', sentence: 'Her mother had died of the marsh fever when Tamsin was nine.' },
  { id: 'secret-alone', trap: 'secret', scene: 's2', sentence: 'No one else in the world knew about that page now but Tamsin.' },
  { id: 'swim', trap: 'swim', scene: 's3', sentence: 'She had never learned to swim, and since the millrace at Ambry she could not bear water above her knees.' },
  { id: 'secret-pim', trap: 'secret', scene: 's3', sentence: 'She would not tell Pim; Pim could no more keep a secret than a sieve could keep water.' },
  { id: 'title', trap: 'title', scene: 's4', sentence: 'Corvin Slade, Warden of the Wharf, received them in the long room under the clock.' },
  { id: 'eyes', trap: 'looks', scene: 's4', sentence: 'His eyes were a pale, washed blue, like ice over shallow water.' },
  { id: 'knee', trap: 'looks', scene: 's4', sentence: 'He leaned on a silver-headed cane and favoured his right knee, which had been stiff since a fall on the wharf steps years before.' },
  { id: 'wrist-broken', trap: 'wrist', scene: 's5', sentence: 'She heard the bone in her right wrist go with a small, dry snap.' },
  { id: 'wrist-splint', trap: 'wrist', scene: 's6', sentence: '‘A month in the splint,’ Fane said, ‘and no lifting with that hand till Thaw Day.’' },
  { id: 'secret-fane', trap: 'secret', scene: 's6', sentence: 'So she told him: the ledger, the sewn page, the four hundred and twelve crowns.' },
  { id: 'promise', trap: 'snowbell', scene: 's6', sentence: '‘I’ll bring you a snowbell from Hollin,’ Tamsin said. ‘I promise.’' },
  { id: 'rule', trap: 'rule', scene: 's7', sentence: '‘They fly by daylight and never after dark,’ Orla said, ‘and only ever home to this loft. Nowhere else, not for any money.’' },
  { id: 'pigeons-three', trap: 'pigeons', scene: 's7', sentence: 'Orla gave her three of them in a wicker basket with a leather strap, enough for three messages home.' },
  { id: 'dogs-six', trap: 'dogs', scene: 's8', sentence: 'Kit ran six dogs: Hob in the lead, then Fen and Bracken, Sloe and Rusk, and little Tansy at the back by the runners.' },
  { id: 'sledge', trap: 'sledge', scene: 's8', sentence: 'The sledge was called the Long Patience; the name was burned into its backboard in square black letters.' },
  { id: 'river', trap: 'river', scene: 's8', sentence: 'The Varrow ran south out of the hills to the sea, and in deep winter it froze hard enough to be a road.' },
  { id: 'kit-hollish', trap: 'hollish', scene: 's8', sentence: 'Kit had no Hollish beyond ‘thank you’ and ‘how much’, and he said so cheerfully.' },
  { id: 'bell-law', trap: 'bell', scene: 's12', sentence: 'When the thaw bell at Corran rang, the Wardens closed the ice road by law, and no runner might go out on the river again until the next winter.' },
  { id: 'pigeon-1', trap: 'pigeons', scene: 's12', sentence: 'She let the first pigeon go from the weir-keeper’s yard while the sun was still up, and watched it beat away south towards home.' },
  { id: 'tansy-hurt', trap: 'dogs', scene: 's15', sentence: 'Tansy’s off foreleg had gone down between the ice and the sledge, and afterwards she would not put it to the ground.' },
  { id: 'secret-kit', trap: 'secret', scene: 's16', sentence: 'Then, because he had pulled her out of the river, she told Kit Ansel about the four hundred and twelve crowns.' },
  { id: 'dogs-five', trap: 'dogs', scene: 's18', sentence: 'Tansy would stay in Dunmere; from here on Kit ran five dogs.' },
  { id: 'watch-pawned', trap: 'watch', scene: 's18', sentence: 'She laid her father’s silver watch on the pawnbroker’s counter and did not let herself look at it again.' },
  { id: 'pigeon-2', trap: 'pigeons', scene: 's18', sentence: 'She sent the second pigeon home from the dog-healer’s yard at noon; one was left in the basket.' },
  { id: 'whereabouts', trap: 'whereabouts', scene: 's19', sentence: '‘Slade won’t come himself,’ Kit said. ‘He never leaves Callowmere in winter, not with that knee.’' },
  { id: 'secret-wilmot', trap: 'secret', scene: 's19', sentence: 'Dace Wilmot had been sitting on the next settle the whole time, close enough to hear every word.' },
  { id: 'isla-hollish', trap: 'hollish', scene: 's22', sentence: 'Isla Thorne had no lowland speech at all.' },
  { id: 'wrist-free', trap: 'wrist', scene: 's26', sentence: 'Isla cut the splint away on the thirtieth day after the fall, and Tamsin’s right wrist came out of it thin and white and weak as a fledgling.' },
  { id: 'snowbell-given', trap: 'snowbell', scene: 's27', sentence: 'Isla gave her a snowbell pressed flat between two leaves of paper, and Tamsin put it inside her mother’s Hollish hymn book to keep.' },
  { id: 'isla-secret', trap: 'secret', scene: 's27', sentence: 'In Hollish, low, Isla told her that Edwin Leckie’s heart was failing and he would not see the summer, and that no lowlander was to hear it, not even him.' },
  { id: 'key-boot', trap: 'key', scene: 's28', sentence: 'Kit cut a hollow in the heel of her left boot with his knife, and the key went into it, and he pegged the heel shut again.' },
  { id: 'pigeon-dark', trap: 'rule', scene: 's28', sentence: 'But the last bird would not fly in the dark, and there was nothing to do but wait for first light.' },
  { id: 'pigeon-3', trap: 'pigeons', scene: 's29', sentence: 'At first light she sent the last pigeon home from the Hollin road, and after that the basket was empty.' },
  { id: 'watch-sold', trap: 'watch', scene: 's30', sentence: 'The pawnbroker had sold her father’s watch to a drover going down to the coast, and it was gone for good.' },
  { id: 'bell-rings', trap: 'bell', scene: 's31', sentence: 'The thaw bell began to ring above Corran Weir, and from that hour the ice road was closed.' },
  { id: 'secret-told', trap: 'secret', scene: 's35', sentence: 'She told Pim everything: the ledger, the debt, Leckie, the receipt.' },
  { id: 'key-out', trap: 'key', scene: 's38', sentence: 'She drew Leckie’s key out of the heel of her boot, and the two keys turned together.' },
  { id: 'wilmot-turns', trap: 'secret', scene: 's38', sentence: 'Dace Wilmot stood up at the back of the hall and said that he had heard the Warden boast of Aldous Orr’s gold, and would swear to it.' },
  { id: 'snowbell-kept', trap: 'snowbell', scene: 's40', sentence: 'She gave Hesketh Fane the snowbell from Hollin, pressed flat and still faintly blue, and he held it a long while without speaking.' }
]

// ---------- Deterministic checks ----------

/** Always "touched": a check of how the passage is told, kept unless broken. */
const ANY = /\S/

const STYLE = {
  /**
   * Told in the first person (a sentence of narration starting "I went", "I was"...) or the present tense: only the
   * narration counts. A thought given word for word ("I need to know what happened", s20) isn't narration.
   */
  pov: {
    id: 'pov',
    trap: 'pov',
    what: 'The narration slips into the first person or the present tense.',
    outsideQuotes: true,
    broken:
      /^\s*I\s+(?:was|had|went|walked|looked|turned|felt|saw|heard|thought|knew|took|stood|sat|said|told|asked|ran|came|could)\b|\b(?:Tamsin|Kit|Pim|[Ss]he|[Hh]e|[Tt]hey)\s+(?:says|asks|walks|turns|looks|takes|stands|sits|thinks|feels|goes|comes|runs|opens|pulls|smiles|nods|shrugs|laughs|watches|waits|knows|wants|reaches|steps|holds|hears|sees)\b/,
    touches: ANY
  },
  /** Modern words the story never uses, in speech or narration. */
  register: {
    id: 'register',
    trap: 'register',
    what: 'Modern slang (okay, guys, totally, gonna) in a winter story of clockmakers and sledges.',
    broken: /\b(?:okay|OK|guys|awesome|totally|gonna|wanna|kinda)\b/i,
    touches: ANY
  }
} satisfies Record<string, PatternCheck>

export const BOOK_PATTERNS = {
  /** Six dogs, or Tansy running in the team, after she stayed at Dunmere. */
  dogs: {
    id: 'dogs',
    trap: 'dogs',
    what: 'Six dogs, or Tansy in the team, after Tansy stayed at Dunmere.',
    outsideQuotes: true,
    broken:
      /\bsix dogs\b|\ball six\b|\bsix of (?:them|the dogs)\b|\bTansy\b[^.!?\n]{0,60}\b(?:ran|running|pulled|pulling|in (?:the )?harness|traces|leapt|bounded|trotted|loped|barked|yelped|whined|strained)\b|\b(?:harnessed|ran|running|pulled|pulling)\b[^.!?\n]{0,40}\bTansy\b/i,
    not: /\b(?:Dunmere|Hanne|Mina|left|stayed|behind|missed|miss\w*|remember\w*|thought of|used to|once|had been|no longer|without|empty|gap|place where)\b/i,
    touches: /\bdogs?\b|\bHob\b|\bTansy\b|\bteam\b/i
  },
  /** The debt given as another sum. */
  sum: {
    id: 'sum',
    trap: 'sum',
    what: 'The debt given as a sum other than four hundred and twelve crowns.',
    broken:
      /\b(?!four hundred and twelve\b)(?:one|two|three|four|five|six|seven|eight|nine) hundred(?:(?: and)? [a-z]+(?:-[a-z]+)?)? crowns\b|\b(?!412\b)[1-9][0-9]{2,}(?:,[0-9]{3})* crowns\b|\b(?:a|one|two|three) thousand\b[^.!?\n]{0,20}\bcrowns\b/i,
    touches: /\bcrowns?\b|\bdebt\b|\bowe[sd]?\b/i
  },
  /** Slade's bad knee put on the left. */
  knee: {
    id: 'knee',
    trap: 'looks',
    what: 'Slade’s stiff knee put on the left.',
    broken: /\bleft (?:knee|leg)\b/i,
    not: /\b(?:Tamsin|Pim|Kit|her)\b/i,
    touches: /\b(?:knee|cane|limp\w*|leg)\b/i
  },
  /** The splint still on after it was cut away. */
  splintStill: {
    id: 'splint',
    trap: 'wrist',
    what: 'Tamsin still in a splint or sling after it was cut away.',
    outsideQuotes: true,
    broken: /\b(?:splint\w*|sling)\b/i,
    not: /\b(?:off|gone|removed|cut away|no longer|without|old|had worn|used to|weeks? in|month in|out of|free of|freed|shed|after|since|once)\b/i,
    touches: /\b(?:wrist|right hand|both hands|hands?|arm)\b/i
  },
  /** The healed wrist only at the end: Fane finding it still broken. */
  splintAtEnd: {
    id: 'healed',
    trap: 'wrist',
    what: 'Tamsin’s wrist treated as still broken or splinted at the end of the book.',
    outsideQuotes: true,
    broken: /\b(?:splint\w*|sling)\b|\bbroken (?:wrist|arm|hand)\b/i,
    not: /\b(?:off|gone|removed|cut away|no longer|without|old|had worn|used to|weeks? in|month in|out of|free of|freed|shed|after|since|once|was|had been|mended|healed|knit)\b/i,
    touches: /\b(?:wrist|hand|arm)\b/i
  },
  /** Going home to Callowmere put as going north or upriver. */
  river: {
    id: 'river',
    trap: 'river',
    what: 'Callowmere put to the north, or reached by going upriver.',
    broken:
      /\b(?:north|northward|northwards|upriver|upstream)\b(?:\s+[\w’']+){0,4}?\s+(?:to|towards|toward|for)\s+(?:Callowmere|home|the city)\b|\b(?:Callowmere|home|the city)\b[^.!?\n]{0,30}\b(?:lay|lies|was|stood) (?:to the |away )?(?:north|upriver|upstream)\b/i,
    not: /\b(?:Hollin|behind them|behind|away from|left)\b/i,
    touches: /\b(?:north|south)\w*\b|\b(?:upriver|downriver|upstream|downstream)\b|\bCallowmere\b/i
  },
  ...STYLE
} satisfies Record<string, PatternCheck>

const p = (c: PatternCheck, id: string): PatternCheck => ({ ...c, id })
const wire = (check: string, what: string, pattern: RegExp, not?: RegExp, outsideQuotes = true): Tripwire => ({ check, what, pattern, ...(not ? { not } : {}), outsideQuotes })

const NEGATED = /\b(?:couldn’t|couldn't|could not|can’t|can't|cannot|never|not|no|wished|wish|if only|would have|wouldn’t|wouldn't|won’t|won't)\b/i

const TRIP = {
  swim: (check: string): Tripwire =>
    wire(check, 'Tamsin swims.', /\b(?:Tamsin|she)\b[^.!?\n]{0,40}\b(?:swam|swims|swimming|struck out|kicked out for)\b|\b(?:swam|swimming)\b[^.!?\n]{0,30}\bTamsin\b/i, NEGATED),
  read: (check: string): Tripwire =>
    wire(
      check,
      'Pim reads the words himself.',
      /\bPim\b[^.!?\n]{0,40}\b(?:read|reads|reading)\b/i,
      /\b(?:couldn’t|couldn't|could not|can’t|can't|cannot|never|not|Orla|Fane|someone|to him|for him|read him|had it read|tried|pretend\w*)\b/i
    ),
  dark: (check: string): Tripwire =>
    wire(
      check,
      'A pigeon flies in the dark.',
      /\b(?:pigeon|bird)\b[^.!?\n]{0,80}\b(?:into the (?:dark|night|darkness)|in the dark|by moonlight|under the moon|through the night)\b|\b(?:released|loosed|let (?:it|the bird|the pigeon) go|sent (?:it|the bird|the pigeon) off|tossed|threw)\b[^.!?\n]{0,60}\b(?:dark|night|moon)\w*\b/i,
      /\b(?:wouldn’t|wouldn't|would not|won’t|won't|will not|couldn’t|couldn't|could not|can’t|can't|cannot|never|not|no|wait\w*|until|till|morning|first light|dawn|daylight)\b/i
    ),
  sent: (check: string): Tripwire =>
    wire(
      check,
      'A pigeon is sent when none is left.',
      /\b(?:released|loosed|sent|let go|tossed|launched)\b[^.!?\n]{0,40}\b(?:pigeon|bird)\b|\b(?:pigeon|bird)\b[^.!?\n]{0,40}\b(?:flew|beat away|winged|rose|climbed)\b/i,
      /\b(?:no|none|empty|last|wish\w*|if only|would|could|had (?:no|none)|hadn’t|hadn't|without|already|days ago|from Hollin|gone)\b/i
    ),
  watch: (check: string): Tripwire =>
    wire(
      check,
      'Tamsin has or uses her father’s watch.',
      /\b(?:took|pulled|drew|fished|got|slipped) (?:out )?(?:her |the |her father’s |her father's )?(?:silver |pocket )*watch\b|\b(?:checked|consulted|opened|flipped open|snapped open|wound|glanced at|looked at|squinted at) (?:her |her father’s |her father's )(?:silver |pocket )*watch\b|\bwatch\b[^.!?\n]{0,30}\b(?:in her (?:hand|palm|pocket|fingers)|from her (?:pocket|coat)|ticked|ticking)\b/i,
      /\b(?:pawn\w*|sold|gone|no longer|without|missed|miss|wish\w*|once|used to|had (?:no|not)|hadn’t|hadn't|didn’t|didn't|did not|if only|would have|remember\w*|thought of|Dunmere|drover|reached for|habit)\b/i
    ),
  ice: (check: string): Tripwire =>
    wire(
      check,
      'They take the sledge out on the river ice after the thaw bell.',
      /\b(?:out|down|back) (?:onto|on to|on) the (?:river )?ice\b|\b(?:drove|ran|took|turned|swung|went)\b[^.!?\n]{0,30}\bonto the (?:river|ice)\b/i,
      /\b(?:not|never|no|wouldn’t|wouldn't|would not|won’t|won't|refused|forbidden|shut|closed|law|bell|wanted to|could have|tempt\w*|if)\b/i
    ),
  father: (check: string): Tripwire =>
    wire(
      check,
      'Her father dies some other way.',
      /\b(?:father|Aldous)\b[^.!?\n]{0,60}\b(?:fever|illness|sickness|in (?:his|the) bed|heart gave out|fell from|was killed|murdered|stabbed|died of)\b/i,
      /\b(?:mother|not|never)\b/i,
      false
    ),
  eyes: (check: string): Tripwire =>
    wire(
      check,
      'Slade’s eyes given another colour.',
      /\b(?:Slade|Warden)(?:’s|'s)\s+(?:\w+\s+){0,2}(?:brown|dark|black|green|hazel|grey|gray|amber)\s+eyes\b|\b(?:Slade|Warden)(?:’s|'s)? eyes\b[^.!?\n]{0,30}\b(?:brown|dark|black|green|hazel|grey|gray|amber)\b/i,
      undefined,
      false
    ),
  title: (check: string): Tripwire =>
    wire(check, 'Slade given another title.', /\bWarden of the (?!Wharf\b)[A-Z]\w+|\b(?:Guildmaster|Alderman|Lord Mayor|Harbourmaster|Master of the Guild)\b/, undefined, false),
  key: (check: string): Tripwire =>
    wire(
      check,
      'Leckie’s key somewhere other than her boot heel.',
      /\b(?:Leckie’s|Leckie's|the second|the other) key\b[^.!?\n]{0,60}\b(?:pocket|round her neck|around her neck|cord|chain|satchel|purse|bodice|glove|belt)\b/i,
      /\b(?:boot|heel|moved|put it|slipped it|took it out|drew it out)\b/i
    )
}

// ---------- Probes ----------

/** Where a probe's page stops: an empty scene, or just before the paragraph that starts with a marker sentence. */
export type BookAt = { start: true } | { before: string }

export interface BookProbe {
  id: string
  scene: string
  kind: ProbeKind
  beat?: number
  at: BookAt
  direction?: string
  beats?: string[]
  soFarEnds?: 'with-beat' | 'mid-beat'
  asks: string
  facts: string[]
  checks: Check[]
  tripwires: Tripwire[]
  patterns: PatternCheck[]
  /** Scenes before the probe (besides its page) that must not mention the facts tested, by trap: the unit tests check. */
  quiet: { trap: string; words: RegExp; scenes: string[] }[]
}

const B1_QUIET = /\b(?:splint\w*|wrist|sling|right hand|one-handed)\b/i

const PERSPECTIVE = (id: string, who: string): Check => ({
  id,
  trap: 'pov',
  ask: `Does the passage tell from the inside what ${who} thinks or feels (thoughts nobody says aloud and Tamsin couldn’t see), rather than only what Tamsin sees, hears and thinks? Guessing from a face or a voice doesn’t count.`,
  bad: 'yes'
})

const STYLE_PATTERNS = (probe: string): PatternCheck[] => [p(STYLE.pov, `${probe}s`), p(STYLE.register, `${probe}r`)]

export const BOOK_PROBES: BookProbe[] = [
  {
    id: 'B1',
    scene: 's18',
    kind: 'addBelow',
    at: { before: 'Hanne knelt in the straw and began to bind the leg.' },
    direction: 'Tamsin helps Hanne hold Tansy still while the leg is bound, then carries the sacks of meal down to the sledge.',
    asks: 'Add below in scene 18 (day 11), asked for Tamsin to hold the dog still and carry sacks: her right wrist has been in a splint since day 3, last mentioned three scenes back.',
    facts: [
      'Tamsin broke her RIGHT wrist on day 3; it is in a splint (Fane: a month in the splint, no lifting with that hand till Thaw Day). It is day 11: she can use only her left hand.',
      'Tansy, the smallest of Kit’s six dogs, hurt her foreleg on day 10.'
    ],
    checks: [
      {
        id: 'B1a',
        trap: 'wrist',
        ask: 'Does Tamsin use her right hand or wrist freely in this passage (gripping, holding the dog down with both hands, lifting or carrying a sack with both hands or the right) as if it were not broken and splinted?',
        bad: 'yes'
      }
    ],
    tripwires: [],
    patterns: [],
    quiet: [{ trap: 'wrist', words: B1_QUIET, scenes: ['s15', 's16', 's17'] }]
  },
  {
    id: 'B2',
    scene: 's22',
    kind: 'generate',
    at: { start: true },
    direction: 'Tamsin and Kit ask the old woman at the well where Master Leckie is. She knows no words but her own people’s. Show the whole conversation, and how Kit takes it.',
    asks: 'Generate scene 22 (Hollin, day 12): an old woman who speaks only Hollish; Tamsin was raised speaking it (scene 2) and Kit has none (scene 8).',
    facts: [
      'Tamsin’s mother was a Hollin woman who raised her to speak Hollish before the lowland tongue: Tamsin speaks and understands Hollish.',
      'Kit has no Hollish beyond "thank you" and "how much".',
      'Kit runs five dogs: Tansy stayed at Dunmere yesterday.'
    ],
    checks: [
      {
        id: 'B2a',
        trap: 'hollish',
        ask: 'Does Tamsin fail to understand the old woman, or need someone else to put her words into the lowland speech for her (an interpreter, a child, Kit, signs only)?',
        bad: 'yes'
      },
      {
        id: 'B2b',
        trap: 'hollish',
        ask: 'Does Kit understand the old woman’s own speech, or answer her in it, as if he knew the language?',
        bad: 'yes'
      }
    ],
    tripwires: [],
    patterns: [p(BOOK_PATTERNS.dogs, 'B2c'), ...STYLE_PATTERNS('B2')],
    quiet: [
      { trap: 'hollish', words: /\b(?:Hollish|hill tongue|mother’s tongue|lowland|language|translat\w*)\b/i, scenes: ['s19', 's20', 's21'] },
      { trap: 'dogs', words: /\b(?:Tansy|six dogs|five dogs)\b/i, scenes: ['s19', 's20', 's21'] }
    ]
  },
  {
    id: 'B3',
    scene: 's24',
    kind: 'addBelow',
    at: { before: 'When Leckie had done talking, Tamsin sat a long time without moving.' },
    direction: 'Tamsin writes down everything Master Leckie has told her, then goes out to help Kit split firewood for the stove.',
    asks: 'Add below in scene 24 (Hollin, day 13), asked for Tamsin to write and to split firewood: her right wrist is still splinted; Kit has known about the debt since day 10.',
    facts: [
      'Tamsin’s RIGHT wrist is broken and in a splint (since day 3; it comes off on day 33). She writes left-handed, badly, and lifts nothing with the right.',
      'Kit has known about the debt of four hundred and twelve crowns since Tamsin told him on day 10.'
    ],
    checks: [
      {
        id: 'B3a',
        trap: 'wrist',
        ask: 'Does Tamsin use her right hand or wrist freely (writing with it, gripping an axe or a log with both hands, lifting with it) as if it were not broken and in a splint?',
        bad: 'yes'
      },
      { id: 'B3b', trap: 'secret', ask: 'Does Kit react as if he is hearing about the house’s debt to the guild for the first time?', bad: 'yes' }
    ],
    tripwires: [],
    patterns: [],
    quiet: [{ trap: 'wrist', words: B1_QUIET, scenes: ['s21', 's22', 's23'] }]
  },
  {
    id: 'B4',
    scene: 's28',
    kind: 'continue',
    at: { before: 'Pim must be warned.' },
    beats: [
      'Tamsin wakes in the night to someone at the shutters of Bettany’s house.',
      'Kit catches Dace Wilmot in the kitchen with a knife, prising at the clock case, and throws him out into the snow.',
      'Kit cuts a hiding place for the key.',
      'Late at night, Tamsin decides Pim must be warned at once that the Warden’s man has found them.'
    ],
    asks: 'Continue at the end of scene 28 (Hollin, day 40, night), its card ending with Tamsin deciding Pim must be warned at once: guild pigeons never fly after dark and only home (scene 7); one is left.',
    facts: [
      'Guild pigeons fly only by daylight, never after dark, and only ever home to their own loft (Tamsin’s come from the Callowmere loft).',
      'Tamsin has ONE pigeon left (one sent from Corran Weir, one from Dunmere). It is night.',
      'Corvin Slade never leaves Callowmere in winter; only his man Dace Wilmot is in Hollin.'
    ],
    checks: [
      { id: 'B4a', trap: 'rule', ask: 'Does a pigeon fly, or get sent off, while it is still dark?', bad: 'yes' },
      { id: 'B4b', trap: 'pigeons', ask: 'Is Tamsin said to have more than one pigeon left, or does she send more than one?', bad: 'yes' },
      { id: 'B4c', trap: 'rule', ask: 'Is a pigeon sent anywhere other than home to Callowmere (to Dunmere, to a person on the road, to Hollin)?', bad: 'yes' },
      { id: 'B4d', trap: 'whereabouts', ask: 'Does Corvin Slade himself appear in Hollin in this passage?', bad: 'yes' }
    ],
    tripwires: [TRIP.dark('B4a')],
    patterns: [],
    quiet: [
      { trap: 'pigeons', words: /\b(?:pigeons?|basket|loft)\b/i, scenes: ['s25', 's26', 's27'] },
      { trap: 'whereabouts', words: /\bnever leaves\b/i, scenes: ['s25', 's26', 's27'] }
    ]
  },
  {
    id: 'B5',
    scene: 's30',
    kind: 'continue',
    at: { before: 'At the edge of the lake the runners sank into a drift.' },
    beats: [
      'At Dunmere Tamsin goes to the pawnbroker on the quay to buy back her father’s watch with the last of her money.',
      'The pawnbroker sold it a fortnight ago; it is gone for good.',
      'Kit says nothing, but buys her a hot pie and makes her eat it.',
      'At the lake’s edge the sledge sticks in a drift, and Tamsin hauls it free.'
    ],
    asks: 'Continue at the end of scene 30 (Dunmere, day 42), its card ending with Tamsin hauling the sledge out of a drift: the splint came off nine days ago (scene 26).',
    facts: ['Tamsin’s right wrist was in a splint from day 3 until Isla cut it away on day 33. It is day 42: the wrist is out of the splint, still a little weak but usable.'],
    checks: [{ id: 'B5a', trap: 'wrist', ask: 'Is Tamsin’s right wrist described as still in a splint or sling, or too broken to use?', bad: 'yes' }],
    tripwires: [],
    patterns: [p(BOOK_PATTERNS.splintStill, 'B5b')],
    quiet: [{ trap: 'wrist', words: B1_QUIET, scenes: ['s27', 's28', 's29'] }]
  },
  {
    id: 'B6',
    scene: 's31',
    kind: 'generate',
    at: { start: true },
    direction: 'Let Tamsin go down alone to the water’s edge and remember the worst night of her girlhood, and then tell Kit about it.',
    asks: 'Generate scene 31 (Corran Weir, day 43), asked for Tamsin to remember the worst night of her girlhood: her father drowned below this weir eleven winters ago (scenes 2 and 13).',
    facts: [
      'Tamsin’s father, Aldous Orr, drowned eleven winters ago when the ice gave way under him below Corran Weir, coming home from Hollin; Tamsin was thirteen. His body was found in the spring.',
      'Her mother died of the marsh fever when Tamsin was nine.'
    ],
    checks: [
      {
        id: 'B6a',
        trap: 'father',
        ask: 'Does the passage say her father died some other way than drowning through the ice below Corran Weir, or at another time (not eleven winters ago, not when she was thirteen)?',
        bad: 'yes'
      },
      { id: 'B6b', trap: 'father', ask: 'Does the passage say her mother died some other way than the marsh fever, or when Tamsin was not nine?', bad: 'yes' }
    ],
    tripwires: [TRIP.father('B6a')],
    patterns: STYLE_PATTERNS('B6'),
    quiet: [{ trap: 'father', words: /\b(?:drown\w*|Brannock|eleven|fever|her father (?!’s watch))\b/i, scenes: ['s28', 's29', 's30'] }]
  },
  {
    id: 'B7',
    scene: 's32',
    kind: 'addBelow',
    at: { before: 'The low road ran straight into the water.' },
    direction: 'Meltwater has flooded the road ahead, chest-deep and running fast, and there is no way round. Show how each of them gets to the far side.',
    asks: 'Add below in scene 32 (the bank road, day 43), asked how each of them crosses chest-deep floodwater: Tamsin never learned to swim (scene 3).',
    facts: [
      'Tamsin never learned to swim; since falling in the millrace at Ambry at seven she cannot bear water above her knees. Kit can swim.',
      'They are going south, downriver, home to Callowmere.'
    ],
    checks: [{ id: 'B7a', trap: 'swim', ask: 'Does Tamsin swim (rather than wade, cling to a rope, be carried or pulled across, or turn back)?', bad: 'yes' }],
    tripwires: [TRIP.swim('B7a')],
    patterns: [p(BOOK_PATTERNS.river, 'B7b')],
    quiet: [{ trap: 'swim', words: /\b(?:swim\w*|swam|millrace)\b/i, scenes: ['s29', 's30', 's31'] }]
  },
  {
    id: 'B8',
    scene: 's33',
    kind: 'addBelow',
    at: { before: 'Kit saw to the dogs before he saw to himself.' },
    direction: 'Kit talks to his dogs one by one as he sees to their feet, and tells Tamsin how his sledge got its name.',
    asks: 'Add below in scene 33 (camp on the bank road, day 44), asked for the dogs one by one and the sledge’s name: five dogs since Tansy stayed at Dunmere (scene 18); the sledge is the Long Patience (scene 8).',
    facts: [
      'Kit runs five dogs: Hob, Fen, Bracken, Sloe and Rusk. Tansy, the sixth, stayed at Dunmere on day 11.',
      'Kit’s sledge is called the Long Patience.',
      'They are going south, downriver, home to Callowmere.'
    ],
    checks: [
      { id: 'B8a', trap: 'sledge', ask: 'Is the sledge called by any name other than the Long Patience?', bad: 'yes' },
      { id: 'B8b', trap: 'dogs', ask: 'Are there six dogs here, or is Tansy with them in the team?', bad: 'yes' }
    ],
    tripwires: [],
    patterns: [p(BOOK_PATTERNS.dogs, 'B8c'), p(BOOK_PATTERNS.river, 'B8d')],
    quiet: [{ trap: 'dogs', words: /\b(?:Tansy|six dogs|five dogs|Long Patience|backboard)\b/i, scenes: ['s30', 's31', 's32'] }]
  },
  {
    id: 'B9',
    scene: 's34',
    kind: 'continue',
    at: { before: 'The light was going.' },
    beats: [
      'The last day’s run down the bank road towards Callowmere.',
      'Tamsin wishes she could send word ahead to Pim that they are nearly home, and works out how much daylight is left before the city gates shut.',
      'The river ice beside the road looks smooth and quick, and the dogs are tired.'
    ],
    asks: 'Continue in scene 34 (day 45), its card asking for word sent ahead, the daylight left and the smooth river ice: no pigeons left (scene 29), no watch (pawned scene 18, sold scene 30), the ice closed by the thaw bell (scene 31).',
    facts: [
      'Tamsin has no pigeons left: the last was sent from the Hollin road on day 41.',
      'She has no watch: she pawned her father’s silver watch at Dunmere on day 11, and it was sold.',
      'The thaw bell rang at Corran on day 43: by law no runner may go out on the river ice.',
      'They are going south, downriver, home to Callowmere.'
    ],
    checks: [
      { id: 'B9a', trap: 'watch', ask: 'Does Tamsin take out, open, wind or look at a watch of her own (her father’s silver watch)?', bad: 'yes' },
      { id: 'B9b', trap: 'pigeons', ask: 'Does Tamsin send a pigeon, or have one left to send?', bad: 'yes' },
      { id: 'B9c', trap: 'bell', ask: 'Do they take the sledge out onto the river ice?', bad: 'yes' }
    ],
    tripwires: [TRIP.watch('B9a'), TRIP.sent('B9b'), TRIP.ice('B9c')],
    patterns: [p(BOOK_PATTERNS.river, 'B9d')],
    quiet: [
      { trap: 'watch', words: /\b(?:watch|pawn\w*)\b/i, scenes: ['s31', 's32', 's33'] },
      { trap: 'pigeons', words: /\b(?:pigeons?|basket)\b/i, scenes: ['s31', 's32', 's33'] }
    ]
  },
  {
    id: 'B10',
    scene: 's35',
    kind: 'generate',
    at: { start: true },
    direction: 'Pim tells Tamsin everything that went wrong at the house while she was away, and what the letter that came from the Guildhall yesterday says.',
    asks: 'Generate scene 35 (home, day 45), asked for Pim to tell her what the Guildhall letter says: Pim never learned to read (scene 1), and Tamsin kept the debt from him (scene 3).',
    facts: [
      'Pim cannot read: letters slide about on the page for him. Orla Finch at the pigeon loft reads him anything with writing on it.',
      'Pim does not know about the debt: Tamsin kept it from him because he cannot keep a secret. Only Fane, Kit, Leckie and the Warden’s side know.'
    ],
    checks: [
      { id: 'B10a', trap: 'read', ask: 'Does Pim read the letter’s words himself (rather than having had someone read it to him, or handing it to Tamsin)?', bad: 'yes' },
      { id: 'B10b', trap: 'secret', ask: 'Before anyone tells him in this passage, does Pim show that he already knew the house owed the guild a debt?', bad: 'yes' },
      PERSPECTIVE('B10c', 'Pim or anyone but Tamsin')
    ],
    tripwires: [TRIP.read('B10a')],
    patterns: STYLE_PATTERNS('B10'),
    quiet: [
      { trap: 'read', words: /\b(?:read\w*|letter)\b/i, scenes: ['s32', 's33', 's34'] },
      { trap: 'secret', words: /\b(?:debt|crowns|owe[sd]?|ledger)\b/i, scenes: ['s32', 's33', 's34'] }
    ]
  },
  {
    id: 'B11',
    scene: 's37',
    kind: 'generate',
    at: { start: true },
    direction: 'On the morning of the Reckoning, Tamsin and Pim walk from the clock-house to the Guildhall. Show every street of the way, and Tamsin making sure she has both keys.',
    asks: 'Generate scene 37 (Thaw Day), asked for the walk from the clock-house to the Guildhall and both keys: the Guildhall is across the river by the Chain Bridge (scene 1); Leckie’s key is in her boot heel (scene 28).',
    facts: [
      'The clock-house is on Gilt Street, on the west bank; the Guildhall is on the east bank; the only way between is the Chain Bridge.',
      'Tamsin wears the Orrs’ key at her belt. Leckie’s key is hidden in a hollow in the heel of her left boot.',
      'Pim has known about the debt since last night.'
    ],
    checks: [
      {
        id: 'B11a',
        trap: 'bridge',
        ask: 'Does the passage put the Guildhall on the same side of the river as Gilt Street, or have them reach it without crossing the river?',
        bad: 'yes'
      },
      {
        id: 'B11b',
        trap: 'key',
        ask: 'Is Leckie’s key said to be somewhere other than the heel of her boot (a pocket, a cord round her neck, her satchel) without the passage first showing her take it out of the boot?',
        bad: 'yes'
      }
    ],
    tripwires: [TRIP.key('B11b')],
    patterns: STYLE_PATTERNS('B11'),
    quiet: [
      { trap: 'bridge', words: /\b(?:Chain Bridge|east bank|west bank)\b/i, scenes: ['s34', 's35', 's36'] },
      { trap: 'key', words: /\b(?:boots?|heel)\b/i, scenes: ['s34', 's35', 's36'] }
    ]
  },
  {
    id: 'B12',
    scene: 's38',
    kind: 'addBelow',
    at: { before: 'Slade rose and went to the lectern.' },
    direction: 'Slade goes up to the lectern and reads out what the house of Orr & Leckie owes, to whom, and since when. Describe him closely as he turns to look at Tamsin.',
    asks: 'Add below in scene 38 (the Reckoning), asked for Slade reading out the debt and described closely: four hundred and twelve crowns (scene 2); the Warden of the Wharf, pale blue eyes, a cane for his right knee (scene 4).',
    facts: [
      'The debt in the guild’s books is four hundred and twelve crowns, borrowed eleven years ago by Aldous Orr against the house.',
      'Corvin Slade is the Warden of the Wharf. His eyes are a pale, washed blue; he leans on a silver-headed cane for a stiff RIGHT knee.'
    ],
    checks: [
      { id: 'B12a', trap: 'sum', ask: 'Does the passage give the debt as a sum other than four hundred and twelve crowns?', bad: 'yes' },
      { id: 'B12b', trap: 'title', ask: 'Is Slade given a title other than Warden of the Wharf (Master, Alderman, Lord, Mayor, Warden of something else)? Just "the Warden" doesn’t count.', bad: 'yes' },
      { id: 'B12c', trap: 'looks', ask: 'Are Slade’s eyes described as any colour other than pale blue?', bad: 'yes' },
      PERSPECTIVE('B12d', 'Slade')
    ],
    tripwires: [TRIP.eyes('B12c'), TRIP.title('B12b')],
    patterns: [p(BOOK_PATTERNS.sum, 'B12e'), p(BOOK_PATTERNS.knee, 'B12f')],
    quiet: [{ trap: 'sum', words: /\b(?:four hundred|crowns|pale|cane|knee|Warden of the Wharf)\b/i, scenes: ['s35', 's36', 's37'] }]
  },
  {
    id: 'B13',
    scene: 's40',
    kind: 'beat',
    beat: 2,
    at: { before: 'Fane’s shop smelled of camphor and cold ashes, as it always had.' },
    soFarEnds: 'with-beat',
    direction: 'Fane looks older. They talk about the winter. Something passes between them before she goes.',
    asks: 'Beat 2 of scene 40 (the day after Thaw Day), Tamsin calling on Fane: she promised him a snowbell from Hollin (scene 6) and Isla gave her one (scene 27); her wrist has healed.',
    facts: [
      'On day 3 Tamsin promised Hesketh Fane a snowbell from Hollin for him (his late wife Elsbet loved them). In Hollin Isla gave her one, pressed, kept in her mother’s hymn book. She has not given it to him yet.',
      'Fane set Tamsin’s broken right wrist on day 3; the splint came off on day 33 and the wrist has healed.'
    ],
    checks: [
      { id: 'B13a', trap: 'snowbell', ask: 'Before she leaves Fane, does Tamsin give him the snowbell from Hollin, or at least speak of her promise to bring him one?', bad: 'no' },
      { id: 'B13b', trap: 'wrist', ask: 'Does Fane find or treat Tamsin’s wrist as still broken, or still in a splint?', bad: 'yes' }
    ],
    tripwires: [],
    patterns: [p(BOOK_PATTERNS.splintAtEnd, 'B13c')],
    quiet: [
      { trap: 'snowbell', words: /\b(?:snowbells?|Elsbet|promise\w*|hymn)\b/i, scenes: ['s37', 's38', 's39'] },
      { trap: 'wrist', words: /\b(?:splint\w*|wrist)\b/i, scenes: ['s37', 's38', 's39'] }
    ]
  }
]

// ---------- Planted contradictions: what the app's checks catch ----------

/**
 * A short passage set just after the book's end (three days after Thaw Day), checked by the app's own consistency
 * checks as Adam would check a scene. `flaw` is the one sentence that breaks the story (a planted slip); a passage with
 * no flaw is a control, and `decoy` is a sentence that looks like a slip but isn't (a real change: the wrist healed, the
 * dog left behind), which a careless checker flags.
 */
export interface Planted {
  id: string
  /** What it tests, in plain words. */
  name: string
  kind: ConStoryKind
  trap: string
  flaw?: string
  decoy?: string
  /** Why the flaw is a slip, or why the decoy isn't. */
  why: string
  card: { present: string[]; location: string; when: string; title: string }
  paragraphs: string[]
}

const AFTER = 'Day 50, three days after Thaw Day'

export const PLANTED: Planted[] = [
  {
    id: 'X1',
    name: 'Kit’s eyes',
    kind: 'detail',
    trap: 'looks',
    flaw: 'Kit’s brown eyes creased at the corners when he saw the tea.',
    why: 'Kit’s eyes are grey (his codex entry and scene 8).',
    card: { present: ['tamsin', 'kit'], location: 'clockhouse', when: `${AFTER}, morning`, title: 'Harness' },
    paragraphs: [
      'The thaw had come in earnest overnight, and the gutters along Gilt Street ran with a steady chuckle of water. Tamsin carried two cups of tea through the workshop, past Pim’s bench with its tray of brass pins, and out into the yard where Kit sat on an upturned crate with a dog harness across his knees.',
      'Kit’s brown eyes creased at the corners when he saw the tea. He took his cup in both hands and held it under his nose for a while before he drank.',
      '‘Hob’s chewed the trace again,’ he said. ‘Every spring. I think he does it to make me stay put.’',
      '‘Then let him chew it,’ Tamsin said.',
      'He laughed and bent to the leather. She sat on the step and watched him work the awl through, the thread pulled tight with a little grunt each time. Above the roofs a gull wheeled and cried, the first she had heard since autumn. Across the river the great clock struck the half hour, and they both looked up at the sound of it as if it might stop again.'
    ]
  },
  {
    id: 'X2',
    name: 'The sum',
    kind: 'detail',
    trap: 'sum',
    flaw: 'She wrote it in her own hand beneath her father’s: four hundred and twenty crowns, paid in full eleven years ago, struck from the guild’s books on Thaw Day.',
    why: 'The debt was four hundred and twelve crowns (scene 2, the receipt in scene 27).',
    card: { present: ['tamsin'], location: 'clockhouse', when: `${AFTER}, evening`, title: 'The last entry' },
    paragraphs: [
      'The counting room was cold, as it always was, and Tamsin lit only the one lamp. Her father’s last ledger lay open on the desk at the page she had cut free on Lantern Night, its stitches still hanging from the margin like loose threads from a hem.',
      'She dipped the pen and held it a moment over the page. Then she wrote. She wrote it in her own hand beneath her father’s: four hundred and twenty crowns, paid in full eleven years ago, struck from the guild’s books on Thaw Day.',
      'Her letters were steadier now than they had been all winter. She blotted the line, closed the ledger and sat with her hands flat on its cover, listening to the house: Pim snoring overhead, Kit turning over on his pallet in the workshop, the clocks on the wall all ticking a little apart from one another, the way they always had.'
    ]
  },
  {
    id: 'X3',
    name: 'The sledge’s name',
    kind: 'detail',
    trap: 'sledge',
    flaw: 'The Steady Hope stood on its runners in the yard behind the clock-house, its backboard scrubbed for the journey home.',
    why: 'Kit’s sledge is the Long Patience (scenes 8 and 33).',
    card: { present: ['tamsin', 'kit'], location: 'clockhouse', when: `${AFTER}, afternoon`, title: 'The yard' },
    paragraphs: [
      'The Steady Hope stood on its runners in the yard behind the clock-house, its backboard scrubbed for the journey home. Kit had been at it since noon with a bucket and a brush, and the wood had come up pale and clean under the grime of the road.',
      '‘You’ll wear it through,’ Tamsin said from the doorway.',
      '‘It’s carried you there and back,’ Kit said. ‘It can have a wash.’',
      'He would not go yet; the river was still full of grinding ice, and the bank road was a bog. But she could see him looking north over the roofs in the evenings, the way Pim looked at a clock he had not yet taken apart.'
    ]
  },
  {
    id: 'X4',
    name: 'Pim reads',
    kind: 'character',
    trap: 'read',
    flaw: 'Pim broke the seal and read the guild’s letter aloud to them, quick and sure, without stumbling over a single word.',
    why: 'Pim never learned to read a word (scene 1); Orla reads his letters to him (scenes 7 and 35).',
    card: { present: ['tamsin', 'pim', 'kit'], location: 'clockhouse', when: `${AFTER}, morning`, title: 'A letter from the Guildhall' },
    paragraphs: [
      'The letter came with the guild’s seal on it, red and fat as a cherry, and the porter who brought it bowed to Tamsin on the doorstep as he had never bowed to anyone from Gilt Street in his life.',
      'Pim broke the seal and read the guild’s letter aloud to them, quick and sure, without stumbling over a single word. The guild thanked the house of Orr & Leckie for the great clock, begged the house’s pardon for the trouble of the winter, and asked whether Master Pim Orr would take on the clock’s keeping at a wage of twelve crowns a quarter.',
      'Kit whistled. Pim went red to the ears and then could not stop grinning, and Tamsin had to turn away to the window so that neither of them would see her face.'
    ]
  },
  {
    id: 'X5',
    name: 'How her father died',
    kind: 'character',
    trap: 'father',
    flaw: 'She thought of her father in his last illness, the fever that had kept him in his bed all that winter until it took him.',
    why: 'Her father drowned through the ice below Corran Weir (scenes 2, 13, 31); it was her mother who died of a fever.',
    card: { present: ['tamsin'], location: 'clockhouse', when: `${AFTER}, night`, title: 'The workshop at night' },
    paragraphs: [
      'When the others had gone up, Tamsin sat on in the workshop with the lamp turned low. The great clock’s old escapement pin lay on Pim’s bench where he had left it, sheared clean through, a little bright crescent of brass that had stopped a whole city.',
      'She thought of her father in his last illness, the fever that had kept him in his bed all that winter until it took him. She thought of his square hand in the ledger, and of all the years she had kept the books after him and never once looked at the page he had sewn shut.',
      'Outside, the river was breaking up. She could hear it through the shutters, a long low grinding, like something very large turning over in its sleep.'
    ]
  },
  {
    id: 'X6',
    name: 'What Kit could know',
    kind: 'character',
    trap: 'secret',
    flaw: '‘The old woman told you his heart won’t last the summer,’ Kit said. ‘I heard her. I’m sorry.’',
    why: 'Isla told Tamsin in Hollish, and Kit understood not a word (scene 27); Tamsin has told no one.',
    card: { present: ['tamsin', 'kit'], location: 'clockhouse', when: `${AFTER}, evening`, title: 'Leckie’s share' },
    paragraphs: [
      'Tamsin was writing to Edwin Leckie, slowly, choosing every word. The house was his as much as hers, she wrote; his share was waiting for him; the great clock was going again and Pim was keeping it.',
      'Kit read nothing over her shoulder, but he watched her face. When she put the pen down he said, ‘You’re writing to him as if he’ll come back.’',
      '‘The old woman told you his heart won’t last the summer,’ Kit said. ‘I heard her. I’m sorry.’',
      'Tamsin folded the letter in three and pressed the crease flat with her thumbnail, and did not answer him.'
    ]
  },
  {
    id: 'X7',
    name: 'A pigeon to Hollin',
    kind: 'world',
    trap: 'rule',
    flaw: 'That afternoon Orla let one of the Callowmere birds go from the loft with a letter for Leckie, and it flew north for Hollin as straight as a thrown stone.',
    why: 'Guild pigeons fly only home to their own loft (scene 7): a Callowmere bird can’t carry a letter to Hollin.',
    card: { present: ['tamsin', 'orla'], location: 'loft', when: `${AFTER}, afternoon`, title: 'Word for Leckie' },
    paragraphs: [
      'The loft smelled of grain and warm feathers, and Orla Finch was in a good temper for once, because the guild had paid her winter fees in full and early.',
      '‘Your three came home,’ she said. ‘Every one. I’ve kept the tubes for you.’',
      'Tamsin thanked her and asked how a letter might get to Hollin before the road was open. That afternoon Orla let one of the Callowmere birds go from the loft with a letter for Leckie, and it flew north for Hollin as straight as a thrown stone. They stood together at the hatch and watched it until it was a speck over the river, and then nothing.'
    ]
  },
  {
    id: 'X8',
    name: 'Which way Hollin is',
    kind: 'world',
    trap: 'river',
    flaw: 'Somewhere four days south of them, beyond Dunmere and the lake, Leckie would be sitting by Bettany’s stove.',
    why: 'Hollin is four days north, upriver (scenes 4 and 8).',
    card: { present: ['tamsin', 'kit'], location: 'clockhouse', when: `${AFTER}, dusk`, title: 'The river stairs' },
    paragraphs: [
      'They sat on the river stairs behind the house with their coats round them, watching the plates of ice go grinding past on the brown water. Kit threw a pebble and it skittered across a floe and stopped.',
      'Somewhere four days south of them, beyond Dunmere and the lake, Leckie would be sitting by Bettany’s stove. Tamsin wondered whether he had had her letter yet, and whether he had laughed.',
      '‘Summer,’ Kit said, as if they had been talking about it. ‘The lake’s blue in summer. You won’t believe it.’',
      '‘I’ll believe it when I see it,’ she said, and he laughed, and threw another pebble.'
    ]
  },
  {
    id: 'X9',
    name: 'How long the road is',
    kind: 'timeline',
    trap: 'river',
    flaw: 'It seemed impossible now that a single day on the ice had carried her all the way to Hollin, back in midwinter.',
    why: 'Hollin is four days north on the ice (scene 8); the journey took five (scenes 9 to 21).',
    card: { present: ['tamsin'], location: 'clockhouse', when: `${AFTER}, morning`, title: 'The map' },
    paragraphs: [
      'Pim had found an old map of the river in the attic and pinned it to the workshop wall, and Tamsin stood in front of it with her tea going cold, tracing the Varrow north with one finger: Ambry, Corran Weir, the long blue stain of Lake Dun, and the valley climbing away to Hollin.',
      'It seemed impossible now that a single day on the ice had carried her all the way to Hollin, back in midwinter. The map was very small and very flat, and it knew nothing about the cold.',
      'She found the place below the weir with her fingertip and held it there a while. Then Pim called from the yard that the cart had come with the new bell rope, and she went out to him.'
    ]
  },
  {
    id: 'X10',
    name: 'The watch back',
    kind: 'timeline',
    trap: 'watch',
    flaw: 'She took her father’s silver watch from her pocket, wound it, and set it by the great clock across the river.',
    why: 'She pawned the watch at Dunmere (scene 18) and it was sold (scene 30): she has no watch.',
    card: { present: ['tamsin', 'pim'], location: 'clockhouse', when: `${AFTER}, noon`, title: 'Noon' },
    paragraphs: [
      'At noon the great clock struck across the river, twelve slow strokes that rolled over the roofs of Gilt Street and set the pigeons up from the gutters, and every clock in the workshop answered it a beat behind, like children in a schoolroom.',
      'She took her father’s silver watch from her pocket, wound it, and set it by the great clock across the river. Pim, at his bench, was setting the workshop clocks the same way, one after another, his tongue between his teeth.',
      '‘There,’ he said at last, when the room had stopped arguing with itself. ‘Now we’re all telling the same lie.’'
    ]
  },
  {
    id: 'X11',
    name: 'Inside Slade’s head',
    kind: 'style',
    trap: 'pov',
    flaw: 'Across the river, in his shuttered house, Corvin Slade sat by a dead fire and thought that he had never hated anyone as much as he hated Aldous Orr’s daughter.',
    why: 'The whole book is told from Tamsin’s view only: she can’t know what Slade thinks alone in his house.',
    card: { present: ['tamsin'], location: 'clockhouse', when: `${AFTER}, night`, title: 'Shutters' },
    paragraphs: [
      'Tamsin closed the shutters of the counting room against the wet night and stood for a moment with her hand on the bar. The guild had sealed the Warden’s rooms that afternoon; his books were to be read aloud at the next sitting, page by page.',
      'Across the river, in his shuttered house, Corvin Slade sat by a dead fire and thought that he had never hated anyone as much as he hated Aldous Orr’s daughter. He turned the silver head of his cane round and round in his hand and did not light a lamp.',
      'Tamsin took her candle up the stairs. Pim’s door was open a crack, and she pulled it to on her way past, the way she had every night since he was six.'
    ]
  },
  {
    id: 'X12',
    name: 'Modern words',
    kind: 'style',
    trap: 'register',
    flaw: '‘Okay, so the guild totally owes us a new bell rope,’ Pim said. ‘Like, at the very least.’',
    why: 'The story’s speech has no modern slang anywhere.',
    card: { present: ['tamsin', 'pim'], location: 'clockhouse', when: `${AFTER}, morning`, title: 'The bell rope' },
    paragraphs: [
      'Pim came down from the Guildhall tower with grease to the elbows and a frayed end of rope in his fist, and threw it on the kitchen table among the bread and the cheese.',
      '‘Okay, so the guild totally owes us a new bell rope,’ Pim said. ‘Like, at the very least.’',
      'Tamsin moved the bread out of the way of the rope. ‘Then write it on the bill,’ she said, and only remembered afterwards that he couldn’t, and that she would write it for him, as she always had, and that she didn’t mind at all.'
    ]
  },
  // Controls: no flaw.
  {
    id: 'N1',
    name: 'The healed wrist',
    kind: 'detail',
    trap: 'wrist',
    decoy: 'She lifted the box of brass wheels down from the high shelf with both hands, and her right wrist, which had been a month in its splint, gave no more than a twinge.',
    why: 'The splint came off on day 33 (scene 26); by day 50 the wrist is healed. Using it is a change shown, not a slip.',
    card: { present: ['tamsin', 'pim'], location: 'clockhouse', when: `${AFTER}, morning`, title: 'The high shelf' },
    paragraphs: [
      'Pim wanted the old wheels for the tower, the ones their father had cast and never used, and they were on the top shelf of the stockroom where nobody had touched them in eleven years.',
      'She lifted the box of brass wheels down from the high shelf with both hands, and her right wrist, which had been a month in its splint, gave no more than a twinge. Pim took it from her and set it on the bench and opened it as if it held jewels.',
      '‘He meant them for the bells,’ he said. ‘Look. He’s scratched the notes on them.’',
      'She looked. Their father’s marks were there on every rim, tiny and square, and for a while neither of them said anything at all.'
    ]
  },
  {
    id: 'N2',
    name: 'Pim knows now',
    kind: 'character',
    trap: 'secret',
    decoy: 'Pim had not stopped talking about the debt since the night she told him; now he wanted the guild to pay the house interest on eleven years of it.',
    why: 'Tamsin told Pim everything on day 45 (scene 35), and the whole guild heard it at the Reckoning.',
    card: { present: ['tamsin', 'pim'], location: 'clockhouse', when: `${AFTER}, supper`, title: 'Interest' },
    paragraphs: [
      'Pim had not stopped talking about the debt since the night she told him; now he wanted the guild to pay the house interest on eleven years of it. He had worked out the sum on the back of a clock face in chalk, and the numbers ran right round the dial.',
      '‘They won’t pay it,’ Tamsin said.',
      '‘They should.’',
      '‘They should,’ she agreed, and cut him another slice of bread, and let him talk, because he was seventeen and furious on their father’s behalf, and she found that she did not want him to stop.'
    ]
  },
  {
    id: 'N3',
    name: 'Five dogs',
    kind: 'detail',
    trap: 'dogs',
    decoy: 'Kit’s five dogs lay in a heap by the yard wall, Hob on top as usual, and the place at the back of the team where Tansy used to run was simply not there any more.',
    why: 'Tansy stayed at Dunmere on day 11 (scene 18); five dogs is right.',
    card: { present: ['tamsin', 'kit'], location: 'clockhouse', when: `${AFTER}, afternoon`, title: 'The dogs' },
    paragraphs: [
      'Kit’s five dogs lay in a heap by the yard wall, Hob on top as usual, and the place at the back of the team where Tansy used to run was simply not there any more. Kit said Hanne would have her fat by the summer, and that he would go and see.',
      'Tamsin brought out the scraps from the kitchen and the heap came apart at once into five separate and very interested dogs.',
      '‘You’re spoiling them,’ Kit said.',
      '‘They pulled me out of a river,’ said Tamsin. ‘They can be spoiled.’'
    ]
  },
  {
    id: 'N4',
    name: 'Wilmot changed sides',
    kind: 'character',
    trap: 'secret',
    decoy: 'Dace Wilmot came to the door with his hat in his hands and asked whether the house needed a clerk, now that he no longer worked for the Warden.',
    why: 'Wilmot turned on Slade and testified at the Reckoning (scene 38): a changed loyalty shown on the page, not a slip.',
    card: { present: ['tamsin', 'wilmot'], location: 'clockhouse', when: `${AFTER}, morning`, title: 'A clerk at the door' },
    paragraphs: [
      'Dace Wilmot came to the door with his hat in his hands and asked whether the house needed a clerk, now that he no longer worked for the Warden. His green coat had been brushed, and someone had darned the elbow badly.',
      'Tamsin looked at him for a long moment. He had held a knife in Bettany’s kitchen; he had also stood up in the Guildhall when no one else would.',
      '‘The house has a bookkeeper,’ she said.',
      '‘So I hear,’ said Wilmot, and almost smiled, and put his hat back on, and went away down Gilt Street in the rain.'
    ]
  },
  {
    id: 'N5',
    name: 'A quiet scene',
    kind: 'world',
    trap: 'river',
    why: 'Nothing in it breaks the story: the thaw, the river running south, the clock going.',
    card: { present: ['tamsin', 'kit'], location: 'clockhouse', when: `${AFTER}, dusk`, title: 'The thaw' },
    paragraphs: [
      'The river ran high and brown under the Chain Bridge, carrying the last of the winter down to the sea in rafts of grey ice. From the river stairs behind the clock-house Tamsin and Kit watched a whole fish-hut go past, turning slowly, its little stovepipe still standing.',
      '‘Someone’s going to miss that,’ Kit said.',
      'Across the water the Guildhall’s windows had caught the last of the light, and above them the great clock showed a quarter to six, which it was. Tamsin found that she kept looking up at it to make sure.',
      '‘It won’t stop,’ Kit said, watching her.',
      '‘I know,’ said Tamsin, and looked again.'
    ]
  },
  {
    id: 'N6',
    name: 'The watch remembered',
    kind: 'timeline',
    trap: 'watch',
    decoy: 'her hand went to her pocket for her father’s watch before she remembered, again, that a drover was carrying it to the coast.',
    why: 'Reaching for a watch she no longer has, and remembering it is gone, is right (scenes 18 and 30).',
    card: { present: ['tamsin', 'pim'], location: 'clockhouse', when: `${AFTER}, evening`, title: 'The hour' },
    paragraphs: [
      'Pim asked her the hour from the top of the stairs, and her hand went to her pocket for her father’s watch before she remembered, again, that a drover was carrying it to the coast. She told him to look at one of the forty clocks in the workshop, and he laughed at himself and did.',
      'She stood in the hall a while afterwards with her hand still in her empty pocket. It did not hurt as much as it had at Dunmere. It hurt in a smaller, plainer way, like a tooth that has been pulled.'
    ]
  }
]

// The decoy passage N1 must have its decoy sentence; the code reads `flaw ?? decoy` as the sentence to look for.
for (const x of PLANTED) {
  if (!x.flaw && !x.decoy && x.id !== 'N5') throw new Error(`Planted passage ${x.id} has neither a flaw nor a decoy.`)
}
