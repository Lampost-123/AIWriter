// Probes v4 (Adam, 2026-10-07): chains. Adam writes long stories on DeepSeek Flash mostly with Continue and Add below,
// carrying a scene on step by step, and his complaint was the AI forgetting where people are, how they are placed and
// what they wear, within a scene and across scenes. Probes v1 to v3 asked once at a chosen point; a chain does what he
// does: after the whole written story (version 3, read by the memory), a new scene opens with a few lines as he would
// type them, then the app carries it on in 12 steps, Add below and Continue in turn, each through the window's own
// entry point, with at most a short direction as he would type it. The early steps' directions plant facts (boots off,
// someone gone, a door locked, a case put down, lying down, a cut hand), never said again; every later step is checked
// against every plant still in force, and against facts from chapters back (the compass given away, the burn's side).
//
// Between steps the app does what it does while Adam pauses (app.ts `pause`): the memory reads the scene and everything
// that follows a read finishes (where things stand, the live stage's checkpoints), and step 5's index catches up.
// Step 3's check and repair runs on each landing, and its fixes go into the page, as in the app. Approximations: the
// memory's read comes straight after the landing and the repair (in the app, after 30 seconds of quiet); Adam accepts
// every Continue as it comes; a step whose planted events didn't land is drafted again (twice at most) before it goes
// into the page, where Adam would undo it and try again.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkout, countWords, git, openApp, standInDirections, whenEnded, type App, type TrapsConfig } from './app'
import { paragraphsOf } from './page'
import { findAcross, outsideQuotes, refersTo, sentences, type PatternCheck, type Referent, type SpreadPlace } from './patterns'
import { quoteInPassage } from './score'
import { repairLanded, storyFor, storyId, findSavedWorld, type SavedWorld } from './run'
import {
  chainsAsSummary,
  passagesMarkdown,
  recallSummary,
  reportMarkdown,
  scorePassage,
  summariseChains,
  type ChainResult,
  type ChainSample,
  type ChainStepResult,
  type CheckResult,
  type RunReport
} from './score'
import type { Check, Tripwire } from './story'
import { PATTERNS, type Card3 } from './story3'

/** Reports say "probes v4" for chains. */
export const CHAIN_PROBES_VERSION = 4

/** A fact a chain step plants (or one from chapters back), and how it is checked at every later step. */
export interface ChainPlant {
  id: string
  name: string
  /** What is true once it has happened, for the judge. */
  fact: string
  /**
   * Where it happened in its step: one paragraph, or up to three neighbouring ones (Ash named in one, "he went out" in
   * the next), matching all of these (and none of `none`).
   */
  find: RegExp[]
  none?: RegExp[]
  /** Someone `find` names (its pattern is `who.name`), who may be "he" or "she" in the paragraphs after. */
  who?: Referent
  /** Asked of the judge when no paragraphs match `find` (good answer "yes", with the words that show it). */
  happens: string
  /**
   * The event can run on over the paragraphs that follow (the bar dropped, then the key turned): a change is looked for
   * in its step only after the last paragraph in a row that still matches `find`.
   */
  runsOn?: boolean
  /** A change shown on the page that ends it (she pulls her boots back on): checked no further after that step. */
  change?: RegExp
  /**
   * Whose change it is: it counts only where that person makes it, by name or by a pronoun standing for them (the
   * first person named in the sentence, or the nearest before the change), so "Ash got up" doesn't get Wren up.
   */
  changeBy?: Referent
  /** A deterministic check of each later step (the narration only). */
  drift?: Omit<PatternCheck, 'id' | 'trap'>
  /** The judge's question for each later step, where a pattern can't decide, with a pattern as its tripwire. */
  judge?: { ask: string; tripwire?: RegExp }
  /**
   * When the deterministic check finds a slip but no pattern saw the change that would excuse it, the judge is asked
   * this (good answer "yes": the change is on the page before the slip); a yes ends the plant and the slip is none.
   */
  endedAsk?: string
}

export interface ChainStep {
  kind: 'continue' | 'addBelow'
  /** What Adam types for an Add below (Continue takes none). */
  direction?: string
  /** The plants this step's direction asks for. */
  plants?: string[]
}

export interface ChainSpec {
  id: string
  scene: { key: string; chapter: number; title: string; card: Card3 }
  /** The scene's first lines, as Adam would type them. */
  opening: string[]
  /** Length asked of an Add below, in words. */
  addWords: number
  steps: ChainStep[]
  plants: ChainPlant[]
  /** Facts from chapters back, checked from the first step. */
  far: ChainPlant[]
}

// ---------- The chain's checks ----------

const BOOTS_ON = /\b(?:pulled|tugged|put|drew|laced|forced|struggled|shoved)\s+(?:on\s+)?(?:her\s+)?(?:wet\s+|damp\s+|cold\s+|dry\s+)?boots\b|\bboots\s+back\s+on\b/i
const COAT_ON = /\b(?:shrugged|pulled|put|drew|struggled)\s+(?:on\s+|into\s+)?(?:her\s+)?(?:wet\s+|damp\s+)?(?:coat|oilskin)\b(?!\s+pockets?)|\b(?:took|lifted|unhooked|fetched|got) (?:her|the) (?:coat|oilskin) (?:down|off|from)\b/i
/**
 * Ash back in the room, in any wording round 6 found or might: Ash coming in (anywhere in the sentence: "She heard Ash
 * cross the cobbles, then his step at the door, then the bar lifting ... while he came in"), his step or knock at the
 * door, someone letting him in.
 */
