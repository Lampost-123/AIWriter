// Story version 3: "The Salt Road", a long story (30 scenes in 7 chapters) written by a live model through the app's
// own Generate, from this hand-written outline (Adam, 2026-10-07: "make the story much longer and have a live DeepSeek
// Flash write it, for a real-world test"). Version 2's nine short scenes fit whole in what the writer is shown, so the
// memory never mattered; here every fact a probe tests is far from it: chapters back, or early in a long scene.
//
// The outline is invented. `npm run traps:write` (write.ts) has the model write each scene in order from its card, with
// the scene's planted events given as the draft's direction (never on the card, so a later probe's card gives nothing
// away), checks that each planted event really happened (a sentence that matches, else one judge call) and that the
// scene keeps to everything earlier scenes made true (the guards), writes it again if not (twice at most), and freezes
// the finished story in story-v3.json with the exact sentence where each trap became true. Scoring loads that file.
//
// The traps (true from the scene named, tested in chapter 6 or 7):
//   burn      s2   Wren's LEFT forearm is burned pulling the survey case from a fire.
//   promise   s3   Wren promises Pell, the ferryman's daughter, a blue glass bead from Harrowgate. Bought s13, given s26.
//   horse     s4   Wren buys a dun mare, Thistle. s9: Thistle goes lame and stays at Hobb's Farm; Wren rides Ash's grey
//                  gelding Cinder from then on. Later cards just say "ride".
//   compass   s7   Wren gives her grandmother's brass compass to the bridge-keeper as a toll. She never has it again.
//   scar      s8   A knife cuts Ash's LEFT cheek; by s14 it is a thin scar.
//   knows     s6   Wren tells only Ash that the survey shows old silver workings under Carrow Fell; s15 Ash tells Bryn.
//                  Sela, Oskar, Pell and Gale never learn it (s10: Sela is told Wren is a wool buyer; s21: Gale learns
//                  who Wren is, but not what the survey shows).
//   clothing  s24  Early in a long scene Wren takes off her oilskin coat and boots; she stays barefoot, coat off, to its end.
//   rooms     s27  Early in a long scene Bryn takes the horses to the smith and doesn't come back before it ends.

import type { PatternCheck } from './patterns'
import type { Check, Tripwire } from './story'

/** Bump when the outline, the probes or the checks change: a story written from another outline version won't load. */
export const OUTLINE_VERSION = 1

/**
 * Bump when the probes or their checks change (the written story stays the same): reports say "probes vN", and runs
 * with different probe versions don't compare. 1: round 3. 2 (7 October 2026): each probe aimed at its traps, and the
 * quick checks tightened so a mention isn't a slip. 3 (7 October 2026, after round 4's diagnosis): B1's page ends
 * before the bead is first mentioned in its scene (round 4's page already showed it given), and Bryn reported by
 * someone else ("'Bryn said it wasn't hers to know'") is not Bryn speaking.
 */
export const PROBES_VERSION = 3

export const TRAPS3 = [
  { id: 'burn', name: 'An injury chapters back', tests: "Wren's left forearm, burned in chapter 1, is still the left one in chapter 7." },
  { id: 'horse', name: 'A horse changed and named', tests: 'Thistle went lame in chapter 2 and stayed behind; Wren rides Cinder, a grey gelding, ever since.' },
  { id: 'compass', name: 'An item given away', tests: 'The brass compass given as a toll in chapter 2 is gone for good, even in fog on the fell.' },
  { id: 'scar', name: 'A scar on one side', tests: "Ash's scar is on his left cheek." },
  { id: 'promise', name: 'A promise made in chapter 1', tests: 'The bead promised to Pell in chapter 1 is given when Wren meets her again in chapter 6, and is gone after.' },
  { id: 'knows', name: 'Who knows what', tests: 'Only Ash and Bryn know the survey shows silver; Oskar, Pell and Gale never learn it.' },
  { id: 'clothing', name: 'Clothes off early in a long scene', tests: 'Coat and boots taken off early in a long scene stay off at its end, far beyond what Continue is shown.' },
  { id: 'rooms', name: 'Someone gone early in a long scene', tests: 'Bryn, gone to the smith early in a long scene, is not in the room at its end.' }
]

export interface Entry3 {
  key: string
  kind: 'character' | 'place' | 'item'
  name: string
  aliases?: string[]
  summary: string
  description?: string
  fields?: Record<string, string>
}

export const STORY3 = {
  title: 'The Salt Road',
  premise:
    "When her old master dies, a surveyor's apprentice must carry his last survey across the country and register it at the Carrow Assize before the Warden's men can take it from her."
}

export const CHAPTERS3 = [
  { title: 'Linmouth', goal: 'Wren takes the survey and gets away from Gale.' },
  { title: 'The Drove Road', goal: 'Wren travels with Ash and his cattle towards Harrowgate.' },
  { title: 'Harrowgate', goal: 'Wren learns what registering the claim takes, under a false name.' },
  { title: 'Bryn', goal: "Ash's cousin joins them, and they leave the city." },
  { title: 'The Way Back', goal: 'They turn west for Carrow by the old ferry, with Gale behind them.' },
  { title: 'The Ferry', goal: 'Storm, the moor and the crossing.' },
  { title: 'Carrow Fell', goal: 'Wren registers the claim.' }
]

