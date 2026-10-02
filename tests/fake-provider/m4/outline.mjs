// Fake replies for the outline part's AI calls (system prompts starting "[AIWRITE-OUTLINE v1] <job>",
// see src/main/outline/prompts.ts). Returns null for any other request. Every reply is deterministic.
//
// outline  The plan the briefing's last part asks for, in the form the system prompt gives:
//          "Suggest 2 new acts with 4 chapters in all, spread across them, and 3 scenes in each chapter"
//          gives two "# Act:" headings with the chapters shared out (the first acts get any left over),
//          each "## Chapter:" with a "Goal:" line and three "### Scene:" cards (a "Summary:" line and
//          three beats, after a "When:" line). "Suggest 3 chapters with 2 scenes in each ... No acts." gives no
//          act headings. Each chapter is one day and its scenes run "morning", "midday", "afternoon", "dusk",
//          "evening", "night": "When: Day 1, morning". The first day is Day 1, or the day after the one the
//          briefing's "Its last scene with a When is set at “Day N…”" names, or Day N for "Its first scene
//          is set at “Day N…”".
//          Titles come from fixed lists: acts "The Arrival", "The Turning", "The Reckoning"...;
//          chapters "Rain on the Narrows", "The Ferryman's Price", "Lanterns at Low Tide"...; scenes
//          "Arrival at the docks", "A bargain at the docks"... (each chapter has its own place, so
//          every title is different). Act and chapter titles the briefing already names (the story's
//          own) are passed over, so asking again after keeping carries on with new ones. The first
//          chapter's goal names the story's first open plot thread when the briefing has one
//          ("... and “Who burned the mill?” comes back to haunt her.").
//          "[[fake: messy]]" in the briefing wraps the same plan in a chatty reply: an introduction,
//          numbered and bold headings ("**Act 1: The Arrival**"), "**When:**" labels, "*" bullets and a
//          closing note.
// ideas    Three directions, "## 1. The door left open", "## 2. A debt called in", "## 3. The
//          wrong messenger", each with one sentence on what happens and four beats.

const MARKER = '[AIWRITE-OUTLINE v1]'

const ACTS = [
  ['The Arrival', 'Mara reaches the city and learns what the guild wants of her.'],
  ['The Turning', 'Her loyalties split when the guild turns on the people she came to protect.'],
  ['The Reckoning', 'Everything she hid comes out, and she has to choose a side for good.'],
  ['The Long Night', 'The city burns while Mara and Tobin try to get everyone out.'],
  ['The Crossing', 'They leave the city behind and find out what waits across the water.'],
  ['The Return', 'Mara comes home changed, and settles what she left unfinished.']
]

const CHAPTERS = [
  'Rain on the Narrows',
  "The Ferryman's Price",
  'Lanterns at Low Tide',
  'The Locked Room',
  'A Debt Called In',
  'Smoke over Lowtown',
  'The Bell Tower',
  'What Tobin Knew',
  'The Last Crossing',
  'Salt and Ashes',
  'The Guild Hall',
  'A Night without Stars'
]

const PLACES = [
  'the docks',
  'the ferry',
  'the market',
  'the tower',
  'the guild hall',
  'the bridge',
  'the archive',
  'the old mill',
  'the harbour',
  'the chapel',
  'the walls',
  'the gate'
]

const SCENES = [
  [
    'Arrival at',
    'Mara arrives at {place} and finds it watched.',
    ['Mara comes in out of the rain', 'She spots the guild’s watcher', 'She slips away before he follows']
  ],
  [
    'A bargain at',
    'Tobin offers Mara a deal at {place} that she can’t refuse.',
    ['Tobin names his price', 'Mara haggles and loses', 'They shake on it, both lying']
  ],
  [
    'Pursuit through',
    'The guild chases Mara through {place}.',
    ['A shout behind her', 'She doubles back through the crowd', 'She loses them, but not her hood']
  ],
  [
    'A quiet word at',
    'An old friend warns Mara at {place}.',
    ['The friend finds her alone', 'He tells her who sold her out', 'She asks him to keep quiet']
  ],
  [
    'The door at',
    'Mara finds a locked door at {place} and what it hides.',
    ['She picks the lock', 'The room is not empty', 'She takes the ledger and runs']
  ],
  ['Aftermath at', 'Mara counts the cost at {place}.', ['She tends her hand', 'Tobin brings bad news', 'She decides to go back']]
]

const IDEAS = `## 1. The door left open
Mara finds the guild house unguarded and walks into a trap meant for someone else.
- Mara finds the side door unlatched
- She overhears Tobin bargaining with the guild master
- A bell rings and the doors bar behind her
- She escapes over the rooftops with the ledger

## 2. A debt called in
Tobin calls in the favour Mara owes him, and it costs her an old friend.
- Tobin waits for her at the ferry
- He names the job: steal back the ledger
- Mara agrees, then learns who holds it
- She warns her friend instead, and Tobin sees

## 3. The wrong messenger
A child brings Mara a message meant for the guild, and she reads it.
- A soaked child presses a note into her hand
- The note names tonight's raid on the Narrows
- Mara follows the child to find who sent it
- She has to decide whether to deliver it
`

const TIMES = ['morning', 'midday', 'afternoon', 'dusk', 'evening', 'night']

