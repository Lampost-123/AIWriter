// Fake replies for Story recipes (src/main/recipes/prompts.ts: system prompts starting "[AIWRITE-RECIPE v1] <step>").
// Returns null for any other request. Every reply is deterministic:
//   chapter  Notes on the chapter. On purpose, its Roles line names the first name in the chapter ("the lead (Mara)"),
//            as a careless model would, so the check against the story has something to find.
//   combine  "Name: A quiet coastal mystery", then every part under its "## <Part>" heading. Cast roles repeat the
//            names the notes let slip ("- The lead, Mara: ..."); the sample passage is new words; genre and
//            content come as "Genres: mystery, Cosy. Violence: restrained. ..." (read back as Mystery and Cosy).
//   fix      The parts it was given, with every name listed in "Leave out these names: ..." replaced by "the lead".
//   story    "Premise: ..." (it carries the guidance under "## My guidance"), then the plan in the outline helper's
//            form: "Plan the new story: the premise, then 2 acts with 4 chapters in all ... and 2 scenes in each chapter"
//            gives two acts sharing four chapters, two scenes each; "... 3 chapters with 2 scenes in each. No acts." none.
// The model fake/recipe-fail fails every chapter call (an HTTP 500 is the server's; here: an empty answer).

const MARKER = '[AIWRITE-RECIPE v1]'

const userOf = (messages) => String(messages.find((m) => m.role === 'user')?.content ?? '')

/** The first capitalised word in the middle of a sentence: what the story calls someone. */
function firstName(text) {
  const m = text.match(/[a-z,;] ([A-Z][a-z]{2,})\b/)
  return m ? m[1] : null
}

const PARTS = {
  Themes: '- Belonging: the outsider is offered a place and must decide what it costs.\n- Act one is wary and grey; act two warms; act three is bright and sure.',
  Tone: 'Quiet, wry and hopeful',
  'Point of view': 'Close third person, one character at a time',
  Tense: 'Past',
  'Writing style': 'Plain, short sentences with the odd long one for weather. Little description, much inner thought. Scenes open on a small task and close on a turn.',
  'Sample passage':
    'The kettle had boiled twice before anyone thought to pour it. Outside, the gulls argued over a crust, and the woman by the window pretended not to listen to the argument inside. She had come for a week. It had been a month.',
  Shape: '- Act one (0%–30%): the outsider arrives and is tested.\n- Turning point at 30%: the offer.\n- Act three (70%–100%): the choice.',
  Pacing: 'Short chapters of about the same length, with more dialogue as it goes on.',
  Devices: '- A set-up in the first chapter pays off in the last.\n- A recurring motif: the tide.',
  // Mixed case and a word the app doesn't know, as a model might write it: the recipe keeps it in the app's labels.
  'Genre and content': 'Genres: mystery, Cosy. Violence: restrained. Language: Mild. Romance: smouldering.'
}

function chapterNotes(user) {
  const text = user.split('## The chapter')[1] ?? ''
  const name = firstName(text)
  return [
    'Moves:',
    '- the outsider arrives and is watched',
    '- a small kindness is offered and refused',
    'Roles:',
    `- the lead${name ? ` (${name})` : ''}: wants to belong but hides it`,
    'Tension: rises at the end of the chapter.',
    'Tone: wary',
    'Devices:',
    '- the tide as a motif',
    'Style: close third person, past tense, short sentences.'
  ].join('\n')
}

function combine(user) {
  const names = [...new Set([...user.matchAll(/the lead \(([A-Z][a-z]+)\)/g)].map((m) => m[1]))]
  const chapters = Number(user.match(/The story has (\d+) chapter/)?.[1] ?? 1)
  const beats = Array.from({ length: chapters }, (_, i) => `Chapter ${i + 1}: the outsider is offered a place and turns it down.`).join('\n')
  const cast = `- The lead${names[0] ? `, ${names[0]}` : ''}: an outsider who learns to stay.\n- The mentor: kind, and hiding a debt.`
  const out = ['Name: A quiet coastal mystery', '']
  for (const [head, body] of Object.entries(PARTS)) {
    out.push(`## ${head}`, body, '')
    if (head === 'Shape') out.push('## Beats', beats, '', '## Cast roles', cast, '')
  }
  return out.join('\n')
}

function fix(user) {
  const names = (user.match(/Leave out these names: ([^.\n]+)\./)?.[1] ?? '').split(/,\s*/).filter(Boolean)
  let body = user.slice(user.indexOf('## '))
  for (const n of names) body = body.replace(new RegExp(`\\b${n}\\b`, 'g'), 'the lead').replace(/The lead, the lead/g, 'The lead')
  return body
}

const ACTS = ['The Arrival', 'The Offer', 'The Choice', 'The Storm', 'The Return', 'The Harbour']
const CHAPTERS = ['Grey Water', 'The Ferry Bell', 'Salt Bread', 'A Lamp Left On', 'The Long Pier', 'Low Tide', 'The Net Loft', 'Weather Coming', 'Home Port']
const TIMES = ['morning', 'afternoon', 'evening', 'night']

function story(user) {
  const guidance = (user.split('## My guidance')[1] ?? '').split('\n## ')[0].replace(/^[^\n]*\n/, '').trim()
  const ask = user.match(/Plan the new story:[^\n]*/)?.[0] ?? ''
  const acts = Number(ask.match(/then (\d+) acts? with/)?.[1] ?? 0)
  const chapters = Number(ask.match(/(\d+) chapters? (?:in all|with)/)?.[1] ?? 3)
  const scenes = Number(ask.match(/(\d+) scenes? in each/)?.[1] ?? 2)
  const out = [`Premise: A newcomer finds a place to belong. ${guidance && !guidance.startsWith('None') ? `Set as asked: ${guidance.replace(/\s+/g, ' ')}` : ''}`.trim(), '']
  let c = 0
  const chapter = () => {
    const title = CHAPTERS[c % CHAPTERS.length]
    out.push(`## Chapter: ${title}`, `Goal: The newcomer moves one step closer to staying.`, '')
    for (let s = 0; s < scenes; s++) {
      out.push(`### Scene: ${title} ${['at first light', 'by the water', 'after dark', 'in the rain'][s % 4]}`, `When: Day ${c + 1}, ${TIMES[s % 4]}`, 'Summary: Something small changes.', '- A choice is offered', '- It is refused', '- The cost shows', '')
    }
    c++
  }
  if (acts > 0) {
    for (let a = 0; a < acts; a++) {
      out.push(`# Act: ${ACTS[a % ACTS.length]}`, 'Purpose: It moves the story on.', '')
      const here = Math.floor(chapters / acts) + (a < chapters % acts ? 1 : 0)
      for (let k = 0; k < here; k++) chapter()
    }
  } else for (let k = 0; k < chapters; k++) chapter()
  return out.join('\n')
}

/** The reply for a Story recipes request, or null when it isn't one. */
export function recipeReply(system, messages, model = '') {
  if (!String(system).startsWith(MARKER)) return null
  const step = String(system).slice(MARKER.length).trim().split(/\s/)[0]
  const user = userOf(messages ?? [])
  if (step === 'chapter') return model === 'fake/recipe-fail' ? '' : chapterNotes(user)
  if (step === 'combine') return combine(user)
  if (step === 'fix') return fix(user)
  if (step === 'story') return story(user)
  return null
}