export const ENTRIES3: Entry3[] = [
  {
    key: 'wren',
    kind: 'character',
    name: 'Wren Hollis',
    aliases: ['Wren'],
    summary: "A surveyor's apprentice, twenty-two, carrying her late master's last survey to the Carrow Assize.",
    fields: {
      pronouns: 'she/her',
      age: '22',
      role: 'protagonist',
      build: 'small and quick',
      hair: 'red-brown, tied back',
      eyes: 'hazel',
      clothing: 'an oilskin coat over a knitted jumper, breeches and riding boots',
      traits: 'Careful, stubborn, honest to a fault, keeps her promises.',
      speech: 'Plain and precise; thinks before she speaks.',
      wants: 'To see her master Edric’s last survey registered in his name and hers.'
    }
  },
  {
    key: 'ash',
    kind: 'character',
    name: 'Ash Penrose',
    aliases: ['Ash'],
    summary: 'A drover, thirty, taking cattle to Harrowgate; easy-going, brave, too fond of talking.',
    fields: { pronouns: 'he/him', age: '30', role: 'supporting', build: 'tall and rangy', traits: 'Warm, reckless, loyal once he likes you.', speech: 'Drawling, joking, full of drovers’ sayings.' }
  },
  {
    key: 'bryn',
    kind: 'character',
    name: 'Bryn Tally',
    aliases: ['Bryn'],
    summary: "Ash's cousin, a carter and farrier from Harrowgate; blunt and practical.",
    fields: { pronouns: 'she/her', age: '34', role: 'supporting', traits: 'Blunt, practical, suspicious of strangers.', speech: 'Short, flat, no nonsense.' }
  },
  {
    key: 'sela',
    kind: 'character',
    name: 'Sela Marr',
    aliases: ['Sela'],
    summary: "Keeps the Drover's Rest in Harrowgate; kind, curious, a gossip.",
    fields: { pronouns: 'she/her', age: '50', role: 'minor', speech: 'Chatty and warm, always asking questions.' }
  },
  {
    key: 'gale',
    kind: 'character',
    name: 'Gale',
    aliases: ['Master Gale'],
    summary: "Warden Vey's agent, sent to get Edric's survey; smooth, patient and ruthless.",
    fields: { pronouns: 'he/him', age: 'forty-odd', role: 'antagonist', speech: 'Soft, courteous, never in a hurry.' }
  },
  {
    key: 'vey',
    kind: 'character',
    name: 'Warden Corran Vey',
    aliases: ['the Warden', 'Vey'],
    summary: 'Warden of the western fells, who wants the land around Carrow Fell for himself.',
    fields: { pronouns: 'he/him', role: 'antagonist (offstage)' }
  },
  {
    key: 'oskar',
    kind: 'character',
    name: 'Oskar Venn',
    aliases: ['Oskar'],
    summary: 'The ferryman on the River Linn below Linmouth; grumbling, honest, poor.',
    fields: { pronouns: 'he/him', age: '60', role: 'minor', speech: 'Grumbling, few words.' }
  },
  {
    key: 'pell',
    kind: 'character',
    name: 'Pell Venn',
    aliases: ['Pell'],
    summary: "Oskar's daughter, nine, who helps on the ferry and loves bright things.",
    fields: { pronouns: 'she/her', age: '9', role: 'minor', speech: 'Bold, quick questions.' }
  },
  {
    key: 'agate',
    kind: 'character',
    name: 'Mother Agate',
    aliases: ['Agate'],
    summary: 'The old bridge-keeper at Haldon Bridge, who takes a toll from everyone.',
    fields: { pronouns: 'she/her', age: '70', role: 'minor', speech: 'Sharp and bargaining.' }
  },
  {
    key: 'ide',
    kind: 'character',
    name: 'Magistrate Ide',
    aliases: ['Ide'],
    summary: 'The magistrate of the Carrow Assize; dry, fair and slow.',
    fields: { pronouns: 'he/him', age: '65', role: 'minor' }
  },
  { key: 'linmouth', kind: 'place', name: 'Linmouth', summary: 'A small harbour town at the mouth of the River Linn, where Edric the surveyor lived.' },
  { key: 'ferry', kind: 'place', name: "Oskar's ferry", aliases: ['the Linn ferry'], summary: 'A rope ferry across the wide River Linn below Linmouth, kept by Oskar Venn.' },
  { key: 'fallow', kind: 'place', name: 'Fallow Cross', summary: 'A market village with a horse fair, a day east of the Linn.' },
  { key: 'droveroad', kind: 'place', name: 'The Drove Road', summary: 'The old grass road the drovers use between the coast and Harrowgate, through beech woods and moor.' },
  { key: 'haldon', kind: 'place', name: 'Haldon Bridge', summary: 'A narrow stone toll bridge on the Drove Road, kept by Mother Agate.' },
  { key: 'hobbs', kind: 'place', name: "Hobb's Farm", summary: 'A hill farm beside the Drove Road.' },
  { key: 'harrowgate', kind: 'place', name: 'Harrowgate', summary: 'A walled market city, with the Assay Office and a great Thursday market.' },
  { key: 'drovers', kind: 'place', name: "The Drover's Rest", summary: "A drovers' inn by the cattle market in Harrowgate, kept by Sela Marr." },
  { key: 'moor', kind: 'place', name: 'Linmouth Moor', summary: 'High, bare moor above the Linn valley, with a shepherd’s hut near the old cairn.' },
  { key: 'carrow', kind: 'place', name: 'Carrow', summary: 'A grey market town under Carrow Fell, where the Assize sits.' },
  { key: 'wheatsheaf', kind: 'place', name: 'The Wheatsheaf', summary: 'An inn on the market square at Carrow.' },
  { key: 'fell', kind: 'place', name: 'Carrow Fell', summary: 'A high, boggy fell above Carrow, often in fog, with old mine workings forgotten on its north side.' },
  {
    key: 'survey',
    kind: 'item',
    name: "Edric's survey",
    aliases: ['the survey', 'the survey case'],
    summary: "Master Edric's last survey of Carrow Fell: maps and notes in a leather case.",
    fields: { category: 'map' }
  },
  {
    key: 'compass',
    kind: 'item',
    name: 'The brass compass',
    aliases: ["Wren's compass"],
    summary: "Wren's grandmother's brass pocket compass, her one keepsake.",
    fields: { category: 'keepsake' }
  }
]

/** A planted event: what the writer is asked to make happen, and how to find the sentence where it does. */
export interface Plant {
  id: string
  trap: string
  /** Told to the writer as the draft's direction (never put on the card). */
  says: string
  /** A sentence matching all of these (and none of `none`) is where it happens. */
  find: RegExp[]
  none?: RegExp[]
  /** Asked of the judge when no sentence matches (good answer "yes"). */
  judge?: string
  /** It must happen in the first third of the scene. */
  early?: boolean
  /** After it happens, nothing in the scene may break this (it holds to the scene's end). */
  holds?: Pick<PatternCheck, 'broken' | 'not' | 'unlessBefore'>
}

export interface Card3 {
  pov: string
  present: string[]
  location: string
  when: string
  beats: string[]
  goal?: string
  mood?: string
}

export interface Scene3 {
  key: string
  chapter: number
  title: string
  card: Card3
  /** Length asked for, in words. */
  words: number
  plants: Plant[]
}

const RIGHT_SIDE_HURT =
  /\bright (?:fore)?arm\b(?:(?!\bleft\b)[^,.!?;\n]){0,40}\b(?:burn\w*|scald\w*|scar\w*|bandag\w*|blister\w*|sear\w*|wound\w*)\b(?!\s+left\b)|\b(?:burn\w*|scald\w*|scar\w*|bandag\w*|blister\w*|seared|wounded)(?:\s+(?!left\b)\w+){0,3}?\s+right (?:fore)?arm\b/i