const ASH_BACK =
  /\bAsh\b[^.!?\n]*\b(?:came back|came in|come in|comes in|returned|back in|walked in|stepped in|was back|ducked in|reappeared|pushed in|let himself in|in from the (?:yard|stable|rain|dark|wet))\b|\b(?:let|lets|letting) (?:Ash|him) in\b|\b(?:his|Ash's|Ash’s) (?:step|steps|tread|boots|knock|voice) (?:at|outside|on|in|through) the (?:door|passage)\b|\b(?:he|Ash) came (?:through|in through|in at)\b/i
/** The door unlocked, unbarred or unbolted, in any wording; or someone let in (which needs it). */
const UNLOCKED =
  /\b(?:unlock\w*|unbarred|unbolted|turned the key|turn the key|key (?:in|turned in|grated in|scraped in|rattled in) the lock|undid the (?:lock|bolt|bar))\b|\bthe (?:bar|bolt) (?:lifting|lifted|was lifted|drawn|drew back|slid back|went up|scraped back|came up|came off|was drawn)\b|\b(?:lifted|drew|slid|raised|took) (?:back |up |off )?the (?:bar|bolt)\b|\b(?:let|lets|letting) (?:him|her|them|Ash|Mother Rook|the landlady) in\b|\bkey\b[^.!?\n]{0,80}\bturned it(?: back)?\b|\bturned (?:it|the key) back\b/i
/**
 * The door locked, barred or bolted, in the wordings round 7 found and their kin: "The key was in the lock. She turned
 * it", "found the key on the inside and turned it, and the lock went over", "dropped it into the brackets", "lifted it
 * into its keep", "the bolt came home", "took the key out of the lock and put it in her pocket".
 */
export const DOOR_LOCKED =
  /\b(?:locked|lock(?:s|ed)? the door|turned the key|key (?:\w+ ){0,2}in the lock|shot the bolt|bolted)\b|\bkey\b[^\n]{0,80}?\bturned it\b|\bturned (?:it|the key) in the lock\b|\bthe lock (?:went|turned|clicked|snapped|shot) (?:over|home)\b|\b(?:bar|bolt)\b[^.!?\n]{0,30}\b(?:went|came|slid|dropped|fell|was) home\b|\b(?:set|shot|slid|dropped|pushed|drove|put|eased|knocked) (?:it|the bar|the bolt) home\b|\binto (?:its|their|the) (?:keep|keeps|irons|brackets|staples|sockets|hasps?|cleats)\b|\b(?:took|drew|pulled|slid|eased|got|lifted) the key (?:out|from)\b[^.!?\n]{0,120}\bpocket\b|\bkey out of the lock\b/i
const ASH = /\bAsh\b/
/** Others "he" could stand for in the chain's scene: the story's men, Cinder (a gelding), the inn's boy. */
const OTHER_MEN = /\b(?:Cinder|Hobb|Gale|Oskar|Ide|Vey|Corran|Edric)\b|\b(?:the|Rook['’]s) (?:boy|ostler|man)\b/i
/**
 * Others "she" could stand for: the story's women and the inn's. Not in the possessive: "a man's voice, not Mother
 * Rook's" doesn't make Mother Rook the one "she" stands for next.
 */
const OTHER_WOMEN = /\b(?:Mother Rook|Rook|Bryn|Pell|Sela|Mother Agate|Agate)\b(?!['’]s\b)|\bthe (?:landlady|woman|girl)\b(?!['’]s\b)/i
/** Wren, the point-of-view character: "she" is taken as Wren until another woman is named. */
const WREN: Referent = { name: /\bWren\b/, pronoun: /\bshe\b/i, others: OTHER_WOMEN, assumed: true }
/**
 * Getting up from lying, in any wording round 7 found or might ("She got up and turned the key", "she sat up, and they
 * looked at each other"). Standing somewhere ("she stood at the window") is the slip itself, never the change.
 */
const GOT_UP =
  /\b(?:got up|sat up|sat upright|sat forward|rose|rising|stood up|swung (?:her )?(?:legs|feet)|got off the settle|pushed herself up|came off the settle|left the settle|struggled up|was on her feet|got to her feet|came to her feet|found her feet|climbed off|levered herself up|up off the settle|rolled off the settle|sat on the edge of the settle|put her feet (?:down|to the floor|on the floor|to the flags)|(?:threw|pushed|flung) (?:off |back )?the blanket(?: off| back| aside)?|was up (?:before|and|off|from|out))\b/i
const CASE_MOVED = /\b(?:took|picked up|fetched|lifted|got|reached for|snatched|gathered up) the (?:survey )?case\b|\bcase (?:from|off) the (?:window)?sill\b/i

/** A cut on the left hand or palm (the cut is on the right): the mirror of the version 2 check, with the sides swapped. */
export const LEFT_HAND_CUT =
  /\bleft (?:hand|palm)\b(?:(?!\bright\b)[^,.!?;\n]){0,40}\b(?:cut|blood\w*|bleed\w*|sting\w*|bandag\w*|throb\w*|gash\w*|wound\w*|shard|sliced)\b(?!\s+right\b)|\bleft (?:hand|palm),\s+(?:(?!right\b)\w+\s+){0,2}(?:cut|bleed\w*|bandag\w*|throb\w*|sting\w*|bloody)\b|\b(?:cut|bandag\w*|bleeding|gashed|wounded|throbbing|stinging|bloodied)(?:\s+(?!right\b)\w+){0,3}?\s+left (?:hand|palm)\b/i

export const CHAIN_PLANTS: ChainPlant[] = [
  {
    id: 'boots-off',
    name: 'Boots off',
    fact: "Wren pulled off her wet boots; they are drying by the hearth and she is in her stockings.",
    find: [/\bboots?\b/i, /\b(?:off|pulled|tugged|kicked|unlaced|dragged|hearth|fire|dry|drying)\b/i],
    happens: 'Does Wren take her boots off?',
    change: BOOTS_ON,
    drift: {
      what: 'Wren walks in her boots, or has them on, without putting them back on.',
      broken: /\bher boots\b[^.!?\n]{0,25}\b(?:crunched|rang|thudded|scraped|squelched|clattered|creaked)\b|\bin her boots\b|\b(?:booted feet|her boots) on the (?:floor|flags|flagstones|boards)\b/i,
      not: /\b(?:drying|steam\w*|by the (?:fire|hearth)|beside|off|no longer|without)\b/i,
      unlessBefore: BOOTS_ON,
      outsideQuotes: true,
      touches: /\b(?:boots|stocking\w*|bare ?feet|barefoot)\b/i
    }
  },
  {
    id: 'coat-off',
    name: 'Coat off',
    fact: 'Wren hung her oilskin coat on the peg behind the door; she is not wearing it.',
    find: [/\b(?:coat|oilskin)\b/i, /\b(?:peg|hook|hung|hang\w*|door)\b/i],
    happens: 'Does Wren take her coat off and hang it up?',
    change: COAT_ON,
    drift: {
      what: 'Wren wears her coat again without putting it on.',
      // Wearing needs a wearing cue: a coat pocket isn't the coat on her ("she put it in her coat pocket" while the coat
      // hangs on the peg, round 6).
      broken:
        /\b(?:wore|was wearing|wearing|had on|shivered in|huddled in|sat in|stood in|waited in|slept in|lay in) her (?:wet |damp |soaked |heavy )?(?:oilskin|coat)\b(?!\s+pockets?)|\b(?:buttoned|fastened|pulled|drew|tugged|hugged|clutched) (?:her|the) (?:oilskin|coat)\b(?!\s+pockets?)[^.!?\n]{0,20}\b(?:tighter|closer|around|about|round)\b|\b(?:oilskin|coat) collar (?:up|turned up|against)\b/i,
      not: /\b(?:peg|hook|door|hung|hanging|dripping|steam\w*|off|pockets?)\b/i,
      unlessBefore: COAT_ON,
      outsideQuotes: true,
      touches: /\b(?:coat|oilskin)\b/i
    }
  },
  {
    id: 'ash-out',
    name: 'Ash gone to the stable',
    fact: 'Ash went out to the stable to see to the horses; he has not come back.',
    find: [ASH, /\b(?:stable|horses)\b/i, /\b(?:went|goes|out|left|gone|go)\b/i],
    who: { name: ASH, pronoun: /\b(?:he|him|his|himself)\b/i, others: OTHER_MEN },
    happens: 'Does Ash go out of the room (to the stable, or to see to the horses)?',
    change: ASH_BACK,
    endedAsk: 'Before the words quoted, does the passage show Ash coming back into the room (his step at the door, the door unbarred or unlocked for him, someone letting him in, or him coming in)?',
    drift: {
      what: 'Ash speaks or acts in the room without coming back first.',
      broken:
        /\bAsh (?:said|says|asked|called|muttered|answered|replied|whispered|told|laughed|snapped|grinned|nodded|shrugged|sat|stood|leaned|poured|drank|smiled|reached|looked up)\b|\b(?:said|asked|called|muttered|answered|replied|whispered|snapped) Ash\b/i,
      // Words Ash said before or elsewhere, told in the narration, aren't Ash speaking now ("which was what Ash said").
      not: /\b(?:would|might|hoped|wondered|thought|remember\w*|stable|horses|when|until|before|if|outside|yard)\b|\b(?:what|as|like|whatever|how) Ash (?:said|says|had said|would say|used to say)\b|\bAsh had (?:said|told|asked|called|answered)\b|\bAsh (?:used to|would always) say\b/i,
      unlessBefore: ASH_BACK,
      outsideQuotes: true,
      touches: /\bAsh\b/
    }
  },
  {
    id: 'door-locked',
    name: 'Door locked',
    fact: 'Wren locked the parlour door and put the key in her pocket; it stays locked until someone unlocks it.',
    find: [DOOR_LOCKED],
    happens: 'Does Wren lock, bolt or bar the door?',
    runsOn: true,
    change: UNLOCKED,
    endedAsk: 'Before the words quoted, does the passage show the door being unlocked, unbarred or unbolted, or someone letting a person in?',
    drift: {
      what: 'The door opens, or someone comes in, without it being unlocked.',
      broken:
        /\bthe door (?:opened|swung open|banged open|flew open|burst open|creaked open|was flung open|was pushed open)\b|\b(?:opened|flung open|pushed open) the door\b|\b(?:Ash|Mother Rook|the landlady|someone|a man|a woman|he) (?:came|walked|stepped|burst|bustled|strode) in\b/i,
      not: /\b(?:would|could|might|if|tried|try|rattled|locked|wouldn't|couldn't|didn't|did not|no one|nobody|wished)\b/i,
      unlessBefore: UNLOCKED,
      outsideQuotes: true,
      touches: /\b(?:door|key|lock\w*|knock\w*)\b/i
    }
  },
  {
    id: 'case-down',
    name: 'Survey case on the windowsill',
    fact: 'Wren put the survey case down on the windowsill.',
    find: [/\b(?:survey|case)\b/i, /\b(?:sill|windowsill|window)\b/i],
    happens: 'Does Wren put the survey case down on the windowsill?',
    change: CASE_MOVED,
    judge: {
      ask: "The survey case was last put down on the windowsill. Is it described as in Wren's hands, lap or arms, under her arm, or anywhere other than the windowsill, without the passage first showing someone pick it up or move it? Only thinking of it, or looking at it on the sill, doesn't count.",
      tripwire: /\b(?:survey case|the case)\b[^.!?\n]{0,40}\b(?:in her (?:lap|arms|hands)|under her arm|on her knees|against her (?:hip|chest|side))\b|\b(?:clutched|hugged|held|gripped|cradled) the (?:survey )?case\b/i
    }
  },
  {
    id: 'lie-down',
    name: 'Lying on the settle',
    fact: 'Wren is lying on the settle by the fire.',
    find: [/\b(?:lay|lies|lying|lain|stretched out|lie down)\b/i, /\bsettle\b/i],
    happens: 'Does Wren lie down on the settle?',
    change: GOT_UP,
    changeBy: WREN,
    judge: {
      ask: 'Wren was last lying on the settle by the fire. Is she described as standing, walking about, or sitting somewhere else, without the passage first showing her get up or move? Answer no when the passage shows her getting up, sitting up, rising or getting to her feet (in any words) before that: getting up is not a slip, so never quote it. Lying, or sitting up on the settle itself, doesn’t count.',
      tripwire: /\b(?:she|Wren) (?:was standing|stood (?:at|by|in|near|beside|with)|paced|was pacing|walked (?:to|across)|crossed (?:to|the room))\b/i
    }
  },
  {
    id: 'hand-cut',
    name: 'Right hand cut',
    fact: "A shard cut the palm of Wren's RIGHT hand; her left hand is unhurt (her old burn is on her LEFT forearm).",
    find: [/\bright\b/i, /\b(?:hand|palm)\b/i, /\b(?:cut|blood|bleed\w*|sliced|gash\w*|shard)\b/i],
    happens: "Is the palm of Wren's right hand cut?",
    drift: {
      what: 'The cut is put on her left hand.',
      broken: LEFT_HAND_CUT,
      outsideQuotes: true,
      touches: /\b(?:hand|palm)\b[^.!?\n]{0,40}\b(?:cut|blood|bleed\w*|bandag\w*|sting\w*|throb\w*)\b|\b(?:cut|blood|bleed\w*|bandag\w*)\b[^.!?\n]{0,40}\b(?:hand|palm)\b/i
    }
  }
]

/** Facts from chapters back, checked from the first step. */
export const CHAIN_FAR: ChainPlant[] = [
  {
    id: 'compass',
    name: 'Compass given away (chapter 2)',
    fact: "Wren gave her brass compass away as a toll in chapter 2; she has no compass.",
    find: [],
    happens: '',
    drift: { what: PATTERNS.compass.what, broken: PATTERNS.compass.broken, not: PATTERNS.compass.not, outsideQuotes: true, touches: PATTERNS.compass.touches }
  },
  {
    id: 'burn',
    name: 'Burn on the left forearm (chapter 1)',
    fact: "Wren's old burn is on her LEFT forearm.",
    find: [],
    happens: '',
    drift: { what: PATTERNS.burn.what, broken: PATTERNS.burn.broken, outsideQuotes: true, touches: PATTERNS.burn.touches }
  }
]

export const CHAINS: ChainSpec[] = [
  {
    id: 'K1',
    scene: {
      key: 'k1',
      chapter: 6,
      title: 'The inn on the coast road',
      card: {
        pov: 'wren',
        present: ['wren', 'ash'],
        location: 'droveroad',
        when: 'Day 23, night, rain',
        beats: ['Wren and Ash stop for the night at a drovers’ inn on the coast road.', 'They talk about what comes next.'],
        mood: 'Tired, close.'
      }
    },
    opening: [
      'The inn stood on its own where the coast road dropped towards the sea: a long low house with one lamp in the window and a yard full of puddles. The landlady, a broad woman called Mother Rook, looked at the state of them and put them in the back parlour, where the fire was.',
      'Wren stood dripping on the flagstones while Ash dragged the settle nearer the hearth. Her oilskin coat was soaked through, her boots squelched when she moved, and the survey case was under her arm, where it had been all day.'
    ],
    addWords: 350,
    steps: [
      { kind: 'addBelow', direction: 'Wren pulls off her wet boots and sets them by the hearth to dry, and hangs her oilskin coat on the peg behind the door.', plants: ['boots-off', 'coat-off'] },
      { kind: 'continue' },
      { kind: 'addBelow', direction: 'Ash goes out to the stable to see to the horses for the night. Wren locks the door behind him and puts the key in her pocket.', plants: ['ash-out', 'door-locked'] },
      { kind: 'continue' },
      { kind: 'addBelow', direction: 'Wren puts the survey case down on the windowsill, then lies down on the settle by the fire.', plants: ['case-down', 'lie-down'] },
      { kind: 'continue' },
      { kind: 'addBelow', direction: 'Still lying there, Wren reaches for the cup on the hearth; it breaks, and a shard cuts the palm of her right hand.', plants: ['hand-cut'] },
      { kind: 'continue' },
      { kind: 'addBelow', direction: 'Someone knocks at the door.' },
      { kind: 'continue' },
      { kind: 'addBelow', direction: 'Wren wonders which way the coast road runs from here in the dark.' },
      { kind: 'continue' }
    ],
    plants: CHAIN_PLANTS,
    far: CHAIN_FAR
  }
]

/** How many times one step is drafted at most when its planted events don't land. */
export const STEP_TRIES = 3

/** The plants in force at a step: landed earlier and not ended by a change shown since, then the far facts. */
export function inForce(spec: ChainSpec, landedAt: Map<string, number>, ended: Set<string>, step: number): ChainPlant[] {
  const near = spec.plants.filter((p) => (landedAt.get(p.id) ?? Infinity) < step && !ended.has(p.id))
  return [...near, ...spec.far]
}

/** The checks for one step: deterministic ones, and the judge's questions (ids Q1...) with their tripwires. */
export function stepChecks(plants: ChainPlant[]): { facts: string[]; checks: Check[]; tripwires: Tripwire[]; patterns: PatternCheck[]; judgeIds: Map<string, string> } {
  const checks: Check[] = []
  const tripwires: Tripwire[] = []
  const patterns: PatternCheck[] = []
  const judgeIds = new Map<string, string>()
  for (const p of plants) {
    if (p.drift) patterns.push({ ...p.drift, id: p.id, trap: p.id })
    if (p.judge) {
      const id = `Q${checks.length + 1}`
      judgeIds.set(id, p.id)
      checks.push({ id, trap: p.id, ask: p.judge.ask, bad: 'yes' })
      if (p.judge.tripwire) tripwires.push({ check: id, what: p.name, pattern: p.judge.tripwire, ...(p.change ? { unlessBefore: p.change } : {}) })
    }
  }
  return { facts: plants.map((p) => p.fact), checks, tripwires, patterns, judgeIds }
}

/** The plants a step's words end by a change shown in the narration (not in what someone says). */
export function endedBy(text: string, plants: ChainPlant[]): string[] {
  return plants.filter((p) => changeAt(text, p) >= 0).map((p) => p.id)
}

/** Anyone a sentence could be about, to tell whose the change is. */
const SOMEONE = new RegExp(`\\b(?:she|he|they|Wren|Ash)\\b|${OTHER_MEN.source}|${OTHER_WOMEN.source}`, 'gi')

/**
 * Where the narration first shows a plant's change (not in what someone says), or -1. With `changeBy`, only a sentence
 * whose first person, or the nearest person before the change, is them by name or by a pronoun standing for them
 * counts; the pronoun is followed from sentence to sentence, so "Wren lay still. ... Then she got up" is hers.
 */
export function changeAt(text: string, p: ChainPlant): number {
  if (!p.change) return -1
  const re = new RegExp(p.change.source, p.change.flags.replace('g', ''))
  const narration = outsideQuotes(text)
  const ss = sentences(narration)
  const who = p.changeBy
  const refers = who ? refersTo(ss.map((s) => s.text), who) : null
  for (const [k, s] of ss.entries()) {
    const m = re.exec(s.text)
    if (!m) continue
    if (!who) return s.start + m.index
    const isThem = (w: string | undefined): boolean => !!w && (new RegExp(who.name.source, who.name.flags.replace('g', '')).test(w) || (new RegExp(who.pronoun.source, who.pronoun.flags.replace('g', '')).test(w) && !!refers![k]))
    const people = [...s.text.slice(0, m.index).matchAll(SOMEONE)].map((x) => x[0])
    if (isThem(people[0]) || isThem(people[people.length - 1])) return s.start + m.index
  }
  return -1
}

/** Where a quote is in a passage (case, spacing and quote marks aside), and where it ends; null when it isn't found. */
function quoteSpan(text: string, quote: string): { start: number; end: number } | null {
  const fold = (s: string): string => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  const t = fold(text)
  const q = fold(quote.replace(/^\.{3}|\.{3}$/g, '').trim())
  if (!q) return null
  let at = t.indexOf(q)
  if (at >= 0) return { start: at, end: at + q.length }
  // A quote with its spacing changed: find its first words, and take the quote's length from there.
  at = t.indexOf(q.slice(0, Math.min(30, q.length)))
  return at >= 0 ? { start: at, end: at + q.length } : null
}

/**
 * A slip the judge or a tripwire found for a plant with a change, where the step's own narration shows that change at
 * or before the slip's words (round 7: the judge quoted "She got up and turned the key" and "she sat up" as Wren up
 * without getting up): the plant ended there, so the slip is none and it counts as kept.
 */
export function excusedByChange(plants: ChainPlant[], results: CheckResult[], text: string): CheckResult[] {
  return results.map((r) => {
    if (r.verdict !== 'broken' || r.by === 'pattern') return r
    const p = plants.find((x) => x.id === r.trap)
    if (!p?.judge || !p.change) return r
    const at = changeAt(text, p)
    const span = at >= 0 && r.quote ? quoteSpan(text, r.quote) : null
    return span && at < span.end ? { ...r, verdict: 'kept', ask: r.ask.startsWith('Ended?') ? r.ask : `Ended? ${r.ask}` } : r
  })
}

/**
 * The plants a step ends: those in force before it, by a change anywhere in its words, and those it planted itself, by
 * a change after the paragraph that planted them (Ash goes out and comes back within one Add below; the key turned to
 * lock the door is not an unlocking).
 */
export function endedIn(text: string, before: ChainPlant[], planted: ChainPlant[], quotes: { id: string; quote: string }[] = []): string[] {
  const paras = paragraphsOf(text)
  const late = planted.filter((p) => {
    const last = plantedThrough(paras, p, quotes.find((q) => q.id === p.id)?.quote)
    return last != null ? endedBy(paras.slice(last + 1).join('\n\n'), [p]).length > 0 : false
  })
  return [...new Set([...endedBy(text, before), ...late.map((p) => p.id)])]
}

/**
 * The last paragraph of a planted event in its step's paragraphs: where its patterns found it (or, landed by the judge,
 * the paragraph holding its quote), run on over the paragraphs after that still match for a plant that `runsOn`.
 */
function plantedThrough(paras: string[], p: ChainPlant, quote?: string): number | null {
  const place = placeOf(paras, p)
  let last = place ? place.last : quote ? paras.findIndex((x) => quoteInPassage(x, quote)) : -1
  if (last < 0) return null
  if (p.runsOn) while (last + 1 < paras.length && p.find.every((r) => new RegExp(r.source, r.flags.replace('g', '')).test(paras[last + 1]))) last++
  return last
}

/** Where a plant's patterns find it in a step's paragraphs, a pronoun standing for its `who` where it has one. */
export function placeOf(paras: string[], p: ChainPlant): SpreadPlace | null {
  const refers = p.who ? refersTo(paras, p.who) : null
  return findAcross(paras, p.find, p.none ?? [], 3, (i, r) => !!refers && r === p.who!.name && refers[i])
}

/** A planted event that landed, with the words that show it; `by: 'judge'` where only the judge found it. */
export interface Planted {
  id: string
  quote: string
  by?: 'judge'
}

/**
 * Whether a step's planted events landed, by the patterns: each in a paragraph of its words, or spread over up to three
 * neighbouring ones (round 7: Ash named once, then "he"), with those paragraphs' matching words.
 */
export function landed(spec: ChainSpec, ids: string[], text: string): { ok: boolean; planted: Planted[]; missing: string[] } {
  const paras = paragraphsOf(text)
  const planted: Planted[] = []
  const missing: string[] = []
  for (const id of ids) {
    const p = spec.plants.find((x) => x.id === id)
    const place = p ? placeOf(paras, p) : null
    if (place) planted.push({ id, quote: place.quote })
    else missing.push(id)
  }
  return { ok: !missing.length, planted, missing }
}

/** The judge's questions for planted events the patterns missed (ids L1...), as write.ts asks for a story's plants. */
export function landingChecks(spec: ChainSpec, missing: string[]): Check[] {
  return missing.map((id, i) => ({ id: `L${i + 1}`, trap: id, ask: `${spec.plants.find((p) => p.id === id)?.happens ?? id} Quote the words that show it.`, bad: 'no' }))
}

/**
 * Folds the judge's answers into a landing: a missing event lands when the judge says yes with a quote that is in the
 * passage; anything else stays missing.
 */
export function landedByJudge(land: ReturnType<typeof landed>, checks: Check[], answers: { id: string; answer: string; quote: string }[] | null, text: string): ReturnType<typeof landed> {
  const planted = [...land.planted]
  const missing: string[] = []
  for (const c of checks) {
    const a = answers?.find((x) => x.id.toUpperCase() === c.id)
    if (a?.answer === 'yes' && a.quote && quoteInPassage(text, a.quote)) planted.push({ id: c.trap, quote: a.quote, by: 'judge' })
    else missing.push(c.trap)
  }
  return { ok: !missing.length, planted, missing }
}

/**
 * A slip a pattern found, checked once more where the plant has `endedAsk`: the judge is asked whether the change that
 * excuses it (Ash coming back, the door unbarred) is on the page before it, in words no pattern knew. A yes with a
 * quote that is in the passage turns the slip into a kept check (by the judge) and ends the plant at this step.
 */
async function confirmSlips(app: App, plants: ChainPlant[], results: CheckResult[], text: string): Promise<CheckResult[]> {
  const doubtful = results.filter((r) => r.verdict === 'broken' && r.by !== 'judge' && plants.find((p) => p.id === r.trap)?.endedAsk)
  if (!doubtful.length) return results
  const checks: Check[] = doubtful.map((r, i) => ({ id: `E${i + 1}`, trap: r.trap, ask: `${plants.find((p) => p.id === r.trap)!.endedAsk!} (The words: “${r.quote}”)`, bad: 'no' }))
  const j = await app.askJudge({ facts: ['The passage carries on a scene; answer only from what it shows.'], checks }, text)
  return results.map((r) => {
    const i = doubtful.indexOf(r)
    if (i < 0) return r
    const a = j.answers?.find((x) => x.id.toUpperCase() === `E${i + 1}`)
    return a?.answer === 'yes' && a.quote && quoteInPassage(text, a.quote) ? { ...r, verdict: 'kept', by: 'judge', answer: 'yes', ask: `Ended? ${r.ask}`, quote: a.quote } : r
  })
}

/** Probe results by plant, from a step's saved results (to re-score with the judge's saved answers). */
const byPlant = (rs: CheckResult[]): Map<string, CheckResult> => new Map(rs.map((r) => [r.trap, r]))

/**
 * Re-scores a chain run's saved steps with the checks as they are now, offline: every deterministic check again, the
 * judge's questions from its saved answers (with today's tripwires), which plants are in force from today's change
 * patterns. What would need a new judge call (a slip a pattern found where `endedAsk` would ask whether the change is
 * on the page) is listed, and the slip counted as it stands.
 */
export function rescoreChain(chain: ChainResult, spec: ChainSpec): { result: ChainResult; needJudge: { sample: number; step: number; plant: string; quote: string }[] } {
  const needJudge: { sample: number; step: number; plant: string; quote: string }[] = []
  const samples = chain.samples.map((m) => {
    const landedAt = new Map<string, number>()
    const ended = new Set<string>()
    let firstSlip: number | null = null
    const steps = m.steps.map((st) => {
      if (st.status !== 'complete') return st
      const plants = inForce(spec, landedAt, ended, st.step)
      const sc = stepChecks(plants)
      const score = (text: string, saved: CheckResult[], listNeeds: boolean): CheckResult[] => {
        const old = byPlant(saved)
        const out: CheckResult[] = []
        for (const p of plants) {
          if (p.drift) {
            const v = scorePassage({ checks: [], tripwires: [], patterns: [{ ...p.drift, id: p.id, trap: p.id }] }, text, null)[0]
            out.push(v)
            if (listNeeds && v.verdict === 'broken' && p.endedAsk) needJudge.push({ sample: m.index + 1, step: st.step, plant: p.id, quote: v.quote })
          }
          if (p.judge) {
            const id = [...sc.judgeIds.entries()].find(([, plant]) => plant === p.id)![0]
            const was = old.get(p.id)
            const check = sc.checks.find((c) => c.id === id)!
            const answers = was && was.by !== 'none' && was.answer ? [{ id, answer: was.answer as 'yes' | 'no' | 'unclear', quote: was.quote }] : null
            const v = scorePassage({ checks: [check], tripwires: sc.tripwires.filter((t) => t.check === id), patterns: [] }, text, answers)[0]
            if (listNeeds && !was) needJudge.push({ sample: m.index + 1, step: st.step, plant: p.id, quote: '' })
            out.push(excusedByChange([p], [{ ...v, id: p.id, trap: p.id }], text)[0])
          }
        }
        return out
      }
      const results = score(st.text, st.results, true)
      const after = st.repair ? score(st.repair.text, st.repair.results, false) : null
      const newly = spec.plants.filter((p) => st.planted.some((x) => x.id === p.id))
      for (const p of st.planted) landedAt.set(p.id, st.step)
      const text = st.repair?.text ?? st.text
      const resolved = endedIn(text, plants.filter((p) => spec.plants.includes(p)), newly, st.planted)
      for (const id of resolved) ended.add(id)
      if (firstSlip == null && results.some((r) => r.verdict === 'broken')) firstSlip = st.step
      return { ...st, results, resolved, ...(st.repair && after ? { repair: { ...st.repair, results: after } } : {}) }
    })
    return { ...m, steps, firstSlip }
  })
  return { result: { ...chain, samples }, needJudge }
}

// ---------- Running chains ----------

/** One step's draft, through the window's own entry point: Add below (with Adam's direction) or Continue at the end. */
async function draftStep(app: App, spec: ChainSpec, step: ChainStep, sceneId: string, page: string[], tag: string): Promise<{ status: string; error: string | null; generationId: string | null; text: string }> {
  if (step.kind === 'addBelow') {
    const { generationId } = await app.aiHandlers.startDraft(sceneId, { targetWords: spec.addWords, creativity: 'balanced', direction: step.direction ?? '', addBelow: true })
    const done = await whenEnded<{ status: string; error: string | null }>(generationId)
    return { status: done.status, error: done.error, generationId, text: app.gens.getGeneration(app.db, generationId).response }
  }
  const taskId = `traps-${tag}-${Date.now()}`
  const started = await app.startEdit({ taskId, sceneId, tool: 'continue', selection: '', before: page.join('\n\n'), after: '', continueAs: 'paragraph' })
  if (!started.ok) return { status: 'error', error: started.problem, generationId: null, text: '' }
  const done = await whenEnded<{ status: string; error: string | null; text: string }>(taskId)
  return { status: done.status, error: done.error, generationId: started.generationId, text: done.text }
}

/** One chain, in a fresh copy of the world after the whole story. */
async function runChain(app: App, cfg: TrapsConfig, spec: ChainSpec, index: number): Promise<ChainSample> {
  const sample: ChainSample = { index, status: 'complete', why: null, steps: [], firstSlip: null }
  const sceneId = app.makeScene(spec.scene)
  let page = [...spec.opening]
  // Adam types the opening and pauses.
  app.save(spec.scene.key, sceneId, page)
  await app.pause(sceneId)
  const recall = await app.recallReady()
  if (recall.available) {
    sample.recall = recall
    cfg.log(`  find by meaning ${recall.meaning ? `on (${recall.engine ?? '?'}), ${recall.indexed?.done ?? 0} of ${recall.indexed?.total ?? 0} passages read` : 'off'}${recall.note ? `; ${recall.note}` : ''}`)
  }
  const landedAt = new Map<string, number>()
  const ended = new Set<string>()
  for (const [i, step] of spec.steps.entries()) {
    const n = i + 1
    if (app.budget.hit) {
      sample.status = 'stopped'
      sample.why = app.budget.hit
      break
    }
    const fromRow = app.lastRow()
    const asked = step.plants ?? []
    let got: Awaited<ReturnType<typeof draftStep>> | null = null
    let land: ReturnType<typeof landed> = { ok: true, planted: [], missing: [] }
    let tries = 0
    for (tries = 1; tries <= STEP_TRIES; tries++) {
      try {
        got = await draftStep(app, spec, step, sceneId, page, `${spec.id}-${index}-${n}-${tries}`)
      } catch (e) {
        got = { status: 'error', error: e instanceof Error ? e.message : String(e), generationId: null, text: '' }
      }
      if (got.status !== 'complete' || !got.text.trim()) break
      land = landed(spec, asked, got.text)
      if (!land.ok) {
        // The patterns missed it: the judge is asked once whether it happens, with the words (as write.ts does).
        const checks = landingChecks(spec, land.missing)
        const j = await app.askJudge({ facts: ['The passage carries on a scene; answer only from what it shows.'], checks }, got.text)
        land = landedByJudge(land, checks, j.answers, got.text)
        if (land.planted.some((x) => x.by === 'judge')) cfg.log(`  ${spec.id} chain ${index + 1} step ${n}: the judge found ${land.planted.filter((x) => x.by === 'judge').map((x) => x.id).join(', ')}`)
      }
      if (land.ok) break
      cfg.log(`  ${spec.id} chain ${index + 1} step ${n}: ${land.missing.join(', ')} didn't land; drafting again`)
    }
    const base = { step: n, kind: step.kind, direction: step.direction ?? '', tries: Math.min(tries, STEP_TRIES), generationId: got?.generationId ?? null }
    if (!got || got.status !== 'complete' || !got.text.trim()) {
      sample.steps.push({ ...base, status: got?.status === 'stopped' ? 'stopped' : 'error', error: got?.error ?? 'Nothing was written.', words: 0, text: '', planted: [], results: [], judge: { status: 'skipped', raw: '' }, resolved: [], records: app.recordsSince(fromRow) })
      sample.status = app.budget.hit ? 'stopped' : 'error'
      sample.why = got?.error ?? 'Nothing was written.'
      break
    }
    if (!land.ok) {
      sample.steps.push({ ...base, status: 'skipped', error: `${land.missing.join(', ')} didn't land in ${STEP_TRIES} drafts`, words: countWords(got.text), text: got.text, planted: land.planted, results: [], judge: { status: 'skipped', raw: '' }, resolved: [], records: app.recordsSince(fromRow) })
      sample.status = 'abandoned'
      sample.why = `step ${n}: ${land.missing.join(', ')} didn't land in ${STEP_TRIES} drafts`
      break
    }
    // The checks in force as this step was asked for, scored on its words as written.
    const plants = inForce(spec, landedAt, ended, n)
    const sc = stepChecks(plants)
    const j = await app.askJudge({ facts: sc.facts, checks: sc.checks }, got.text)
    const rename = (rs: CheckResult[]): CheckResult[] => rs.map((r) => ({ ...r, id: sc.judgeIds.get(r.id) ?? r.id, trap: sc.judgeIds.get(r.id) ?? r.trap }))
    const results = excusedByChange(plants, await confirmSlips(app, plants, rename(scorePassage(sc, got.text, j.answers)), got.text), got.text)
    // Lands in the page as the window puts it there; step 3 checks it and mends what it can, as the page does.
    const added = paragraphsOf(got.text)
    let text = got.text
    let repair: ChainStepResult['repair']
    if (app.repairMod) {
      const r = await repairLanded(app, spec.scene, sceneId, page, { generationId: got.generationId, text: got.text }, { keep: true })
      if (r.text !== got.text) {
        const again = await app.askJudge({ facts: sc.facts, checks: sc.checks }, r.text)
        repair = { ...r, judge: { status: again.status, raw: again.raw }, results: excusedByChange(plants, await confirmSlips(app, plants, rename(scorePassage(sc, r.text, again.answers)), r.text), r.text) }
        text = r.text
      } else repair = { ...r, judge: { status: j.status, raw: j.raw }, results }
    }
    page = [...page, ...(text === got.text ? added : paragraphsOf(text))]
    app.save(spec.scene.key, sceneId, page)
    const newly = spec.plants.filter((p) => land.planted.some((x) => x.id === p.id))
    for (const p of land.planted) landedAt.set(p.id, n)
    const resolved = [
      ...new Set([
        ...endedIn(text, plants.filter((p) => spec.plants.includes(p)), newly, land.planted),
        ...results.filter((r) => r.by === 'judge' && r.answer === 'yes' && r.verdict === 'kept' && r.ask.startsWith('Ended?')).map((r) => r.trap)
      ])
    ]
    for (const id of resolved) ended.add(id)
    if (sample.firstSlip == null && results.some((r) => r.verdict === 'broken')) sample.firstSlip = n
    // Adam pauses: the memory reads the scene, what follows a read finishes, and step 5's index catches up.
    await app.pause(sceneId)
    await app.recallReady()
    sample.steps.push({
      ...base,
      status: 'complete',
      error: null,
      words: countWords(got.text),
      text: got.text,
      planted: land.planted,
      results,
      judge: { status: j.status, raw: j.raw, ...(j.asked ? { asked: j.asked } : {}) },
      ...(repair ? { repair } : {}),
      resolved,
      records: app.recordsSince(fromRow)
    })
    cfg.log(
      `  ${spec.id} chain ${index + 1} step ${n} (${step.kind}): ${countWords(got.text)} words${land.planted.length ? `; planted ${land.planted.map((x) => x.id).join(', ')}` : ''}; ${results.map((r) => `${r.id} ${r.verdict}`).join(', ')}${resolved.length ? `; ended ${resolved.join(', ')}` : ''}`
    )
  }
  return sample
}

/** Probes v4: the chains, after the whole written story, each sample from a fresh copy of the same world. */
export async function runChains(cfg: TrapsConfig): Promise<{ report: RunReport; outDir: string }> {
  if (cfg.out && existsSync(join(cfg.out, 'report.json'))) throw new Error(`${cfg.out} already has a report; give another --out folder.`)
  if (cfg.story !== 'v3') throw new Error('Chains (probes v4) run on story version 3; use --probes-version 3 for the hand-written story.')
  const data = storyFor(cfg)
  const chains = CHAINS.filter((c) => !cfg.probes || cfg.probes.includes(c.id))
  if (!chains.length) throw new Error(`No chain called ${cfg.probes?.join(', ')}. The chains are ${CHAINS.map((c) => c.id).join(', ')}.`)
  const startedAt = new Date().toISOString()
  const tested = checkout(cfg.root)
  const stamp = startedAt.slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-')
  const outDir = cfg.out ?? join(cfg.harnessRoot, 'traps-results', `${stamp}-${tested.branch.replace(/[^\w.-]+/g, '-')}-${tested.commit.slice(0, 7)}-chains${cfg.fake ? '-fake' : ''}`)
  const story = storyId(cfg)
  const srcTree = git(cfg.root, ['rev-parse', 'HEAD:src'])

  // A saved world from an earlier run of the same checkout and story (before the chain, or before s24).
  const from = cfg.fromWorld ? findSavedWorld(cfg.fromWorld, 'chain') : null
  if (from) {
    const s = from.saved
    if (s.story !== story) throw new Error(`The saved world ${from.file} was made with another story; it can't be used for this one.`)
    if (s.srcTree !== srcTree || !srcTree || s.dirty || tested.dirty) throw new Error(`The saved world ${from.file} was made with other app code than this checkout's: build it again for this checkout.`)
  }
  cfg.log(`story: ${data.source}, probes v${CHAIN_PROBES_VERSION} (chains)`)
  // A fake run's stand-in writer carries out the chain's directions, so the plants land and the checks run.
  if (cfg.fake) for (const c of chains) for (const st of c.steps) if (st.direction) standInDirections.push(st.direction)
  const app = await openApp(cfg, data, `${data.story.title} (trap story)`, from?.file ?? null)
  let stopped: string | undefined
  let savedWorld: string | undefined
  const results: ChainResult[] = []
  try {
    if (from && JSON.stringify(from.saved.models) !== JSON.stringify(app.models)) throw new Error(`The saved world ${from.file} was built with other models.`)
    // The whole story, as Adam wrote it, read by the memory scene by scene (from where a saved world stops).
    const startAt = from ? from.saved.sceneIndex : 0
    for (const [si, scene] of data.scenes.entries()) {
      if (si < startAt) continue
      if (si === 23 && cfg.saveWorld && !from) {
        // As a probes v3 run saves it, so either kind of run can start there later.
        await app.quiet()
        mkdirSync(outDir, { recursive: true })
        const file = join(outDir, `world-before-${scene.key}.db`)
        if (!existsSync(file)) {
          await app.snapshot(file)
          const meta: SavedWorld = { scene: scene.key, sceneIndex: si, story, commit: tested.commit, srcTree, dirty: tested.dirty, models: app.models, savedAt: new Date().toISOString() }
          writeFileSync(file.replace(/\.db$/, '.json'), JSON.stringify(meta, null, 2))
        }
      }
      if (app.budget.hit) break
      const sceneId = app.makeScene(scene)
      app.save(scene.key, sceneId, scene.paragraphs)
      await app.leave(sceneId)
    }
    await app.quiet()
    if (app.budget.hit) stopped = app.budget.hit
    // The world after the whole story: every chain sample starts from a fresh copy of it.
    mkdirSync(outDir, { recursive: true })
    let chainWorld = from && from.saved.scene === 'chain' ? from.file : join(outDir, 'world-before-chain.db')
    if (!(from && from.saved.scene === 'chain')) {
      if (existsSync(chainWorld)) chainWorld = join(outDir, `world-before-chain-${Date.now()}.db`)
      await app.snapshot(chainWorld)
      const meta: SavedWorld = { scene: 'chain', sceneIndex: data.scenes.length, story, commit: tested.commit, srcTree, dirty: tested.dirty, models: app.models, savedAt: new Date().toISOString() }
      writeFileSync(chainWorld.replace(/\.db$/, '.json'), JSON.stringify(meta, null, 2))
      savedWorld = chainWorld
      cfg.log(`world saved after the whole story: ${chainWorld}`)
    }
    for (const spec of chains) {
      const result: ChainResult = {
        id: spec.id,
        scene: spec.scene.key,
        title: spec.scene.title,
        opening: spec.opening,
        plants: [
          ...spec.plants.map((p) => ({ id: p.id, name: p.name, step: spec.steps.findIndex((s) => s.plants?.includes(p.id)) + 1 || null })),
          ...spec.far.map((p) => ({ id: p.id, name: p.name, step: null }))
        ],
        steps: spec.steps.length,
        samples: []
      }
      results.push(result)
      for (let i = 0; i < cfg.samples && !stopped; i++) {
        await app.reopen(chainWorld)
        cfg.log(`chain ${spec.id} sample ${i + 1}/${cfg.samples}`)
        const m = await runChain(app, cfg, spec, i)
        result.samples.push(m)
        // Each chain's own world, with every record it made, as evidence.
        const file = join(outDir, `evidence-${spec.id}-${i + 1}.db`)
        if (!existsSync(file)) await app.saveEvidence(file)
        if (app.budget.hit) stopped = app.budget.hit
      }
    }
    const used = app.budget.usedNow()
    const summary = chainsAsSummary(results)
    const report: RunReport = {
      storyVersion: data.version,
      probesVersion: CHAIN_PROBES_VERSION,
      storySource: data.source,
      traps: [...CHAINS[0].plants, ...CHAINS[0].far].map(({ id, name }) => ({ id, name })),
      ...(stopped ? { stopped } : {}),
      budget: { maxIn: cfg.maxIn, maxOut: cfg.maxOut, usedIn: used.in, usedOut: used.out },
      ...(savedWorld || from ? { world: { ...(savedWorld ? { saved: savedWorld } : {}), ...(from ? { from: from.file } : {}) } } : {}),
      startedAt,
      finishedAt: new Date().toISOString(),
      fake: cfg.fake,
      tested,
      harness: { root: cfg.harnessRoot, commit: git(cfg.harnessRoot, ['rev-parse', 'HEAD']) || 'unknown' },
      provider: app.providerName,
      prices: cfg.prices,
      models: app.models,
      samples: cfg.samples,
      words: cfg.words,
      probes: [],
      usage: app.usage(),
      summary,
      chains: results,
      chainSummary: summariseChains(results),
      ...(results.some((c) => c.samples.some((m) => m.recall))
        ? { recall: recallSummary(results.flatMap((c) => c.samples.map((m) => ({ id: c.id, scene: c.scene, kind: 'addBelow' as const, asks: '', samples: [], recall: m.recall })))) }
        : {}),
      evidence: { world: join(outDir, 'evidence-<chain>-<n>.db'), index: join(outDir, 'evidence-index.json') }
    }
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
    writeFileSync(join(outDir, 'report.md'), reportMarkdown(report))
    writeFileSync(join(outDir, 'passages.md'), passagesMarkdown(report))
    if (stopped) cfg.log(`stopped before the end: ${stopped}`)
    cfg.log(`tokens used: ${used.in.toLocaleString('en-GB')} in, ${used.out.toLocaleString('en-GB')} out`)
    cfg.log(`report written to ${outDir}`)
    return { report, outDir }
  } finally {
    try {
      mkdirSync(outDir, { recursive: true })
      const index = join(outDir, 'evidence-index.json')
      if (!existsSync(index)) {
        writeFileSync(
          index,
          JSON.stringify(
            {
              note: "Each chain sample's world is evidence-<chain>-<n>.db (rows of its generations table: messages_json is what was sent, response what came back). Judge calls aren't the app's: report.json has each step's question (judge.asked) and reply (judge.raw).",
              chains: results.map((c) => ({ chain: c.id, samples: c.samples.map((m) => ({ sample: m.index + 1, world: `evidence-${c.id}-${m.index + 1}.db`, steps: m.steps.map((s) => ({ step: s.step, kind: s.kind, records: s.records ?? [] })) })) }))
            },
            null,
            2
          )
        )
      }
    } catch (e) {
      cfg.log(`could not save the evidence index: ${e instanceof Error ? e.message : String(e)}`)
    }
    await app.close()
  }
}
