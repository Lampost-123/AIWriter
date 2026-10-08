// The chat eval's big briefing (Phase 1, the "real" set): a third story in the same invented world, "Saltreach
// Winters", long enough that the editor chat's system message is as big as a long novel's (aim: 30-60k tokens). It has
// hundreds of entries of its own (made in story C, so stories A and B never see them and the 40 core scenarios keep
// their small briefing), ninety earlier scenes each with a summary (the story so far), and a long open scene (well
// past read_scene's 24,000 characters) with a few hand-written paragraphs the scenarios aim at. The last scene has a
// card and no words yet ("draft the scene from the card").
//
// Every word is invented and generated from the small lists below with a fixed seed, so every run sees the same world.
// Data only: no app imports. Only scenarios marked `big` open story C, and the harness seeds it only when one runs.

import { CANARIES, type EvalEntry, type EvalScene } from './world'

/** A fixed-seed random number generator (mulberry32), so the world is the same every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = rng(20261008)
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]

export const STORY_C = {
  title: 'Saltreach Winters',
  premise:
    'The winter after the tally went wrong, Ilse Marrow keeps the boats of Saltreach through the worst cold the coast has known, while the town quarrels over who owes what to whom.'
} as const

export const C_CHAPTERS = [
  'First Frost',
  'The Net Lofts',
  'A Debt at Candlemas',
  'The Pilchard Fleet',
  'Weir Week',
  'The Rope Walk',
  'Salt and Tar',
  'The Long Dark',
  'Chapel Point',
  'The Thaw That Wasn’t',
  'Ice on the Quay',
  'Winter Tally'
] as const

// ---------- Entries ----------

const FIRST = ['Aldous', 'Benna', 'Caddock', 'Dilys', 'Ebbo', 'Fennick', 'Garrow', 'Hollis', 'Isolde', 'Jory', 'Kitto', 'Loveday', 'Merryn', 'Nessa', 'Ottery', 'Perran', 'Ruan', 'Senara', 'Tamsin', 'Ulick', 'Veryan', 'Wenlock', 'Yestin', 'Zennor', 'Agnes', 'Borlase', 'Cador', 'Demelza', 'Elowen', 'Fenna']
const SURNAME = ['Penhallow', 'Treloar', 'Annear', 'Bolitho', 'Carne', 'Dunstan', 'Eddy', 'Gilbert', 'Hosking', 'Jago', 'Kemp', 'Lanyon', 'Mabyn', 'Nance', 'Opie', 'Pascoe', 'Rowse', 'Skewes', 'Trethewey', 'Vosper']
const TRADE = ['net-mender', 'cooper', 'boat-builder', 'chandler', 'fish-wife', 'rope-maker', 'lighterman', 'publican', 'carter', 'salt-boiler', 'sailmaker', 'pilot', 'curate', 'schoolmistress', 'baker', 'smith', 'tide-clerk', 'oyster-dredger', 'lamp-trimmer', 'widow of a pilot']
const MANNER = ['quick to laugh and slower to forgive', 'quiet, careful, and owed money by half the town', 'loud in the inn and silent at home', 'kind to children and hard on everyone else', 'a gossip who is right more often than not', 'proud of a grandfather nobody else remembers', 'superstitious about the moon and the colour green', 'honest to a fault and unlucky with it', 'always cold, always wrapped in two coats', 'fond of Hesper and afraid of her in equal measure']
const WANT = ['wants a boat of their own before spring', 'wants the debt at Candlemas forgiven', 'wants to leave Saltreach and never says so', 'wants Ilse to take their side in the quarrel over the weir', 'wants the net lofts rebuilt before the storms', 'wants to be asked to keep the vigil', 'wants their son home from the pilchard fleet', 'wants to know who moved the boundary stones']
const SECRET = ['once borrowed a boat and never told the owner', 'keeps a second tally of their own in a tin box', 'cannot read, and hides it well', 'saw something on the quay the night of the first frost', 'owes the chandler more than they can pay', 'writes letters to a sister who stopped answering years ago']

const PLACE_A = ['North', 'Gull', 'Weir', 'Cobble', 'Rope', 'Net', 'Tar', 'Lantern', 'Kelp', 'Oyster', 'Shingle', 'Brine', 'Hollow', 'Pilchard', 'Chapel', 'Mussel', 'Crab', 'Heron']
const PLACE_B = ['Lane', 'Quay', 'Yard', 'Steps', 'Cove', 'Row', 'Point', 'Loft', 'Store', 'Field', 'Rocks', 'Cottages']
const PLACE_SAY = ['where the fishing families mend nets in the lee of the wall', 'a steep, cobbled run that ices over first in any frost', 'where the boats are drawn up above the winter tide line', 'with a pump that freezes and a bench where the old men sit', 'that smells of tar and wet rope whatever the weather', 'half fallen down since the storm two winters back', 'where the carters turn their wagons and argue about the toll', 'a place the children are told to keep away from after dark']

const ITEM_A = ['brass', 'oak', 'tin', 'whalebone', 'tarred', 'cracked', 'blue', 'iron', 'horn', 'copper']
const ITEM_B = ['compass', 'lantern', 'ledger', 'oar', 'net-needle', 'tide table', 'sea chest', 'pipe', 'knife', 'whistle']
const ITEM_SAY = ['handed down through three families and argued over by all of them', 'kept behind the bar at the inn for anyone who needs it', 'found on the shingle after the first frost and claimed by no one', 'mended so many times that little of the first one is left', 'that Hesper says brings bad luck on a Friday', 'lent to the Marrows and never quite given back']

const LORE_A = ['Frost', 'Candlemas', 'Tide-line', 'Boat-blessing', 'Net-burning', 'Weir', 'Lamp-trimming', 'First-catch', 'Toll', 'Ferry']
const LORE_B = ['Custom', 'Rule', 'Saying', 'Debt', 'Reckoning']
const LORE_SAY = ['Nobody in Saltreach sells a boat in winter; it is lent, and the debt is settled at Candlemas.', 'Whoever finds the first ice on the quay must break it before anyone else walks there.', 'A net that tears twice in one week is burnt on the shingle, never mended a third time.', 'The weir is shared by the four families above the bridge, and any quarrel about it goes to the tide-clerk.', 'What is owed at the year’s end is written in chalk on the inn door and wiped off only when paid.', 'No one keeps the vigil alone on the longest night; two go up, or none.']

const sentenceCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

function makeEntries(): EvalEntry[] {
  const out: EvalEntry[] = []
  const seen = new Set<string>()
  const add = (e: Omit<EvalEntry, 'storyC'>): void => {
    if (seen.has(e.name.toLowerCase())) return
    seen.add(e.name.toLowerCase())
    out.push({ ...e, storyC: true })
  }
  for (let i = 0; out.length < 420; i++) {
    const name = `${FIRST[i % FIRST.length]} ${SURNAME[(i * 7 + Math.floor(i / FIRST.length)) % SURNAME.length]}`
    const trade = pick(TRADE)
    const age = 18 + Math.floor(rand() * 60)
    add({
      key: `c-char-${i}`,
      kind: 'character',
      name,
      summary: `${name}, ${trade} of Saltreach, ${age} years old; ${pick(MANNER)}. ${sentenceCase(pick(WANT))}.`,
      description: `${name} is ${age} and works as the town’s ${trade}. ${sentenceCase(pick(MANNER))}. ${name.split(' ')[0]} ${pick(WANT)}, and ${pick(SECRET)}. In the winter of the great cold ${name.split(' ')[0]} lives near ${pick(PLACE_A)} ${pick(PLACE_B)} and is seen most mornings on the quay.`
    })
  }
  for (const a of PLACE_A)
    for (const b of PLACE_B) {
      if (rand() < 0.35) continue
      const name = `${a} ${b}`
      add({ key: `c-place-${name}`, kind: 'place', name, summary: `${name}, Saltreach: ${pick(PLACE_SAY)}.`, description: `${name} lies on the ${pick(['east', 'west', 'north', 'harbour'])} side of Saltreach, ${pick(PLACE_SAY)}. In the great cold it is ${pick(['empty by noon', 'busier than ever', 'where the town meets to argue', 'buried under drifts'])}.` })
    }
  for (const a of ITEM_A)
    for (const b of ITEM_B) {
      if (rand() < 0.3) continue
      const name = `The ${a} ${b}`
      add({ key: `c-item-${name}`, kind: 'item', name, summary: `A ${a} ${b} ${pick(ITEM_SAY)}.`, description: `The ${a} ${b} is ${pick(ITEM_SAY)}. ${sentenceCase(pick(['it has a name scratched on it that nobody can read', 'it is kept wrapped in oilcloth', 'it was last seen at the inn', 'Hesper keeps it on the mantel']))}.` })
    }
  for (const a of LORE_A)
    for (const b of LORE_B) {
      const name = `The ${a} ${b}`
      add({ key: `c-lore-${name}`, kind: 'lore', name, summary: pick(LORE_SAY), description: `${pick(LORE_SAY)} ${pick(LORE_SAY)} The older families keep to it; the newer ones grumble and keep to it anyway.` })
    }
  return out
}

export const C_ENTRIES: EvalEntry[] = makeEntries()

// ---------- The story so far: ninety earlier scenes, each with a summary ----------

const C_EVENTS = [
  'argue over the weir until the tide-clerk is sent for',
  'find two boats stove in on the shingle after the night’s frost',
  'count the nets in the lofts and come up three short',
  'sit up with a sick child while the wind brings the snow in',
  'walk the boundary stones and find one moved a yard inland',
  'chalk a new debt on the inn door and then rub half of it out',
  'take the pilchard fleet’s last catch up to the salt-house',
  'break the first ice on the quay before anyone else is awake',
  'quarrel about whose turn it is to keep the vigil',
  'mend the rope walk’s roof with tarred canvas in a hailstorm'
]
const C_AFTER = [
  'Nobody says who started it, and nobody forgets it either.',
  'Ilse writes it all in the tally book and tells Hesper none of it.',
  'By evening half the town has taken a side.',
  'Hesper hears of it at the bakery and says nothing at supper.',
  'Bram laughs it off on the quay and is quiet for the rest of the day.',
  'The debt is written down, and the chalk is still there at the end of the week.'
]
const C_DETAIL = [
  'The cold is worse than anyone can remember.',
  'Snow lies on the ferry steps down to the waterline.',
  'The harbour freezes at the edges for the first time in a generation.',
  'The inn runs out of coal and burns old oars.',
  'Gulls come right into the lanes for scraps.',
  'The ferry does not run for three days.'
]

const C_SAID = [
  'Nobody sells a boat in winter, they lend it',
  'You can’t count what’s under the snow',
  'The weir was ours before it was anybody’s',
  'Write it on the door and let the town see',
  'If the ferry doesn’t run, nothing runs',
  'I’ll pay at Candlemas, same as always'
]

export interface BigScene {
  key: string
  chapter: number
  title: string
  paragraphs: string[]
  summary: string
  card?: EvalScene['card'] & { beats?: string[] }
}

function makeEarlier(): BigScene[] {
  const chars = C_ENTRIES.filter((e) => e.kind === 'character').map((e) => e.name)
  const places = C_ENTRIES.filter((e) => e.kind === 'place').map((e) => e.name)
  const out: BigScene[] = []
  for (let i = 0; i < 90; i++) {
    const chapter = Math.floor(i / 8)
    const a = pick(chars)
    const b = pick(chars.filter((c) => c !== a))
    const place = pick(places)
    const ev = pick(C_EVENTS)
    const summary = [
      `${a} and ${b} ${ev} at ${place}.`,
      pick(C_AFTER),
      `Ilse ${pick(['watches from the wall', 'is sent to fetch Hesper', 'keeps out of it until she can’t', 'takes the tally book along', 'counts what is left'])}, and ${pick(['Bram turns up late, cap pushed back', 'Quill writes nothing down', 'Hesper’s note arrives too late to matter', 'Pitch barks at the gulls the whole time'])}.`,
      pick(C_DETAIL),
      `${b.split(' ')[0]} ${pick(WANT)}, and by the end of the scene ${a.split(' ')[0]} knows it.`,
      `${pick(['It sets up the quarrel over the weir', 'It is the first sign that the Candlemas debts will not be paid', 'It is the night the town starts calling it the great cold', 'It is where the second tally is first mentioned'])}.`,
      `“${pick(C_SAID)},” ${pick([a, b]).split(' ')[0]} says, and ${pick(['nobody answers', 'Hesper writes it down later', 'the inn goes quiet', 'Bram pretends not to hear', 'Quill nods as if he knew already'])}.`,
      `Afterwards ${pick(['the chalk on the inn door is longer by a line', 'two more families take a side', 'the ferry stays tied up another day', 'Ilse adds a column to the tally book', 'the vigil is kept by two instead of one'])}, and ${pick(C_DETAIL).toLowerCase()}`
    ].join(' ')
    out.push({
      key: `c-earlier-${i}`,
      chapter,
      title: `${pick(['Morning', 'Night', 'Noon', 'Dusk'])} at ${place}`,
      paragraphs: [`${a} and ${b} ${ev} at ${place}. ${pick(C_DETAIL)}`],
      summary
    })
  }
  return out
}

export const C_EARLIER: BigScene[] = makeEarlier()

// ---------- The open scene: long, with a few hand-written paragraphs the scenarios aim at ----------

const WINTER_SENTENCES = [
  'The snow came on again, fine and dry, and blew along the quay in long white snakes.',
  'Somewhere a door banged, and banged again, and nobody went to shut it.',
  'The boats lay on the shingle with their keels to the sky like a row of sleeping animals.',
  'Her breath hung in front of her and would not go away.',
  'Gulls stood on the ice at the harbour’s edge and looked offended by it.',
  'The ferry rocked at its moorings, white with frost from the stem to the tiller.',
  'Smoke went straight up from every chimney in the town and then lay flat over the water.',
  'She stamped her boots on the cobbles to feel her feet again.',
  'Up at the inn someone was singing, badly, and someone else was telling him to stop.',
  'The tide was out, and the mud of the harbour had frozen into ridges like a ploughed field.',
  'A cart went by with its wheels wrapped in sacking against the ice.',
  'The light was the colour of pewter and did not change all morning.',
  'Pitch ran ahead of her and came back, ran ahead and came back.',
  'The rope walk’s long roof was white, and the rope inside it was stiff as wire.',
  'Every sound carried: a shovel, a cough, a gull, the sea.'
]

function winterMiddle(count: number): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const picks: string[] = []
    for (let j = 0; j < 6; j++) picks.push(WINTER_SENTENCES[(i * 4 + j * 7) % WINTER_SENTENCES.length])
    out.push([...new Set(picks)].join(' '))
  }
  return out
}

/** The hand-written paragraphs (the scenarios' targets), by name. */
export const WINTER = {
  opening:
    'Snow had come to Saltreach in the night, which it almost never did, and by morning the ferry steps were white to the waterline. Ilse stood at the top of them with the tally book under her arm and counted the boats drawn up on the shingle: four, where there should have been six.',
  drags:
    'She went down the steps slowly, and then more slowly, because the snow was soft over ice and she did not want to fall, and she thought as she went about the boats, and about who might have taken them, and about whether it mattered, and about the cold, which was very cold, colder than she could remember it being for a long time, perhaps ever, and about Hesper, who would want to know, and about how she would tell her.',
  hesper: '“Two boats,” Hesper said, when Ilse told her. She did not look up from the stove. “Well. I suppose somebody needed them more than we did.”',
  boathouse: 'Bram was at the boathouse already, sweeping snow from the doorway with a broom that had lost half its bristles. He saw her coming and stopped sweeping, and then started again, faster.',
  counted: '“You counted,” he said. It was not a question.\n“I always count,” Ilse said.',
  muddled:
    'Quill comes along the wall at noon, and he had his harbour book, and he stops by the boathouse, he looked at the two empty cradles and he writes something down, which he never did, and then he goes away again without a word to either of them.',
  ending: 'Ilse walked home along the harbour wall. The snow had started again. She was tired, and she went to bed.'
} as const

