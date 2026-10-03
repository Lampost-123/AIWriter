// Fake replies for the World builder's AI calls (src/main/worldBuilder/prompts.ts: system prompts starting
// "[AIWRITE-WORLD v1] <job>"). Each reads the author's summary (between """ marks in the last user message)
// one sentence at a time, with these rules, so tests know exactly what a summary makes:
//   overview       Lists, by kind:
//                    a sentence ending "?"                        a plot thread named by it ("Who sank the Merrow")
//                    "X always ..." or "X never ..."              lore X, a rule never to break
//                    "The X happened|took place|began|ended|struck [in|on|at|during W]"
//                                                                 event "The X", when "in W" ("on Day 3"
//                                                                 gives "Day 3": a day of the story)
//                    'The word "w" means ...' or '"w" means ...'  glossary word w
//                    "X is a/an ... town|city|village|port|land|island|kingdom|castle|tavern|inn|forest|
//                     valley|harbour|river|mountain|coast [... in Y]"
//                                                                 place X, inside Y
//                    "... the X Guild|Order|Company|Brotherhood|Council|Crew|Clan|House"
//                                                                 group "X Guild" (anywhere in a sentence)
//                    "... keeps|carries|wears|holds|owns the X"   item X (capitalised words)
//                    a sentence starting with a capitalised name and "is|was|keeps|carries|wears|holds|
//                    owns|has|loves|hates|owes|belongs" or "'s"   a character; a first name alone ("Mara") is
//                                                                 an other name of the full one ("Mara Venn")
//                  The model fake/world-junk answers it with words, not JSON (a reply that can't be used).
//   character      {"fromNotes": {"name", "aliases" (its other names), "summary": the first sentence that
//                  starts with its name}, "drafted": every other field the prompt lists, as "<Label> of
//                  <name>, drafted to fit the world." ("supporting" for role, two lines for sample lines)}.
//   places, groups, items, lore, events, threads, glossary
//                  {"<job>": [one profile for each thing asked for, in order]}: "name", then "in" (a place's
//                  "inside"), "rule" (lore: true when its sentence says always or never) or "involved" (an
//                  event: the characters being laid out that its sentence names); "fromNotes" holds the
//                  name and the first sentence naming it, in summary (places, groups, items, glossary
//                  words), rules (lore), happened (events) or promise (plot threads), and an event's "when";
//                  "drafted" every other field, as for a character.
//   relationships  "A is B's <type>." gives {"from": A, "to": B, "type": <type>}; "A belongs to the G" or
//                  "A is a member of the G" gives {"from": A, "to": G, "type": "member"} (names from the lists).
//   themes         {"themes": "Debt, family and what the sea takes back.", "tone": "Salt-stung and wary, with
//                  dry humour."}, only the ones asked for.
//   check          "X is N." or "X is N years old." against a page for X whose [age] says otherwise:
//                  {"conflicts": [{"name": X, "field": "age", "summary": N, "quote": the sentence}]}.
// Returns null for any other request.

const MARKER = '[AIWRITE-WORLD v1]'

const lastUser = (messages) => {
  const users = (messages ?? []).filter((m) => m.role === 'user').map((m) => String(m.content ?? ''))
  // A request asked again after a reply that couldn't be used ends with the retry; the summary is in the first.
  return users.find((u) => u.includes('"""')) ?? users[users.length - 1] ?? ''
}
const summaryIn = (user) => user.match(/"""\n([\s\S]*?)\n"""/)?.[1] ?? ''
const sentencesOf = (text) =>
  text
    .split(/\n+/)
    .flatMap((l) => l.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean)
