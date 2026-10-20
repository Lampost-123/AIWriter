// Fake replies for the Story builder (src/main/storyBuilder/prompts.ts: system prompts starting "[AIWRITE-STORY v1]
// <job>"). Returns null for any other request. Every reply is deterministic:
//   codex        a list: the author's own entries (from "The author's own characters…"), then Ada Lorne (the lead; she
//                plays the recipe's first cast role when there is one), Bram Holt, the place Gull Harbour inside The
//                Grey Coast, the event The Wreck on Day 2 and the plot thread Who wrecks the ships.
//   codex chat   a question (ending "?") is answered with no list; anything else adds the character Corin Vale.
//   codex redo   the same item, its "about" starting "Redone:" (with the note when there is one).
//   outline      "Premise: …" when asked for one, then 2 chapters of 2 scenes (an act around them when acts are asked
//                for), naming Ada Lorne and Gull Harbour; the first scene sets up "Who wrecks the ships", the last pays it off.
//   plan chat    a question is answered with no plan; a message naming one of the plan's scenes changes that scene (its
//                summary becomes the message, "When: Day 4, dusk"); anything else renames the plan's first chapter "The
//                Betrayal", sent as a change by its tag ("=== Changes ===").
//   plan redo    the act, chapter or scene asked for, titled "A Different Night" (a chapter or act with one scene).
//   recipe chat  a question is answered with no parts; anything else changes the Tone to "Dark and tense".
//   recipe redo  "A new take on this part."
// Models with their own replies (chat-truth R6):
//   fake/plan-wrong-tags  the plan chat claims it moved scenes and sends changes whose tags aren't in the plan.
//   fake/talk-unreadable  the codex and recipe chats claim a change and send a list or parts that don't read.

const MARKER = '[AIWRITE-STORY v1]'

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p?.text ?? '').join('') : '')
const lastUserOf = (messages) => textOf([...messages].reverse().find((m) => m.role === 'user')?.content)
const firstUserOf = (messages) => textOf(messages.find((m) => m.role === 'user')?.content)

/** The author's own entries: "- Name (kind): about" lines under their heading. */
function ownEntries(user) {
  const at = user.indexOf("The author's own characters")
  if (at < 0) return []
  const out = []
  for (const line of user.slice(at).split('\n').slice(1)) {
    const m = /^- (.+?) \(([a-z ]+)\)(?::\s*(.*))?$/.exec(line.trim())
    if (!m) break
    out.push({ name: m[1], kind: m[2], about: m[3] ?? '' })
  }
  return out
}

function codexList(user) {
  const own = ownEntries(user)
  const role = /### Cast roles\n- ([^:\n]+)/.exec(user)?.[1]?.trim() ?? ''
  const list = { characters: [], places: [], groups: [], items: [], lore: [], events: [], threads: [], glossary: [] }
  const KEYS = { character: 'characters', place: 'places', group: 'groups', item: 'items', 'piece of lore': 'lore', lore: 'lore', event: 'events', 'plot thread': 'threads', 'glossary word': 'glossary' }
  for (const e of own) list[KEYS[e.kind] ?? 'characters'].push({ name: e.name, aliases: [], about: e.about || 'The author’s own.' })
  list.characters.push({ name: 'Ada Lorne', aliases: ['Ada'], about: 'The lead: a lighthouse keeper’s daughter who wants to keep the light lit.', role })
  list.characters.push({ name: 'Bram Holt', aliases: [], about: 'A salvager who profits from every wreck.', role: '' })
  list.places.push({ name: 'The Grey Coast', aliases: [], about: 'A cold coast of fog and reefs.', in: '' })
  list.places.push({ name: 'Gull Harbour', aliases: [], about: 'A harbour town under the lighthouse.', in: 'The Grey Coast' })
  list.events.push({ name: 'The Wreck', about: 'A ship runs onto the reef in the night.', when: 'Day 2' })
  list.threads.push({ name: 'Who wrecks the ships', about: 'Someone is putting out the light on purpose.' })
  return list
}

