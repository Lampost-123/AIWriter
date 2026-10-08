// A door locked with someone outside, said in one line (the writer lab, 2026-10-08). In its round E nearly every real
// slip was the Continue straight after the lock, where the writer brought Ash back through a door the stage said was
// locked from inside, with Wren holding the key.
// The facts were there, as separate lines ("the yard door: shut and locked from inside", "the key: in Wren's pocket",
// "Ash: out in the yard"); nothing put them together. This adds one plain line a person to "Where things stand" when the
// stage shows a door locked, barred or bolted from inside and someone outside: they are outside, the door is locked and
// who has the key, and if they come back in, someone unlocks it on the page first. Pure: only what the writer is told.
// The stage as kept is untouched.

import { thingsOf, type CharacterState, type SceneState } from '@shared/continuity'

/** A thing that is a way in or out. */
const DOOR = /\b(?:door|gate|hatch|trapdoor)\b/i
/** How it is held shut. */
const FAST = /\b(locked|barred|bolted)\b/gi
/** Not held shut after all, or held from the other side. */
const NOT_FAST =
  /\b(?:unlocked|unbarred|unbolted|(?:not|no longer|never|isn['’]t|wasn['’]t) (?:\w+ )?(?:locked|barred|bolted)|(?:locked|barred|bolted) (?:\w+ )?from (?:the )?outside|ajar|(?:stood|swung|standing|wide|half|left) open)\b/i
/** Someone outside, by where the stage has them. */
const OUTSIDE =
  /\b(?:outside|out of doors|outdoors|out (?:in|at|on|under|across|by|into|to) the\b|out of the (?:[a-z]+ )?(?:house|inn|tavern|mill|cottage|farmhouse|hall|building|door|gate)|(?:across|over|crossing|crossed) the (?:yard|courtyard|stable ?yard|lane|street|road|garden)|(?:in|into|to) the (?:yard|stable|stables|stall|stalls|street|lane|road|rain|dark|night|garden|courtyard|shed|stable ?yard|byre|barn|paddock|field|woods)|at the (?:stable|stables|stall|shed|well|woodpile|byre|barn|gate)|in (?:his|her|their|its) stall)\b/i
/** Gone out through a door the stage names. */
const WENT_OUT = /\b(?:went|gone|go|goes|going|stepped|slipped|let (?:himself|herself|themselves)) out\b/i
/** Back in the room, by where the stage has them (a coming in wins over the going out before it). */
const BACK_IN = /\b(?:back in(?:side)?|(?:came|come|comes|coming) (?:back )?in(?:side)?|let (?:back )?in|indoors|inside the (?:room|parlour|house|inn|kitchen))\b/i
/** A place in the room ("by the fire", "at the table"): someone there is in, whatever they last did. */
const INDOORS =
  /\b(?:in|by|at|on|beside|near) the (?:fire|hearth|fireside|settle|table|bed|window|parlour|kitchen|taproom|room|bar|counter|stairs|landing|cellar)\b/i

