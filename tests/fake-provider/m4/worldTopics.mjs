// Fake replies for the interviews by topic (src/main/worldInterviews/: system prompts starting
// "[AIWRITE-WORLD v1] topic-questions <topic>" and "[AIWRITE-WORLD v1] topic-suggest <topic>").
//
// Questions: each topic has three, asked two then one ({"questions": [...]}), then {"done": true}. A question counts as
// asked once its words are in the request (the interview so far), so tests know each round:
//   characters  Who is the main character, and what do they want most? / Who stands in their way, and why? /
//               How does the main character talk?
//   places      Where does the story mostly happen? / Which smaller places inside it matter most? /
//               How does it feel to be there?
//   lore        How does magic work, and what does it cost? / What happened in the past that still matters? /
//               What is always true in your world?
//   connections Who lives or works where? / Who knows which secrets? / How do the characters feel about each other?
// The model fake/world-junk answers with words and nothing usable.
//
// Suggestions are made from the answers ("Answer: ..." lines), one sentence at a time:
//   "<Name> is|was|wants|keeps|rules|runs ...": a page named <Name> (its sentence the summary). A character's sentence
//   with "wants" also fills "wants"; one with "talks" or "speaks" fills "speech". A place's "<Name> is inside <Other>"
//   (or "is in <Other>") gives "in". Lore with "always" or "never" is a rule. Further sentences about the same name
//   add to it.
//   Connections: "<A> lives at|works at|rules|knows about|was shaped by <B>" a relationship of that type;
//   "<A> is <B>'s <word>" a relationship "<word> of"; "<A> is inside <B>" a place inside another;
//   "<A>'s secret is <text>" words for <A>'s empty Secrets. Each with why: the sentence.
// Returns null for any other request.

const MARKER = '[AIWRITE-WORLD v1] topic-'

export const TOPIC_QUESTIONS = {
  characters: ['Who is the main character, and what do they want most?', 'Who stands in their way, and why?', 'How does the main character talk?'],
  places: ['Where does the story mostly happen?', 'Which smaller places inside it matter most?', 'How does it feel to be there?'],
  lore: ['How does magic work, and what does it cost?', 'What happened in the past that still matters?', 'What is always true in your world?'],
  connections: ['Who lives or works where?', 'Who knows which secrets?', 'How do the characters feel about each other?']
}

const NAME = "[A-Z][\\w'’-]*(?: (?:of |the )?[A-Z][\\w'’-]*)*"

function sentencesOf(user) {
  const answers = [...user.matchAll(/^\s*Answer: (.+)$/gm)].map((m) => m[1].trim())
  return answers.flatMap((a) => a.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean))
}

function pages(topic, user) {
  const out = new Map()
  for (const s of sentencesOf(user)) {
    const m = s.match(new RegExp(`^((?:The )?${NAME}) (is|was|wants|keeps|rules|runs|talks|speaks|costs|happened)\\b`))
    if (!m) continue
    const name = m[1]
    const e = out.get(name) ?? { name, aliases: [], summary: s, fields: {} }
    if (topic === 'characters') {
      if (/\bwants\b/.test(s)) e.fields.wants = s
      if (/\b(talks|speaks)\b/.test(s)) e.fields.speech = s
      if (!e.fields.traits && e.summary !== s) e.fields.traits = s
    }
    if (topic === 'places') {
      const inside = s.match(new RegExp(`\\bis (?:inside|in) ((?:the )?${NAME})`))
      if (inside) e.in = inside[1]
      else if (e.summary !== s) e.fields.atmosphere = s
    }
    if (topic === 'lore') {
      if (/\b(always|never)\b/.test(s)) e.rule = true
      if (/\bcosts?\b/.test(s)) e.fields.limits = s
      else if (e.summary !== s) e.fields.rules = s
    }
    out.set(name, e)
  }
  return [...out.values()]
}

function links(user) {
  const out = []
  for (const s of sentencesOf(user)) {
    let m = s.match(new RegExp(`^(${NAME}) (lives at|works at|rules|knows about|was shaped by) (?:the )?(${NAME})`))
    if (m) {
      out.push({ from: m[1], to: m[3], type: m[2], feels: '', otherFeels: '', why: s })
      continue
    }
    m = s.match(new RegExp(`^((?:The )?${NAME}) is inside ((?:the )?${NAME})`))
    if (m) {
      out.push({ from: m[1], inside: m[2], why: s })
      continue
    }
    m = s.match(new RegExp(`^(${NAME}) is (${NAME})['’]s ([a-z ]+?)[.!]?$`))
    if (m) {
      out.push({ from: m[1], to: m[2], type: `${m[3]} of`, feels: 'fond of them', otherFeels: '', why: s })
      continue
    }
    m = s.match(new RegExp(`^(${NAME})['’]s secret is (.+?)[.!]?$`))
    if (m) out.push({ entry: m[1], field: 'secrets', text: `${m[2][0].toUpperCase()}${m[2].slice(1)}.`, why: s })
  }
  return out
}

export function worldTopicsReply(system, messages, model) {
  if (!system.startsWith(MARKER)) return null
  const [job, topic] = system.slice('[AIWRITE-WORLD v1] '.length).split('\n')[0].trim().split(/\s+/)
  if (model === 'fake/world-junk') return 'I read it, and it is a fine world.'
  const user = (messages ?? [])
    .filter((m) => m.role === 'user')
    .map((m) => String(m.content ?? ''))
    .join('\n')
  if (job === 'topic-questions') {
    const all = TOPIC_QUESTIONS[topic] ?? []
    const left = all.filter((q) => !user.includes(q))
    if (!left.length) return JSON.stringify({ done: true })
    return JSON.stringify({ questions: left.slice(0, left.length === all.length ? 2 : 1) })
  }
  if (job === 'topic-suggest') {
    const first = String((messages ?? []).find((m) => m.role === 'user')?.content ?? '')
    if (topic === 'connections') return JSON.stringify({ links: links(first) })
    return JSON.stringify({ entries: pages(topic, first) })
  }
  return null
}