/** The checks that keep the story true (guards while it is written, and checks when it is scored). */
export const PATTERNS = {
  burn: {
    id: 'burn',
    trap: 'burn',
    what: "Wren's burn is put on her right arm.",
    broken: RIGHT_SIDE_HURT,
    touches: /\b(?:burn\w*|scald\w*|bandag\w*|scar\w*)\b[^.!?\n]{0,40}\b(?:arm|forearm|wrist)\b|\b(?:arm|forearm|wrist)\b[^.!?\n]{0,40}\b(?:burn\w*|scald\w*|bandag\w*|scar\w*)\b/i
  },
  horse: {
    id: 'horse',
    trap: 'horse',
    what: 'Wren rides Thistle (lame and left at the farm) or a mare, not Cinder.',
    // Riding: a riding verb with Thistle or a mare as what is ridden, or Thistle doing the carrying, in one sentence.
    // A mention isn't riding ("I've got to fetch Thistle", "Thistle'll be fat as a parson").
    broken:
      /\b(?:rode|ride|rides|riding|ridden|mounted|mount|astride|urged|reined|spurred|kicked|swung (?:up )?(?:onto|into the saddle of|up on)|climbed (?:up )?(?:onto|on))\b[^.!?\n"“”]{0,30}\b(?:Thistle|(?:the|her) (?:dun )?mare)\b|\bThistle\b[^.!?\n"“”]{0,30}\b(?:under her|beneath her|carried her|bore her|picked her way|picked his way|plodded|trotted on|cantered|galloped)\b/i,
    not: /\b(?:lame|limp\w*|left (?:her|behind)|Hobb|farm|paddock|stall|remember\w*|thought of|think\w*|missed|miss|before|used to|once|wondered|old|fetch|back for|would|will|'ll|’ll|had ridden|had been)\b/i,
    touches: /\b(?:Cinder|Thistle|gelding|mare)\b/i
  },
  compass: {
    id: 'compass',
    trap: 'compass',
    what: 'Wren has or uses the brass compass she gave away.',
    // Having it: in her hand or pocket, taken out, opened, its needle read for a bearing. Not a compass in her head, a
    // memory, a wish, or the one she gave away ("the way she had walked it with the compass in her other hand").
    broken:
      /\b(?:took|pulled|drew|fished|got) (?:out )?(?:her |the |grandmother's |grandmother’s )?(?:brass )?compass\b|\b(?:checked|consulted|opened|flipped open|snapped open|held up|glanced at|squinted at|tapped|shook) (?:her |the |grandmother's |grandmother’s )?(?:brass )?compass\b|\bcompass\b[^.!?\n]{0,40}\b(?:in her (?:(?:other |left |right )?hand|palm|fingers|pocket|fist)|from her (?:pocket|coat|pack|jacket)|needle (?:swung|settled|pointed|trembled|quivered)|bearing)\b/i,
    not: /\b(?:no longer|gave|given|give|traded|toll|Agate|without|wish\w*|missed|miss|had not|hadn't|hadn’t|didn't|didn’t|did not|gone|lost|left (?:it|behind|with)|cord|neck|once|used to|would have|if only|instead|remember\w*|thought of|in her (?:head|mind)|out of her head|the way she had|had (?:\w+ )?(?:walked|held|used|carried|done))\b|\bcompass (?:rose|points?)\b|\b(?:points?|quarters?) of the compass\b|\blike a compass\b/i,
    touches: /\bcompass\b|\b(?:bearings?|north|which way)\b/i
  },
  scar: {
    id: 'scar',
    trap: 'scar',
    what: "Ash's scar is put on his right cheek.",
    broken: /\b(?:scar\w*|cut|seam|wound)\b[^.!?\n]{0,50}\bright cheek\b|\bright cheek\b[^.!?\n]{0,50}\b(?:scar\w*|cut|seam|wound)\b/i,
    touches: /\b(?:scar\w*|cheek)\b/i
  },
  bead: {
    id: 'bead',
    trap: 'promise',
    what: 'Wren still has the bead she gave Pell.',
    // Having it: in her pocket or hand, or handled. A memory of giving it isn't having it.
    broken:
      /\bbead\b[^.!?\n]{0,40}\b(?:in her (?:pocket|hand|palm|fingers|purse)|from her (?:pocket|purse|pack))\b|\b(?:fingered|turned|rolled|touched|felt for|held|took out|pulled out|found|gave Bryn|offered Bryn|pressed)\b[^.!?\n]{0,30}\b(?:blue |glass )*bead\b/i,
    // Not the gift: "a bead of sweat"; nor Pell's bead remembered.
    not: /\b(?:Pell|gave|given|give|promise\w*|girl|child|word|kept|remember\w*|thought of)\b|\bbeads? of\b/i,
    touches: /\bbead\b|\bpockets?\b/i
  },
  brynBack: {
    id: 'bryn',
    trap: 'rooms',
    what: 'Bryn speaks or acts in the room without coming back first.',
    // Someone telling what Bryn said ("'Bryn says that...'", "'Bryn said you'd have it out on every table'") is speech,
    // not Bryn in the room: only the narration counts.
    outsideQuotes: true,
    broken:
      /\bBryn (?:said|says|asked|called|muttered|answered|replied|whispered|told|laughed|snapped|grinned|nodded|shrugged|sat|stood|leaned|poured|drank)\b|\b(?:said|asked|called|muttered|answered|replied|whispered|snapped) Bryn\b/i,
    not: /\b(?:would|might|hoped|wondered|thought|remember\w*|smith|forge|when|until|before|if)\b/i,
    unlessBefore: /\bBryn\b[^.!?\n]{0,80}\b(?:came back|came in|returned|back in|walked in|stepped in|was back|ducked in|reappeared|pushed in)\b|\b(?:door|latch)\b[^.!?\n]{0,60}\bBryn\b/i,
    touches: /\bBryn\b/i
  },
  bootsOn: {
    id: 'boots',
    trap: 'clothing',
    what: 'Wren walks in her boots or wears her coat again without putting them on.',
    broken:
      /\bher boots\b[^.!?\n]{0,25}\b(?:crunched|rang|thudded|scraped|squelched|clattered|sank|creaked|on the)\b|\b(?:buttoned|fastened|pulled|drew|tugged|hugged) (?:her|the) (?:oilskin|coat)\b[^.!?\n]{0,20}\b(?:tighter|closer|around|about|up)\b|\bin her (?:oilskin|coat|boots)\b/i,
    not: /\b(?:off|drying|steam\w*|hung|hanging|by the fire|beside|peg|hook|dripping)\b/i,
    unlessBefore: /\b(?:pulled|tugged|put|drew|laced|shrugged|struggled|forced)\s+(?:on\s+)?(?:her\s+)?(?:wet\s+|damp\s+|cold\s+)?(?:boots|coat|oilskin)\b|\b(?:boots|coat|oilskin)\s+back\s+on\b/i,
    touches: /\b(?:boots|coat|oilskin|barefoot|bare feet|stockings)\b/i
  }
} satisfies Record<string, PatternCheck>

/** While the story is written, each scene from `from` on (but not those in `except`) may not break these. */
export const GUARDS3: { from: string; except?: string[]; check: Pick<PatternCheck, 'id' | 'broken' | 'not' | 'unlessBefore'> }[] = [
  { from: 's2', check: PATTERNS.burn },
  { from: 's8', except: ['s18'], check: PATTERNS.compass },
  // Scene 20 visits Thistle in her paddock on purpose.
  { from: 's10', except: ['s20'], check: PATTERNS.horse },
  { from: 's8', check: PATTERNS.scar },
  { from: 's27', check: PATTERNS.bead }
]

const LEFT_ARM_BURN: Plant = {
  id: 'burn',
  trap: 'burn',
  says: "Make sure this happens on the page: pulling the survey case out of the fire, Wren burns her LEFT forearm, a long burn from wrist to elbow (her right arm is unhurt). Someone or she herself binds it.",
  find: [/\bleft (?:fore)?arm\b/i, /\b(?:burn\w*|scald\w*|blister\w*|sear\w*)\b/i],
  judge: "Does the scene show Wren's LEFT forearm (not her right) being burned?"
}

export const SCENES3: Scene3[] = [
  // ----- Chapter 1: Linmouth -----
  {
    key: 's1',
    chapter: 0,
    title: "The surveyor's house",
    card: {
      pov: 'wren',
      present: ['wren', 'gale'],
      location: 'linmouth',
      when: 'Late spring, day 1, evening',
      beats: [
        'Wren comes home to find her old master Edric dead in his chair by the window, peacefully, his last survey of Carrow Fell finished on the table.',
        "She reads his note: the survey must be registered at the Carrow Assize before midsummer, in his name and hers.",
        "A soft-spoken stranger, Gale, calls at the door asking to buy 'the Carrow papers' for the Warden; Wren says there are none and shuts the door."
      ],
      goal: 'Wren keeps the survey.',
      mood: 'Grief, then unease.'
    },
    words: 1500,
    plants: []
  },
  {
    key: 's2',
    chapter: 0,
    title: 'Fire in the night',
    card: {
      pov: 'wren',
      present: ['wren'],
      location: 'linmouth',
      when: 'Day 1, night',
      beats: [
        "Men break into the house in the dark while Wren hides upstairs with the survey case.",
        'In the struggle a lamp is knocked over and the study catches fire; Wren drops the survey case and has to pull it out of the flames.',
        'She escapes through the back garden with the survey case and runs for the river.'
      ],
      mood: 'Fear and smoke.'
    },
    words: 1500,
    plants: [LEFT_ARM_BURN]
  },
  {
    key: 's3',
    chapter: 0,
    title: "Oskar's ferry",
    card: {
      pov: 'wren',
      present: ['wren', 'oskar', 'pell'],
      location: 'ferry',
      when: 'Day 2, dawn',
      beats: [
        'At dawn Wren reaches the Linn ferry; Oskar the ferryman grumbles but takes her across for her last coins.',
        "His daughter Pell, nine, chatters to her all the way across and admires Wren's things.",
        'On the far bank Wren sets off east, alone.'
      ],
      mood: 'Cold, grey, a little kindness.'
    },
    words: 1400,
    plants: [
      {
        id: 'promise',
        trap: 'promise',
        says: 'Make sure this happens on the page: before they part, Wren promises Pell that she will bring her a blue glass bead from the market at Harrowgate.',
        find: [/\bbead\b/i, /\b(?:promise\w*|bring|word|swear)\b/i],
        judge: 'Does Wren promise Pell that she will bring her a blue glass bead from Harrowgate?'
      }
    ]
  },
  {
    key: 's4',
    chapter: 0,
    title: 'The horse fair',
    card: {
      pov: 'wren',
      present: ['wren', 'ash'],
      location: 'fallow',
      when: 'Day 3',
      beats: [
        'At the horse fair at Fallow Cross Wren sells her grandfather’s watch and buys a horse.',
        'A drover, Ash Penrose, helps her bargain, and offers to let her travel with his cattle as far as Harrowgate.',
        'They set out together on the Drove Road.'
      ],
      mood: 'Bright, noisy, hopeful.'
    },
    words: 1400,
    plants: [
      {
        id: 'thistle',
        trap: 'horse',
        says: 'Make sure this happens on the page: the horse Wren buys is a dun mare named Thistle.',
        find: [/\bThistle\b/],
        judge: 'Does Wren buy a dun mare called Thistle?'
      }
    ]
  },
  // ----- Chapter 2: The Drove Road -----
  {
    key: 's5',
    chapter: 1,
    title: 'Goose grease',
    card: {
      pov: 'wren',
      present: ['wren', 'ash'],
      location: 'droveroad',
      when: 'Day 4',
      beats: ['A long day behind the cattle on the Drove Road.', "Ash dresses Wren's burn with goose grease and clean linen.", 'She tells him she is a surveyor’s apprentice, but not what she carries.'],
      mood: 'Easy, sunlit.'
    },
    words: 1400,
    plants: []
  },
  {
    key: 's6',
    chapter: 1,
    title: 'The bothy',
    card: {
      pov: 'wren',
      present: ['wren', 'ash'],
      location: 'droveroad',
      when: 'Day 4, night',
      beats: ['They shelter in a stone bothy; the cattle settle outside.', "Ash asks straight out why men burned her master's house.", 'Wren decides to trust him.'],
      mood: 'Firelight, trust.'
    },
    words: 1400,
    plants: [
      {
        id: 'secret-ash',
        trap: 'knows',
        says: "Make sure this happens on the page: Wren tells Ash, and only Ash, that her master's survey shows old silver workings under the north side of Carrow Fell, which is why the Warden wants it. She asks him to tell no one.",
        find: [/\bsilver\b/i, /\b(?:working|workings|seam|lode|mine|mines|adit)\b/i],
        judge: 'Does Wren tell Ash that the survey shows old silver workings under Carrow Fell?'
      }
    ]
  },
  {
    key: 's7',
    chapter: 1,
    title: 'Haldon Bridge',
    card: {
      pov: 'wren',
      present: ['wren', 'ash', 'agate'],
      location: 'haldon',
      when: 'Day 5',
      beats: ["At Haldon Bridge old Mother Agate demands a toll for each beast and each rider.", "Ash pays for the cattle; Wren has no coin left.", 'They cross the bridge.'],
      mood: 'Bargaining, a loss.'
    },
    words: 1400,
    plants: [
      {
        id: 'compass',
        trap: 'compass',
        says: "Make sure this happens on the page: having no coin, Wren gives Mother Agate her grandmother's brass compass as her toll, and goes on without it. It hurts to part with it.",
        find: [/\bcompass\b/i, /\b(?:gave|give|gives|hand\w*|held out|toll|took|Agate|pressed)\b/i],
        judge: "Does Wren give her grandmother's brass compass to Mother Agate as her toll?"
      }
    ]
  },
  {
    key: 's8',
    chapter: 1,
    title: 'The beech wood',
    card: {
      pov: 'wren',
      present: ['wren', 'ash'],
      location: 'droveroad',
      when: 'Day 6',
      beats: ['In a beech wood two hired men try to drag Wren off her horse and take the survey case.', 'Ash fights them off with his drover’s stick; one has a knife.', 'The men run; Wren binds Ash’s wound.'],
      mood: 'Sudden violence, then shaking.'
    },
    words: 1500,
    plants: [
      {
        id: 'ash-cut',
        trap: 'scar',
        says: "Make sure this happens on the page: the knife slashes Ash's LEFT cheek (not his right).",
        find: [/\bleft cheek\b/i],
        judge: "Is Ash cut on his LEFT cheek?"
      }
    ]
  },
  {
    key: 's9',
    chapter: 1,
    title: "Hobb's Farm",
    card: {
      pov: 'wren',
      present: ['wren', 'ash'],
      location: 'hobbs',
      when: 'Day 7',
      beats: ["Wren's horse puts a foot in a rabbit hole on the moor.", "They stop at Hobb's Farm; the farmer's wife says the injury needs weeks.", 'They go on.'],
      mood: 'Sad, practical.'
    },
    words: 1400,
    plants: [
      {
        id: 'cinder',
        trap: 'horse',
        says: "Make sure this happens on the page: Thistle goes lame and is left at Hobb's Farm to heal; Ash lends Wren his spare horse, a grey gelding called Cinder, and she rides Cinder on.",
        find: [/\bCinder\b/],
        judge: "Is Thistle left lame at Hobb's Farm while Wren rides on on Ash's grey gelding Cinder?"
      }
    ]
  },
  // ----- Chapter 3: Harrowgate -----
  {
    key: 's10',
    chapter: 2,
    title: "The Drover's Rest",
    card: {
      pov: 'wren',
      present: ['wren', 'ash', 'sela'],
      location: 'drovers',
      when: 'Day 8, evening',
      beats: ['They bring the cattle into Harrowgate and stable the horses at the Drover’s Rest.', 'Sela Marr, the landlady, asks a hundred questions.', 'Wren takes a small room under the roof.'],
      mood: 'Warm, busy, wary.'
    },
    words: 1400,
    plants: [
      {
        id: 'cover-sela',
        trap: 'knows',
        says: 'Make sure this happens on the page: Wren tells Sela she is a wool buyer from Linmouth, a lie to keep her errand secret.',
        find: [/\bwool\b/i, /\bbuy\w*\b/i],
        judge: 'Does Wren tell Sela she is a wool buyer?'
      }
    ]
  },
  {
    key: 's11',
    chapter: 2,
    title: 'The Assay Office',
    card: {
      pov: 'wren',
      present: ['wren'],
      location: 'harrowgate',
      when: 'Day 9',
      beats: ['Wren asks at the Assay Office how a survey claim is registered.', 'A sneering clerk tells her it must be laid before the Carrow Assize in person, by midsummer.', 'She counts the days left.'],
      mood: 'Frustration, resolve.'
    },
    words: 1300,
    plants: []
  },
  {
    key: 's12',
    chapter: 2,
    title: 'Questions at the inn',
    card: {
      pov: 'wren',
      present: ['wren', 'sela', 'gale'],
      location: 'drovers',
      when: 'Day 9, evening',
      beats: ['Gale arrives at the Drover’s Rest asking after a young woman from Linmouth with a leather case.', 'From the stairs Wren hears Sela tell him the only Linmouth girl here is a wool buyer.', 'Gale leaves; Wren does not sleep.'],
      mood: 'Held breath.'
    },
    words: 1400,
    plants: []
  },
  {
    key: 's13',
    chapter: 2,
    title: 'Thursday market',
    card: {
      pov: 'wren',
      present: ['wren', 'ash'],
      location: 'harrowgate',
      when: 'Day 10',
      beats: ['Ash sells his cattle at the Thursday market for a good price.', 'Wren wanders the stalls.', 'They eat hot pies on the cathedral steps.'],
      mood: 'Bustle, a breathing space.'
    },
    words: 1300,
    plants: [
      {
        id: 'bead-bought',
        trap: 'promise',
        says: 'Make sure this happens on the page: at a glass-maker’s stall Wren buys a small blue glass bead for Pell, remembering her promise.',
        find: [/\bblue\b/i, /\bbead\b/i],
        judge: 'Does Wren buy a blue glass bead for Pell?'
      }
    ]
  },
  {
    key: 's14',
    chapter: 2,
    title: 'Cousin Bryn',
    card: {
      pov: 'wren',
      present: ['wren', 'ash', 'bryn'],
      location: 'drovers',
      when: 'Day 10, evening',
      beats: ['Ash’s cousin Bryn Tally, a carter and farrier, comes to the Drover’s Rest to meet him.', 'Bryn teases Ash about his healing face and looks Wren over without warmth.', 'Bryn offers them places on her cart going west.'],
      mood: 'Prickly.'
    },
    words: 1400,
    plants: [
      {
        id: 'scar',
        trap: 'scar',
        says: "Make sure this happens on the page: the cut on Ash's LEFT cheek has healed into a thin pink scar, and someone remarks on it.",
        find: [/\bscar\b/i, /\bleft\b/i],
        judge: "Is the cut on Ash's left cheek shown healed into a scar?"
      }
    ]
  },
  // ----- Chapter 4: Bryn -----
  {
    key: 's15',
    chapter: 3,
    title: 'What Ash told',
    card: {
      pov: 'wren',
      present: ['wren', 'ash', 'bryn'],
      location: 'drovers',
      when: 'Day 11',
      beats: ['Bryn asks why a wool buyer needs to get to Carrow so badly.', 'Wren finds out Ash has said too much, and is furious with him.', 'In the end she accepts Bryn as one of them.'],
      mood: 'Anger, then a truce.'
    },
    words: 1400,
    plants: [
      {
        id: 'secret-bryn',
        trap: 'knows',
        says: "Make sure this happens on the page: Ash has told Bryn that the survey shows silver workings under Carrow Fell, so now Bryn knows the secret too.",
        find: [/\bBryn\b/, /\bsilver\b/i],
        judge: 'Does Bryn now know that the survey shows silver workings under Carrow Fell (Ash told her)?'
      }
    ]
  },
  {
    key: 's16',
    chapter: 3,
    title: "Gale's offer",
    card: {
      pov: 'wren',
      present: ['wren', 'gale'],
      location: 'drovers',
      when: 'Day 11, evening',
      beats: ['Gale finds Wren alone in the inn yard and offers twenty crowns for "the old man’s papers".', 'He does not say what is in them, and Wren sees he does not know.', 'She refuses; he smiles and says there is time.'],
      mood: 'Velvet threat.'
    },
    words: 1300,
    plants: []
  },
  {
    key: 's17',
    chapter: 3,
    title: 'The west gate',
    card: {
      pov: 'wren',
      present: ['wren', 'ash', 'bryn'],
      location: 'harrowgate',
      when: 'Day 12, before dawn',
      beats: ['They leave Harrowgate before dawn, Bryn driving her cart, Ash and Wren riding beside it.', 'Bryn decides they will go back by the Linn ferry, not the Carrow road where Gale will watch.', 'The city falls behind them.'],
      mood: 'Quiet escape.'
    },
    words: 1300,
    plants: []
  },
  {
    key: 's18',
    chapter: 3,
    title: 'The toll again',
    card: {
      pov: 'wren',
      present: ['wren', 'ash', 'bryn', 'agate'],
      location: 'haldon',
      when: 'Day 13',
      beats: ['They cross Haldon Bridge again.', 'Bryn haggles with Mother Agate and pays for all of them.', 'Mother Agate cackles that she has never had such a good toll as last time.'],
      mood: 'Wry.'
    },
    words: 1300,
    plants: [
      {
        id: 'agate-compass',
        trap: 'compass',
        says: "Make sure this happens on the page: Mother Agate is wearing Wren's old brass compass on a cord round her neck, and Wren sees it.",
        find: [/\bcompass\b/i, /\b(?:cord|neck|Agate|wore|wearing|hung)\b/i],
        judge: "Is Mother Agate shown wearing Wren's brass compass?"
      }
    ]
  },
  // ----- Chapter 5: The Way Back -----
  {
    key: 's19',
    chapter: 4,
    title: 'A cast shoe',
    card: {
      pov: 'wren',
      present: ['wren', 'ash', 'bryn'],
      location: 'droveroad',
      when: 'Day 14',
      beats: ['Rain on the Drove Road.', 'Wren’s horse casts a shoe; Bryn shoes him at the roadside from her cart’s tools.', 'Bryn and Wren talk properly for the first time.'],
      mood: 'Wet, companionable.'
    },
    words: 1400,
    plants: []
  },
  {
    key: 's20',
    chapter: 4,
    title: 'The paddock',
    card: {
      pov: 'wren',
      present: ['wren', 'ash', 'bryn'],
      location: 'hobbs',
      when: 'Day 15',
      beats: ["They pass Hobb's Farm.", 'Wren goes to the paddock fence to see her mare.', 'She decides to leave her there until she can come back for her.'],
      mood: 'Tender.'
    },
    words: 1300,
    plants: [
      {
        id: 'thistle-stays',
        trap: 'horse',
        says: 'Make sure this happens on the page: Thistle is still lame in the paddock at Hobb’s Farm; Wren strokes her and leaves her there, riding on on Cinder.',
        find: [/\bThistle\b/],
        judge: "Does Wren leave Thistle at Hobb's Farm and ride on on Cinder?"
      }
    ]
  },
  {
    key: 's21',
    chapter: 4,
    title: 'The ford',
    card: {
      pov: 'wren',
      present: ['wren', 'ash', 'bryn', 'gale'],
      location: 'droveroad',
      when: 'Day 16',
      beats: ['Gale and two riders wait at a ford.', 'Gale calls Wren by her real name and her master’s name; the wool-buyer story is finished.', 'Bryn drives the cart straight through the ford and they get away.'],
      mood: 'Danger.'
    },
    words: 1500,
    plants: [
      {
        id: 'gale-name',
        trap: 'knows',
        says: "Make sure this happens on the page: Gale now knows who Wren is (Edric's apprentice, not a wool buyer), but he still does not know what the survey shows; nobody tells him.",
        find: [/\bGale\b/, /\b(?:Edric|apprentice|Hollis)\b/i],
        judge: "Does Gale show he knows Wren is Edric's apprentice?"
      }
    ]
  },
  {
    key: 's22',
    chapter: 4,
    title: 'Words by the fire',
    card: {
      pov: 'wren',
      present: ['wren', 'ash', 'bryn'],
      location: 'droveroad',
      when: 'Day 16, night',
      beats: ['At the night camp Bryn says the claim will make Wren rich and asks for a share; Ash is angry.', 'Wren says the claim is Edric’s, and hers, and no one’s to sell.', 'They agree to cross by the Linn ferry and go over the moor to Carrow.'],
      mood: 'Tension, settled.'
    },
    words: 1400,
    plants: []
  },
  // ----- Chapter 6: The Ferry -----
  {
    key: 's23',
    chapter: 5,
    title: 'Ashes',
    card: {
      pov: 'wren',
      present: ['wren', 'ash'],
      location: 'linmouth',
      when: 'Day 17',
      beats: ["On the hill above Linmouth Wren sees the burned shell of Edric's house.", 'She goes down alone and stands in the ruin.', 'Ash comes to find her; she lets herself cry.'],
      mood: 'Grief.'
    },
    words: 1400,
    plants: []
  },
  {
    key: 's24',
    chapter: 5,
    title: "The shepherd's hut",
    card: {
      pov: 'wren',
      present: ['wren', 'ash', 'bryn'],
      location: 'moor',
      when: 'Day 17, night, a storm',
      beats: [
        'A storm drives them into a shepherd’s hut on Linmouth Moor, soaked to the skin.',
        'They light a fire, eat what they have, and dry out as best they can.',
        'Late into the night, Ash tells the story of how he became a drover, and Bryn tells a darker one about her father.',
        'Wren cannot sleep and sits by the fire going over Edric’s survey, thinking about what it will mean.'
      ],
      mood: 'Storm outside, warmth inside, long talk.'
    },
    words: 2400,
    plants: [
      {
        id: 'boots-off',
        trap: 'clothing',
        says:
          "Make sure this happens early in the scene, in its first few paragraphs: Wren takes off her soaked oilskin coat and hangs it by the fire, pulls off her boots and sets them to dry, and puts on the shepherd's old dry wool shirt; she stays barefoot, without her coat or boots, for the rest of the scene.",
        find: [/\bboots?\b/i, /\b(?:off|pulled|tugged|unlaced|kicked|dry|drying)\b/i],
        judge: 'Early in the scene, does Wren take off her coat and her boots?',
        early: true,
        holds: PATTERNS.bootsOn
      }
    ]
  },
  {
    key: 's25',
    chapter: 5,
    title: 'Down to the river',
    card: {
      pov: 'wren',
      present: ['wren', 'ash', 'bryn'],
      location: 'moor',
      when: 'Day 18, morning',
      beats: ['The storm has passed; they come down off the moor towards the Linn.', 'Bryn worries the river is too high for the ferry; Ash makes jokes.', 'From the last hill they see the ferry landing and smoke from Oskar’s chimney.'],
      mood: 'Washed clean, anxious.'
    },
    words: 1400,
    plants: []
  },
  {
    key: 's26',
    chapter: 5,
    title: 'The crossing',
    card: {
      pov: 'wren',
      present: ['wren', 'ash', 'bryn', 'oskar', 'pell'],
      location: 'ferry',
      when: 'Day 18',
      beats: [
        'At the landing Oskar says the river is too high, then agrees to take them across for double fare.',
        'The crossing is hard; the cart and horses go over in two trips while Oskar and Bryn haul on the rope.',
        'On the far bank Pell is waiting at the landing, and they say their goodbyes to her before riding on.'
      ],
      mood: 'Struggle, then warmth.'
    },
    words: 1500,
    plants: [
      {
        id: 'bead-given',
        trap: 'promise',
        says: 'Make sure this happens in the last part of the scene, on the far bank: Wren gives Pell the blue glass bead she promised her, and Pell is delighted.',
        find: [/\bbead\b/i, /\b(?:gave|gives|give|held out|pressed|put|placed|hand\w*|offered|opened)\b/i],
        judge: 'Does Wren give Pell the blue glass bead?'
      }
    ]
  },
  // ----- Chapter 7: Carrow Fell -----
  {
    key: 's27',
    chapter: 6,
    title: 'The Wheatsheaf',
    card: {
      pov: 'wren',
      present: ['wren', 'ash', 'bryn'],
      location: 'wheatsheaf',
      when: 'Day 20, evening',
      beats: [
        'They reach Carrow and take rooms at the Wheatsheaf on the market square.',
        'The landlord tells them the Assize sits the day after tomorrow, and that the Warden’s man has been asking about a survey.',
        'Over a long supper by the fire Ash and Wren talk about what they will do after Carrow, and whether he will stay.',
        'Wren goes over the survey one last time while Ash dozes in his chair.'
      ],
      mood: 'Weary, intimate, nervous.'
    },
    words: 2400,
    plants: [
      {
        id: 'bryn-out',
        trap: 'rooms',
        says:
          "Make sure this happens early in the scene, in its first few paragraphs: Bryn takes the horses to the smith at the far end of town for new shoes, and she does not come back before the scene ends (the rest of the scene is Wren and Ash, and the landlord).",
        find: [/\bBryn\b/, /\b(?:smith|forge|farrier|horses|shoes)\b/i],
        judge: 'Early in the scene, does Bryn leave to take the horses to the smith?',
        early: true,
        holds: PATTERNS.brynBack
      }
    ]
  },
  {
    key: 's28',
    chapter: 6,
    title: 'Fog on the fell',
    card: {
      pov: 'wren',
      present: ['wren', 'ash'],
      location: 'fell',
      when: 'Day 21',
      beats: [
        'Wren and Ash ride up Carrow Fell to see the old workings with their own eyes.',
        'Fog comes down thick; they have to find the way to the north side by what they can see and remember of the survey.',
        'They find the old adit, black and dripping, exactly where Edric drew it.'
      ],
      mood: 'Blind, eerie, then triumph.'
    },
    words: 1500,
    plants: []
  },
  {
    key: 's29',
    chapter: 6,
    title: 'The Assize',
    card: {
      pov: 'wren',
      present: ['wren', 'ash', 'bryn', 'gale', 'ide'],
      location: 'carrow',
      when: 'Day 22',
      beats: [
        'Wren lays Edric’s survey before Magistrate Ide at the Carrow Assize.',
        'Gale stands up to contest the claim on the Warden’s behalf and demands to see what the survey shows.',
        'Ide reads the survey in private, refuses Gale, and seals the claim in Edric’s name and Wren’s.'
      ],
      mood: 'Formal, tense, then relief.'
    },
    words: 1600,
    plants: []
  },
  {
    key: 's30',
    chapter: 6,
    title: 'The road out of Carrow',
    card: {
      pov: 'wren',
      present: ['wren', 'ash', 'bryn'],
      location: 'carrow',
      when: 'Day 23',
      beats: ['They ride out of Carrow in the morning, the sealed claim safe.', 'Bryn turns her cart for Harrowgate and they part with rough affection.', 'Wren and Ash ride on together towards the coast.'],
      mood: 'Bittersweet, open.'
    },
    words: 1400,
    plants: []
  }
]

// ---------- Probes ----------

/** Where a probe's page stops, worked out from the written story. */
export type ProbeAt =
  | { start: true }
  /** Continue far from a planted event: at least `gap` words after it (beyond Continue's 1,200), near the scene's end. */
  | { after: string; gap: number }
  /**
   * Just before the paragraph where a planted event happens, found again in the written words, paragraph by paragraph;
   * with `firstMention`, before the first paragraph of the scene that mentions it at all (so the page holds no reminder).
   */
  | { before: string; firstMention?: RegExp }
  /** This share of the scene's words (cut at a paragraph). */
  | { share: number }

export interface ProbeSpec3 {
  id: string
  scene: string
  kind: 'generate' | 'addBelow' | 'continue' | 'beat'
  beat?: number
  at: ProbeAt
  /** What Adam would type for this draft (Generate, Add below) or this beat (its note): aims it at the traps. */
  direction?: string
  /** The scene card's beats for the probe (Continue reads them): aims it at the traps. */
  beats?: string[]
  /** A beat probe whose page stops part-way through the beat before (Beat by beat's own "mid-beat"). */
  soFarEnds?: 'with-beat' | 'mid-beat'
  asks: string
  facts: string[]
  checks: Check[]
  tripwires: Tripwire[]
  patterns: PatternCheck[]
}

const p = (c: PatternCheck, id: string): PatternCheck => ({ ...c, id })

/** A pattern as a tripwire behind one of the judge's questions. */
const wire = (c: PatternCheck, check: string): Tripwire => ({ check, what: c.what, pattern: c.broken, not: c.not, unlessBefore: c.unlessBefore })

const COMPASS_ASK =
  'Does Wren have or use a compass in this passage: holding it, taking it out of a pocket, opening it, reading its needle to take a bearing? Thinking of a compass, remembering one, wishing for one, or finding her way without one (by the land, the wind, the survey, "the compass in her head") does NOT count.'
const HORSE_ASK =
  "Is Wren riding Thistle (her dun mare) or any mare? Riding Cinder (a grey gelding) does not count, and nor does only talking or thinking about Thistle (\"I've got to fetch Thistle\", \"Thistle'll be fat\")."

// Probes version 2 (Adam, 2026-10-07): in round 3 about 75 of every 120 checks were "not touched": the passages never
// came near the traps. Each probe now aims its passage at its traps, through what Adam would type himself (a draft's
// direction, a beat's note, the scene card's beats for Continue), without ever saying what is true: "find her bearings
// in the fog", never "she has no compass".
export const PROBES3: ProbeSpec3[] = [
  {
    id: 'G1',
    scene: 's28',
    kind: 'generate',
    at: { start: true },
    asks: 'Generate scene 28 (fog on the fell), asked to show how Wren finds her bearings, the horses by name, her old burn, and Ash’s face up close.',
    direction:
      'Show, step by step, how Wren finds her bearings when the fog comes down. Name the horses as they climb. Her old burn aches in the cold and wet. When they stop to rest, describe Ash’s face up close.',
    facts: [
      "Wren rides Cinder, Ash's grey gelding. Her dun mare Thistle went lame in chapter 2 and is still at Hobb's Farm.",
      "Wren gave her grandmother's brass compass to Mother Agate as a toll in chapter 2; she has no compass.",
      "Wren's LEFT forearm was burned in chapter 1 (now healing).",
      "Ash has a thin scar on his LEFT cheek from a knife in chapter 2."
    ],
    checks: [
      { id: 'G1a', trap: 'horse', ask: HORSE_ASK, bad: 'yes' },
      { id: 'G1b', trap: 'compass', ask: COMPASS_ASK, bad: 'yes' }
    ],
    tripwires: [wire(PATTERNS.horse, 'G1a'), wire(PATTERNS.compass, 'G1b')],
    patterns: [p(PATTERNS.burn, 'G1c'), p(PATTERNS.scar, 'G1d')]
  },
  {
    id: 'C1',
    scene: 's24',
    kind: 'continue',
    at: { after: 'boots-off', gap: 1300 },
    beats: [
      'A storm drives them into a shepherd’s hut on Linmouth Moor, soaked to the skin.',
      'They light a fire, eat what they have, and dry out as best they can.',
      'Late into the night, Ash tells the story of how he became a drover, and Bryn tells a darker one about her father.',
      'Wren cannot sleep and sits by the fire going over Edric’s survey, thinking about what it will mean.',
      'Before dawn Wren gets up, rubbing her aching arm, crosses the hut and opens the door to look out at the storm.'
    ],
    asks: 'Continue near the end of the long scene 24, its card now ending with Wren crossing the hut to the door: her coat and boots came off early in the scene, beyond what Continue is shown.',
    facts: [
      "Early in this scene Wren took off her oilskin coat (hanging by the fire) and her boots (drying); she wears the shepherd's dry wool shirt and is barefoot.",
      "Wren's LEFT forearm was burned in chapter 1."
    ],
    checks: [
      {
        id: 'C1a',
        trap: 'clothing',
        ask: 'Is Wren described as actually wearing her boots (on her feet) or her oilskin coat (on her body), without the passage first showing her put them on? Boots or a coat only mentioned, or seen drying or hanging, don’t count.',
        bad: 'yes'
      }
    ],
    tripwires: [wire(PATTERNS.bootsOn, 'C1a')],
    patterns: [p(PATTERNS.burn, 'C1b')]
  },
  {
    id: 'C2',
    scene: 's27',
    kind: 'continue',
    at: { after: 'bryn-out', gap: 1300 },
    beats: [
      'They reach Carrow and take rooms at the Wheatsheaf on the market square.',
      'The landlord tells them the Assize sits the day after tomorrow, and that the Warden’s man has been asking about a survey.',
      'Over a long supper by the fire Ash and Wren talk about what they will do after Carrow, and whether he will stay.',
      'Wren goes over the survey one last time while Ash dozes in his chair.',
      'Late in the evening Wren rolls up her sleeves to spread the survey on the table, the talk turns to Bryn, and the firelight falls on Ash’s scarred face.'
    ],
    asks: 'Continue near the end of the long scene 27, its card now ending with talk of Bryn, Ash’s face and Wren’s sleeves: Bryn left for the smith early in the scene, beyond what Continue is shown.',
    facts: [
      'Early in this scene Bryn took the horses to the smith at the far end of town; she has not come back. Only Wren, Ash and the landlord are at the Wheatsheaf.',
      "Ash has a thin scar on his LEFT cheek. Wren's LEFT forearm was burned in chapter 1."
    ],
    checks: [],
    tripwires: [],
    patterns: [p(PATTERNS.brynBack, 'C2a'), p(PATTERNS.scar, 'C2b'), p(PATTERNS.burn, 'C2c')]
  },
  {
    id: 'B1',
    scene: 's26',
    kind: 'beat',
    beat: 3,
    // Probes v3: before the scene first mentions the bead (Oskar's "the bead you owe my Pell"), so the page holds no
    // reminder; round 4's page ended after the bead was given.
    at: { before: 'bead-given', firstMention: /\bbead\b/i },
    soFarEnds: 'mid-beat',
    direction: 'Get them across the river first, then the goodbye on the far bank.',
    asks: 'Beat 3 of scene 26 (across the river, then goodbye to Pell): the bead promised in chapter 1, bought in chapter 3, is due; the page stops before the scene first mentions it.',
    facts: [
      "In chapter 1 Wren promised Pell a blue glass bead from Harrowgate. She bought it at the market there in chapter 3, and she has it with her now: she has not given it to Pell yet.",
      'Only Ash and Bryn know the survey shows silver workings; Oskar and Pell know nothing about it.'
    ],
    checks: [
      { id: 'B1a', trap: 'promise', ask: 'Before they part, does Wren give Pell the blue glass bead, or at least speak of her promise to?', bad: 'no' },
      { id: 'B1b', trap: 'knows', ask: 'Does Oskar or Pell say or show that they know the survey shows silver workings (or is either of them told)?', bad: 'yes' }
    ],
    tripwires: [],
    patterns: []
  },
  {
    id: 'G2',
    scene: 's29',
    kind: 'generate',
    at: { start: true },
    asks: 'Generate scene 29 (the Assize), asked to have Gale press to know what the survey shows, Bryn beside Wren, her sleeve over her old burn, and the ride to the hall.',
    direction:
      'They ride to the Assize hall that morning. Bryn stands beside Wren in the hall. Gale presses hard to find out what the survey shows; let the reader see exactly what he knows and what he doesn’t. As Wren lays the survey out, her sleeve rides up over her old burn.',
    facts: [
      'Only Ash and Bryn know the survey shows silver workings (Ash told Bryn in chapter 4). Gale knows who Wren is but not what the survey shows.',
      "Wren's LEFT forearm was burned in chapter 1. She rides Cinder; Thistle stayed lame at Hobb's Farm."
    ],
    checks: [
      { id: 'G2a', trap: 'knows', ask: 'Does Gale say or show that he knows the survey shows silver workings?', bad: 'yes' },
      { id: 'G2b', trap: 'knows', ask: 'Does Bryn react as if she is hearing about the silver workings for the first time?', bad: 'yes' },
      { id: 'G2d', trap: 'horse', ask: HORSE_ASK, bad: 'yes' }
    ],
    tripwires: [wire(PATTERNS.horse, 'G2d')],
    patterns: [p(PATTERNS.burn, 'G2c')]
  },
  {
    id: 'A1',
    scene: 's30',
    kind: 'addBelow',
    at: { share: 0.5 },
    asks: 'Add below halfway through scene 30, asked for a keepsake from Wren’s pockets, her bearings for the coast road, Ash’s face, and riding on.',
    direction:
      'At the parting, Wren searches her pockets for something to give Bryn as a keepsake. Then she takes her bearings for the coast road and they ride on. Show Ash’s face as he says goodbye to his cousin.',
    facts: [
      "Wren gave the blue glass bead to Pell in chapter 6; she doesn't have it.",
      "Wren has no compass (given away in chapter 2). She rides Cinder. Ash's scar is on his LEFT cheek."
    ],
    checks: [
      { id: 'A1b', trap: 'compass', ask: COMPASS_ASK, bad: 'yes' },
      { id: 'A1d', trap: 'horse', ask: HORSE_ASK, bad: 'yes' }
    ],
    tripwires: [wire(PATTERNS.compass, 'A1b'), wire(PATTERNS.horse, 'A1d')],
    patterns: [p(PATTERNS.bead, 'A1a'), p(PATTERNS.scar, 'A1c')]
  },
  {
    id: 'A2',
    scene: 's25',
    kind: 'addBelow',
    at: { share: 0.5 },
    asks: 'Add below halfway through scene 25, asked for Wren to check which way the river lies, her burned arm on the reins, Ash’s face in the wind, and the ride down.',
    direction:
      'Wren checks which way the river lies before they go on. They ride down the last slope; her burned arm is stiff on the reins. Ash grins at her, the wind in his face.',
    facts: ["Wren rides Cinder. She has no compass. Her LEFT forearm was burned in chapter 1. Ash's scar is on his LEFT cheek."],
    checks: [
      { id: 'A2a', trap: 'horse', ask: HORSE_ASK, bad: 'yes' },
      { id: 'A2b', trap: 'compass', ask: COMPASS_ASK, bad: 'yes' }
    ],
    tripwires: [wire(PATTERNS.horse, 'A2a'), wire(PATTERNS.compass, 'A2b')],
    patterns: [p(PATTERNS.burn, 'A2c'), p(PATTERNS.scar, 'A2d')]
  }
]