/** The list as it was given ("The list as it stands" block), as JSON. */
function givenList(user) {
  const at = user.indexOf('## The list as it stands')
  if (at < 0) return null
  const rest = user.slice(at).split('\n').slice(1).join('\n')
  const start = rest.indexOf('{')
  let depth = 0
  for (let i = start; i < rest.length; i++) {
    if (rest[i] === '{') depth++
    else if (rest[i] === '}' && --depth === 0) {
      try {
        return JSON.parse(rest.slice(start, i + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

function outline(user, withActs, withPremise) {
  const premise = withPremise ? 'Premise: A lighthouse keeper’s daughter must find out who is wrecking ships before the town gives up on the light.\n\n' : ''
  const scene = (title, when, extra = '') =>
    `### Scene: ${title}\nWhen: ${when}\nSummary: Ada Lorne faces a new trouble at Gull Harbour.\n${extra}- Ada sees something wrong\n- She chooses to act\n- It costs her`
  const chapters = [
    `## Chapter: Grey Water\nGoal: Ada learns the light was put out on purpose.\nPoint of view: Ada Lorne\nCharacters: Ada Lorne, Bram Holt\nLocation: Gull Harbour\nWhen: Day 1, morning\nMood: Wary\n\n${scene('The Dark Lamp', 'Day 1, morning', 'Sets up: Who wrecks the ships\n')}\n\n${scene('Salvage Rights', 'Day 1, evening')}`,
    `## Chapter: The Long Night\nGoal: Ada catches the wrecker.\nPoint of view: Ada Lorne\nLocation: Gull Harbour\nWhen: Day 2, night\nMood: Tense\n\n${scene('The Wreck', 'Day 2, night')}\n\n${scene('Light Again', 'Day 3, dawn', 'Pays off: Who wrecks the ships\n')}`
  ]
  const body = withActs ? `# Act: The Wrecker\nPurpose: Ada finds and stops the wrecker.\n\n${chapters.join('\n\n')}` : chapters.join('\n\n')
  return `${premise}${body}`
}

/** The suggestions as given ("The suggestions still waiting for a decision" block). */
function givenPlan(user) {
  const at = user.indexOf('## The suggestions still waiting for a decision')
  if (at < 0) return ''
  const rest = user.slice(at).split('\n').slice(1).join('\n')
  const next = rest.search(/\n## (?!Chapter:)/)
  return (next < 0 ? rest : rest.slice(0, next)).trim()
}

export function storyReply(system, messages, model = '') {
  if (!system.includes(MARKER)) return null
  const first = firstUserOf(messages)
  const last = lastUserOf(messages)
  const asking = /\?\s*$/.test(last.trim())
  if (system.includes(`${MARKER} codex chat`)) {
    if (model === 'fake/talk-unreadable' && !asking) return 'I’ve added a rival salvager.\n=== Revised list ===\nCorin Vale, a rival salvager.'
    if (asking) return 'Ada Lorne is the lead; Bram Holt is the one who profits from the wrecks.'
    const list = givenList(first) ?? codexList(first)
    list.characters = [...(list.characters ?? []), { name: 'Corin Vale', aliases: [], about: 'A rival salvager with a grudge.', role: '' }]
    return `I added a rival salvager, Corin Vale.\n=== Revised list ===\n${JSON.stringify(list)}`
  }
  if (system.includes(`${MARKER} codex redo`)) {
    const item = /\{"kind":[^\n]*\}/.exec(first)?.[0]
    const it = item ? JSON.parse(item) : { kind: 'character', name: 'Ada Lorne', about: '' }
    const note = /so that: ([^\n]+)\./.exec(first)?.[1] ?? ''
    return JSON.stringify({ ...it, about: `Redone:${note ? ` ${note}.` : ''} ${it.about}`.trim() })
  }
  if (system.includes(`${MARKER} codex`)) return JSON.stringify(codexList(first))
  if (system.includes(`${MARKER} outline`)) return outline(first, /new acts?\b/.test(first), system.includes('Premise: <'))
  if (system.includes(`${MARKER} plan chat`)) {
    if (model === 'fake/plan-wrong-tags' && !asking) {
      return [
        'I’ve moved those scenes to the kitchen.',
        '=== Changes ===',
        'Touches: c9s9',
        '### Scene: The Kitchen [#c9s9]',
        'When: Day 4, dusk',
        'Summary: They talk in the kitchen.',
        '- A beat in the kitchen'
      ].join('\n')
    }
    if (asking) return 'The second chapter is where Ada catches the wrecker.'
    // A message naming one of the scenes changes that scene: what happens in it becomes the message (the Plan hub).
    const scene = [...givenPlan(first).matchAll(/### Scene: ([^\n]*?) (\[#[acs0-9]+\])/g)].find((m) => last.toLowerCase().includes(m[1].trim().toLowerCase()))
    if (scene) {
      const [, title, sceneTag] = scene
      return [
        `I changed “${title.trim()}” as you asked.`,
        '=== Changes ===',
        `Touches: ${sceneTag.slice(1, -1)}`,
        `### Scene: ${title.trim()} ${sceneTag}`,
        'When: Day 4, dusk',
        `Summary: ${last.trim().replace(/\s+/g, ' ')}`,
        '- They cross in the fog',
        '- Someone watches from the far bank',
        '- It ends on what waits there'
      ].join('\n')
    }
    const tag = /## Chapter: [^\n]*?(\[#[acs0-9]+\])/.exec(givenPlan(first))?.[1]
    if (tag) return `I made the first chapter a betrayal.\n=== Changes ===\nTouches: ${tag.slice(1, -1)}\n## Chapter: The Betrayal ${tag}`
    const plan = givenPlan(first) || outline('', false, false)
    return `I made the first chapter a betrayal.\n=== Revised plan ===\n${plan.replace(/## Chapter: [^\n]+/, '## Chapter: The Betrayal')}`
  }
  if (system.includes(`${MARKER} plan redo`)) {
    const s = '### Scene: A Different Night\nWhen: Day 2, night\nSummary: Ada Lorne waits in the dark at Gull Harbour.\n- She hides by the lamp\n- Someone comes up the stairs\n- She sees who it is'
    if (system.includes('one scene card')) return s
    if (system.includes('one chapter')) return `## Chapter: A Different Night\nGoal: Ada keeps watch.\n\n${s}`
    return `# Act: A Different Night\nPurpose: Ada keeps watch.\n\n## Chapter: The Watch\nGoal: Ada keeps watch.\n\n${s}`
  }
  if (system.includes(`${MARKER} recipe chat`)) {
    if (model === 'fake/talk-unreadable' && !asking) return 'I’ve made the tone darker.\n=== Changed parts ===\nDarker, all through.'
    if (asking) return 'The tone is quiet and wry.'
    return 'I made the tone darker.\n=== Changed parts ===\n## Tone\nDark and tense'
  }
  if (system.includes(`${MARKER} recipe redo`)) return 'A new take on this part.'
  return null
}