const bare = (s) =>
  String(s)
    .toLowerCase()
    .replace(/^the /, '')
    .replace(/[^a-z0-9' ]/g, '')
    .trim()
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const names = (text, name) => new RegExp(`(^|[^A-Za-z])${escape(name)}([^A-Za-z]|$)`).test(text)

const PLACE_WORDS = 'town|city|village|port|land|island|kingdom|castle|tavern|inn|forest|valley|harbour|river|mountain|coast'
const PLACE = new RegExp(`^(.+?) is an? (?:[\\w'-]+ )*?(?:${PLACE_WORDS})\\b(.*)\\.$`)
/** The place a place is inside: its sentence ends "in [the] Name". */
const INSIDE = / in ((?:the )?[A-Z][\w']*(?: [A-Z][\w']*)*)$/
const GROUP = /\b((?:The )?[A-Z][\w']*(?: [A-Z][\w']*)* (?:Guild|Order|Company|Brotherhood|Council|Crew|Clan|House))\b/g
const ITEM = /\b(?:keeps|carries|wears|holds|owns) (?:the |a |an )?([A-Z][\w']*(?: [A-Z][\w']*)*)/g
const EVENT = /^(The [A-Z][\w']*(?: [A-Z][\w']*)*) (?:happened|took place|began|ended|struck)(?: ((?:in|on|at|during) [^,.]+))?/
const CHARACTER = /^([A-Z][a-z]+(?: [A-Z][a-z]+)?)(?='s| (?:is|was|keeps|carries|wears|holds|owns|has|loves|hates|owes|belongs)\b)/
const GLOSSARY = /^(?:The word )?["“]([^"”]+)["”] means (.+?)\.?$/

function overview(summary) {
  const out = { characters: [], places: [], groups: [], items: [], lore: [], events: [], threads: [], glossary: [] }
  const taken = new Set()
  const add = (list, item) => {
    const key = bare(item.name)
    if (!key || taken.has(key)) return
    taken.add(key)
    list.push(item)
  }
  const said = sentencesOf(summary)
  for (const s of said) {
    let m
    if (s.endsWith('?')) {
      add(out.threads, { name: s.replace(/\?$/, ''), about: s })
      continue
    }
    if ((m = s.match(GLOSSARY))) {
      add(out.glossary, { name: m[1], about: m[2] })
      continue
    }
    if ((m = s.match(/^(.+?) (?:always|never) /))) {
      add(out.lore, { name: m[1], about: s, rule: true })
      continue
    }
    if ((m = s.match(EVENT))) {
      add(out.events, { name: m[1], about: s, when: (m[2] ?? '').replace(/^on (Day \d+)$/, '$1') })
      continue
    }
    if ((m = s.match(PLACE))) add(out.places, { name: m[1], aliases: [], about: s, in: m[2].match(INSIDE)?.[1] ?? '' })
    for (const g of s.matchAll(GROUP)) add(out.groups, { name: g[1], aliases: [], about: s })
    for (const it of s.matchAll(ITEM)) add(out.items, { name: it[1], aliases: [], about: s })
  }
  for (const s of said) {
    const name = s.match(CHARACTER)?.[1]
    if (!name || taken.has(bare(name))) continue
    const full = out.characters.find((c) => c.name.includes(' ') && c.name.split(' ')[0] === name)
    if (full) {
      if (!full.aliases.includes(name)) full.aliases.push(name)
      continue
    }
    add(out.characters, { name, aliases: [], about: s })
  }
  return JSON.stringify(out, null, 1)
}

/** The fields the system prompt lists, after "Fields (key: what it holds)". */
function fieldsIn(system) {
  const block = system.split('Fields (key: what it holds)')[1]?.split(/\n\s*\n/)[0] ?? ''
  return [...block.matchAll(/^- ([A-Za-z]+): ([^(\n]+?)(?: \(|$)/gm)].map((m) => ({ key: m[1], label: m[2].trim() }))
}

/** The things asked for: "- Name (also: a, b) [inside X; when: Y]: about". */
function itemsIn(user) {
  const block = user.split(/\n(?:The character to lay out|The [a-z ]+ to lay out):\n/)[1]?.split(/\n\s*\n/)[0] ?? ''
  return block
    .split('\n')
    .map((l) => l.match(/^- (.+?)(?: \(also: ([^)]*)\))?(?: \[([^\]]*)\])?(?:: (.*))?$/))
    .filter(Boolean)
    .map((m) => ({
      name: m[1].trim(),
      aliases: (m[2] ?? '')
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
      inside: m[3]?.match(/inside ([^;]+)/)?.[1]?.trim() ?? '',
      when: m[3]?.match(/when: ([^;]+)/)?.[1]?.trim() ?? ''
    }))
}

/** "<Label> of <name>, drafted to fit the world." for every field not already filled. */
function drafted(fields, name, have) {
  const out = {}
  for (const f of fields) {
    if (f.key in have || f.key === 'name' || f.key === 'aliases') continue
    if (f.key === 'sampleLines') out.sampleLines = '"Pay first, then we talk."\n"The tide doesn\'t wait, and neither do I."'
    else if (f.key === 'role') out.role = 'supporting'
    else out[f.key] = `${f.label} of ${name}, drafted to fit the world.`
  }
  return out
}

const OWN_FIELD = {
  place: 'summary',
  group: 'summary',
  item: 'summary',
  lore: 'rules',
  event: 'happened',
  thread: 'promise',
  glossary: 'summary'
}
const KIND_OF = { places: 'place', groups: 'group', items: 'item', lore: 'lore', events: 'event', threads: 'thread', glossary: 'glossary' }

function character(system, user) {
  const summary = summaryIn(user)
  const who = itemsIn(user)[0] ?? { name: 'Corvin Ashe', aliases: [] }
  const said = sentencesOf(summary)
  const fromNotes = { name: who.name }
  if (who.aliases.length) fromNotes.aliases = who.aliases.join(', ')
  const own = said.find((s) => s.startsWith(who.name)) ?? said.find((s) => [who.name, ...who.aliases].some((n) => names(s, n)))
  if (own) fromNotes.summary = own
  return JSON.stringify({ fromNotes, drafted: drafted(fieldsIn(system), who.name, fromNotes) }, null, 1)
}

function batch(job, system, user) {
  const kind = KIND_OF[job]
  const summary = summaryIn(user)
  const said = sentencesOf(summary)
  const people = (user.match(/^- Characters: (.+)$/m)?.[1] ?? '').split('; ').filter(Boolean)
  const fields = fieldsIn(system)
  const list = itemsIn(user).map((it) => {
    const own = said.find((s) => [it.name, ...it.aliases].some((n) => names(s, n)))
    const fromNotes = { name: it.name }
    if (own) fromNotes[OWN_FIELD[kind]] = own
    if (kind === 'event' && it.when && summary.includes(it.when)) fromNotes.when = it.when
    const out = { name: it.name }
    if (kind === 'place') out.in = it.inside
    if (kind === 'lore') out.rule = !!own && /\b(always|never)\b/.test(own)
    if (kind === 'event') out.involved = people.filter((p) => own && names(own, p))
    return { ...out, fromNotes, drafted: drafted(fields, it.name, fromNotes) }
  })
  return JSON.stringify({ [job]: list }, null, 1)
}

function relationships(user) {
  const people = (user.match(/^Characters: (.+)$/m)?.[1] ?? '').split('; ').filter(Boolean)
  const groups = (user.match(/^Groups: (.+)$/m)?.[1] ?? '').split('; ').filter(Boolean)
  const find = (list, text) => list.find((n) => bare(n) === bare(text) || n.split(' ')[0] === text.trim())
  const out = []
  for (const s of sentencesOf(summaryIn(user))) {
    let m
    if ((m = s.match(/^(.+?) is (.+?)['’]s (.+?)\.$/))) {
      const from = find(people, m[1])
      const to = find(people, m[2])
      if (from && to) out.push({ from, to, type: m[3], feels: '', otherFeels: '' })
    } else if ((m = s.match(/^(.+?) (?:belongs to|is a member of) (?:the )?(.+?)\.$/))) {
      const from = find(people, m[1])
      const to = find(groups, m[2])
      if (from && to) out.push({ from, to, type: 'member', feels: '', otherFeels: '' })
    }
  }
  return JSON.stringify({ relationships: out }, null, 1)
}

function themes(system) {
  const shape = system.split('Reply with:')[1] ?? ''
  const out = {}
  if (shape.includes('"themes"')) out.themes = 'Debt, family and what the sea takes back.'
  if (shape.includes('"tone"')) out.tone = 'Salt-stung and wary, with dry humour.'
  return JSON.stringify(out)
}

function check(user) {
  const pages = (user.split('Pages already in the world:')[1] ?? '').split("The author's summary")[0]
  const said = sentencesOf(summaryIn(user))
  const conflicts = []
  for (const block of pages.split(/\n\s*\n/)) {
    const name = block.trim().match(/^(.+?) \([a-z ]+\)$/m)?.[1]
    const age = block.match(/^- \[age\] [^:]+: (.+)$/m)?.[1]?.trim()
    if (!name || !age) continue
    for (const s of said) {
      const m = s.match(new RegExp(`^${escape(name)} is (\\d+)(?: years old)?\\.$`))
      if (m && m[1] !== age) conflicts.push({ name, field: 'age', summary: m[1], quote: s })
    }
  }
  return JSON.stringify({ conflicts })
}

export function worldReply(system, messages, model) {
  if (!system.startsWith(MARKER)) return null
  const job = system.slice(MARKER.length).trim().split(/\s/)[0]
  const user = lastUser(messages)
  if (job === 'overview') return model === 'fake/world-junk' ? 'I read it, and it is a fine world.' : overview(summaryIn(user))
  if (job === 'character') return character(system, user)
  if (job in KIND_OF) return batch(job, system, user)
  if (job === 'relationships') return relationships(user)
  if (job === 'themes') return themes(system)
  if (job === 'check') return check(user)
  return null
}