/** The open scene: the targets near the start (inside read_scene's first 24,000 characters), the ending far past it. */
export function winterParagraphs(): string[] {
  const mid = winterMiddle(70)
  return [WINTER.opening, WINTER.drags, ...mid.slice(0, 3), WINTER.hesper, ...mid.slice(3, 6), WINTER.boathouse, WINTER.counted, ...mid.slice(6, 9), WINTER.muddled, ...mid.slice(9), WINTER.ending]
}

export const C_OPEN: BigScene = {
  key: 'winter',
  chapter: C_CHAPTERS.length - 1,
  title: 'Winter Tally',
  paragraphs: winterParagraphs(),
  summary:
    'Snow at Saltreach. Ilse finds two of the six boats gone from the shingle, tells Hesper, who shrugs it off, and goes down to the boathouse where Bram is sweeping snow and will not meet her eye. Quill comes by and, for once, writes something down.',
  card: { pov: 'ilse', present: ['ilse', 'hesper', 'bram', 'quill', 'pitch'], location: 'saltreach', goal: 'Ilse finds two boats missing after the snow.', when: 'Winter, the morning after the first snow' }
}

/** The last scene: a card and no words yet ("draft the scene from the card"). */
export const C_EMPTY: BigScene = {
  key: 'boathouse',
  chapter: C_CHAPTERS.length - 1,
  title: 'The Boathouse at Night',
  paragraphs: [],
  summary: '',
  card: {
    pov: 'ilse',
    present: ['ilse', 'bram'],
    location: 'saltreach',
    goal: 'Ilse goes back to the boathouse after dark to make Bram tell her where the two boats went.',
    when: 'Winter, that night',
    beats: ['Ilse finds the boathouse door unbarred and a lamp lit inside.', 'Bram admits he lent the boats to the Penhallows against the Candlemas debt.', 'Ilse makes him promise to tell Hesper himself, before morning.']
  }
}

/** Chapter summaries (the story so far's shorter forms use them). */
export const C_CHAPTER_SUMMARIES: string[] = C_CHAPTERS.map(
  (title, i) => `${title}: ${pick(C_EVENTS)}; ${pick(C_AFTER).toLowerCase()} ${pick(C_DETAIL)} ${i < C_CHAPTERS.length - 1 ? 'The chapter ends with the town no closer to agreeing who owes what.' : ''}`.trim()
)

// The big world must never carry a canary word (they mean a leak from somewhere else).
{
  const all = JSON.stringify([C_ENTRIES, C_EARLIER, C_OPEN, C_EMPTY, C_CHAPTER_SUMMARIES, STORY_C, C_CHAPTERS]).toLowerCase()
  for (const words of Object.values(CANARIES)) for (const w of words) if (all.includes(w.toLowerCase())) throw new Error(`The big world carries the canary "${w}".`)
}