const plain = (s: string): string => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()
/** "the yard door" → "yard door": what the stage's words for a person may name it by. */
const core = (name: string): string => plain(name).replace(/^(?:the|a|an)\s+/, '')
const withThe = (name: string): string => (/^(?:the|a|an)\s/i.test(name) || /['’]s\s/.test(name) ? name : `the ${name}`)
const first = (name: string): string => name.trim().split(/\s+/)[0]
const joinAnd = (xs: string[]): string => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** A door held shut from inside, with how ("locked", "barred", "bolted", in the stage's order). */
interface FastDoor {
  name: string
  how: string[]
}

/** The doors the stage has locked, barred or bolted from inside (a door with no side said is taken as from inside). */
export function fastDoors(state: SceneState): FastDoor[] {
  return thingsOf(state)
    .filter((t) => DOOR.test(t.name) && !/\bkey\b/i.test(t.name))
    .map((t) => ({ name: t.name.trim(), state: t.state ?? '' }))
    .filter((t) => !NOT_FAST.test(t.state))
    .map((t) => ({ name: t.name, how: [...new Set([...t.state.matchAll(FAST)].map((m) => m[1].toLowerCase()))] }))
    .filter((t) => t.how.length > 0)
}

/** Who has the key: a person the key's place names ("in Wren's pocket"), or someone the stage has holding a key. */
export function keyHolder(state: SceneState): string | null {
  const people = state.characters
  const names = (c: CharacterState): string[] => [c.name, first(c.name)].map(plain)
  for (const t of thingsOf(state).filter((x) => /\bkey\b/i.test(x.name))) {
    const where = plain(`${t.state ?? ''}`)
    if (/\bin the lock\b/.test(where)) return null
    const who = people.find((c) => names(c).some((n) => n && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(where)))
    if (who) return who.name
  }
  const holding = people.find((c) => /\bkey\b/i.test(c.holding) && !/\bno key\b/i.test(c.holding))
  return holding?.name ?? null
}

/** Where someone is, by the stage: their place and what they last did (round G: "gone out of the back parlour, across
 * the yard to the stall" as the place, and "went out across the yard" as the last thing done). */
const placeWords = (c: CharacterState): string => plain(`${c.where || ''} ${c.lastAction || ''}`)

/** Whether the stage has someone outside the room, and which of the doors they went out through (null: none named). */
function outThrough(c: CharacterState, doors: FastDoor[]): { out: boolean; door: FastDoor | null } {
  const w = placeWords(c)
  const where = plain(c.where || '')
  // A place in the room wins over a going out in what they last did (done before they came back).
  if (!w || BACK_IN.test(w) || (INDOORS.test(where) && !OUTSIDE.test(where))) return { out: false, door: null }
  const named = doors.find((d) => w.includes(core(d.name))) ?? null
  const out = OUTSIDE.test(w) || (!!named && WENT_OUT.test(w)) || (!!named && /\bthrough\b/.test(w))
  return { out, door: named }
}

const UNDO: Record<string, string> = { locked: 'unlocks', barred: 'unbars', bolted: 'unbolts' }

/**
 * One line for each person the stage has outside while a door is locked, barred or bolted from inside: "Ash
 * Penrose is outside; the yard door is locked from inside and Wren Hollis has the key. If Ash comes back in, someone
 * unlocks it on the page first." The door is the one their place names, or with none named, every door held shut.
 * `only`: just these people (names), as stateText's. None when no door is held shut or no one is out.
 */
export function lockLines(state: SceneState | null | undefined, only?: string[]): string[] {
  if (!state) return []
  const doors = fastDoors(state)
  if (!doors.length) return []
  const holder = keyHolder(state)
  const wanted = only?.map((n) => n.toLowerCase())
  const lines: string[] = []
  for (const c of state.characters) {
    if (wanted && !wanted.some((n) => c.name.toLowerCase() === n || c.name.toLowerCase().startsWith(`${n} `))) continue
    if (holder && c.name === holder) continue
    const { out, door } = outThrough(c, doors)
    if (!out) continue
    const these = door ? [door] : doors
    const how = [...new Set(these.flatMap((d) => d.how))]
    const what = joinAnd(these.map((d) => withThe(d.name)))
    const verb = these.length > 1 ? 'are' : 'is'
    const key = how.includes('locked') && holder ? ` and ${holder} has the key` : ''
    const undo = joinAnd(how.map((h) => UNDO[h]))
    const it = these.length > 1 ? 'them' : 'it'
    // "By any door": round G's writer brought Ash in through a "yard door" it made up, the locked one left alone.
    lines.push(
      `${c.name} is outside; ${what} ${verb} ${joinAnd(how)} from inside${key}. If ${first(c.name)} comes back in, by any door, someone ${undo} ${it} on the page first.`
    )
  }
  return lines
}

/** A stage block's text with the lock lines after it (unchanged when there are none). */
export const withLockLines = (text: string, state: SceneState | null | undefined, only?: string[]): string => {
  const lines = lockLines(state, only)
  return lines.length ? `${text}\n${lines.join('\n')}` : text
}