/** The day the plan's first scene is on, from what the briefing says of the story's dated scenes. */
function firstDay(text) {
  const last = text.match(/Its last scene with a When is set at “Day (\d+)/)
  if (last) return Number(last[1]) + 1
  const first = text.match(/Its first scene is set at “Day (\d+)/)
  return first ? Number(first[1]) : 1
}

const ordinal = (n) => ['', ' again', ' once more', ' at last'][Math.min(3, Math.floor(n))]

/** The indexes of the titles in `list` that the briefing doesn't name yet (all of them when it names every one). */
function unused(list, titleOf, briefing) {
  const left = list.map((_, k) => k).filter((k) => !briefing.includes(titleOf(list[k])))
  return left.length ? left : list.map((_, k) => k)
}

function plan(size, thread, briefing) {
  const out = []
  const day = firstDay(briefing)
  const acts = size.acts
  const per =
    acts > 0
      ? Array.from({ length: acts }, (_, i) => Math.floor(size.chapters / acts) + (i < size.chapters % acts ? 1 : 0))
      : [size.chapters]
  const actsLeft = unused(ACTS, (a) => a[0], briefing)
  const chaptersLeft = unused(CHAPTERS, (t) => t, briefing)
  let c = 0
  per.forEach((count, a) => {
    if (acts > 0) {
      const [title, purpose] = ACTS[actsLeft[a % actsLeft.length]]
      out.push({ kind: 'act', title, purpose })
    }
    for (let i = 0; i < count; i++, c++) {
      // Each chapter title has its own place, so the scene titles don't repeat either.
      const k = chaptersLeft[c % chaptersLeft.length]
      const round = c / chaptersLeft.length
      const title = `${CHAPTERS[k]}${ordinal(round)}`
      const place = PLACES[k % PLACES.length]
      const goal =
        c === 0 && thread
          ? `Mara finds her footing in the city, and “${thread}” comes back to haunt her.`
          : `Mara follows the trail to ${place}.`
      out.push({ kind: 'chapter', title, goal })
      for (let s = 0; s < size.scenes; s++) {
        const [opener, summary, beats] = SCENES[s % SCENES.length]
        const again = s >= SCENES.length ? ' again' : ''
        const at = `${place}${ordinal(round)}`
        const when = `Day ${day + c}, ${TIMES[s % TIMES.length]}`
        out.push({ kind: 'scene', title: `${opener} ${at}${again}`, when, summary: summary.replace('{place}', at), beats })
      }
    }
  })
  return out
}

function tidy(items) {
  return items
    .map((it) => {
      if (it.kind === 'act') return `# Act: ${it.title}\nPurpose: ${it.purpose}\n`
      if (it.kind === 'chapter') return `## Chapter: ${it.title}\nGoal: ${it.goal}\n`
      return `### Scene: ${it.title}\nWhen: ${it.when}\nSummary: ${it.summary}\n${it.beats.map((b) => `- ${b}`).join('\n')}\n`
    })
    .join('\n')
}

function messy(items) {
  let a = 0
  let c = 0
  let s = 0
  const lines = ['Here is a possible outline for the story, carrying on from where it stands:', '']
  for (const it of items) {
    if (it.kind === 'act') {
      lines.push(`**Act ${++a}: ${it.title}**`, `*Purpose:* ${it.purpose}`, '')
    } else if (it.kind === 'chapter') {
      s = 0
      lines.push(`## Chapter ${++c} – ${it.title}`, `**Goal:** ${it.goal}`, '')
    } else {
      lines.push(`### Scene ${++s}: "${it.title}"`, `**When:** ${it.when}`, it.summary, ...it.beats.map((b) => `* ${b}`), '')
    }
  }
  lines.push('Let me know if you would like more scenes or a different ending.')
  return lines.join('\n')
}

/** How much the briefing's last part asks for. */
function sizeOf(text) {
  const withActs = text.match(/Suggest (\d+) new acts? with (\d+) chapters? in all, spread across them, and (\d+) scenes? in each chapter/)
  if (withActs) return { acts: Number(withActs[1]), chapters: Number(withActs[2]), scenes: Number(withActs[3]) }
  const without = text.match(/Suggest (\d+) chapters? with (\d+) scenes? in each/)
  if (without) return { acts: 0, chapters: Number(without[1]), scenes: Number(without[2]) }
  return { acts: 1, chapters: 2, scenes: 2 }
}

/** The name of the first open plot thread the briefing lists ("## Open plot threads" then "- The stolen ledger: ..."). */
function firstThread(text) {
  const m = text.match(/## Open plot threads\n- ([^:\n(]+?)(?::|\s\(|\n|$)/)
  return m ? m[1].trim() : null
}

export function outlineReply(system, messages, _model) {
  if (!system.startsWith(MARKER)) return null
  const job = system.slice(MARKER.length).trim().split(/\s/)[0]
  const user = messages
    .filter((m) => m.role === 'user')
    .map((m) => String(m.content ?? ''))
    .join('\n')
  if (job === 'ideas') return IDEAS
  if (job === 'outline') {
    const items = plan(sizeOf(user), firstThread(user), user)
    return user.includes('[[fake: messy]]') ? messy(items) : tidy(items)
  }
  return null
}
