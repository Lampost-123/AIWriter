// Fake replies for Write the whole chapter (src/main/chapterWriter/prompts.ts: system prompts starting
// "[AIWRITE-CHAPTER v1] <job>"), so tests know exactly what a run does:
//   plan  Offered the look-ups and with none answered yet, it looks up Mara (state_of) when the request names her; then
//         write_chapter_plan: the overview "A fake chapter plan.", whose chapter it is (the first card's point of view, else
//         Mara when the request names her), what they want ("To get across before dark."), what is against them ("The
//         river is up.") and how it turns ("The ferry leaves without them."); for each "### Sc N" heading in the request
//         a part that "does" "Sc N moves the chapter on.", ends with "Sc N ends on the far bank.", keeps "Keep Sc N true
//         to the memory." and has the card's point of
//         view and the people it has there change ("ends Sc N further on her way"); questions ["Sc 1's card has Mara at the
//         inn; the memory has her at the ferry."] when the request names Mara; and the title "The Far Bank" when the
//         request asks for a name for the chapter ("give it one in `title`"). Asked at its last request (no tools), it
//         sends the same plan as JSON (chapterReply).
//   fix   The passage to rewrite (between the triple quotes under "## The passage to rewrite") sent back with
//         " The rain went on." at the end of its last paragraph.
// The model fake/agent-words answers every request in words, never calling a tool nor writing the plan's JSON (the app
// makes the plan from the cards alone). The model fake/agent-greedy first looks things up, three at a time (Mara, what
// happened, a search, Ch 1's scenes, Tobin, the threads, the timeline), as a live model did (2026-10-16), until the app
// says there are no more look-ups; then it goes on as above. The model fake/agent-packs first loads the check-continuity
// instruction pack (load_instructions, when offered) with its look-up of Mara, as the list asks; then as above. The
// model fake/fix-same sends a fix back unchanged (the app can't use it). Returns null for any other request.

const MARKER = '[AIWRITE-CHAPTER v1]'

/** What fake/agent-greedy looks up, in turn. */
const GREEDY = [
  ['state_of', { name: 'Mara' }],
  ['what_happened', {}],
  ['find_in_story', { query: 'ferry' }],
  ['read_passage', { scene: 'Ch 1, Sc 1' }],
  ['get_entry', { name: 'Tobin' }],
  ['open_threads', {}],
  ['read_passage', { scene: 'Ch 1, Sc 2', part: 'start' }],
  ['timeline', {}]
]

const contentOf = (m) => (typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.map((p) => p.text ?? '').join('') : '')

const jobOf = (system) => (String(system).startsWith(MARKER) ? String(system).slice(MARKER.length).trim().split(/\s/)[0] : null)

/** The plan the fake writes, from the planner's opening. */
function fakePlan(user) {
  const heads = user
    .split(/\n(?=### Sc \d+)/)
    .map((part) => ({ scene: /^### (Sc \d+)/.exec(part)?.[1], card: part.split('\n## ')[0] }))
    .filter((h) => h.scene)
  const firstPov = heads.map((h) => /^Point of view: (.+)$/m.exec(h.card)?.[1]?.trim()).find(Boolean)
  return {
    overview: 'A fake chapter plan.',
    lead: firstPov ?? (/\bMara\b/.test(user) ? 'Mara' : ''),
    wants: 'To get across before dark.',
    against: 'The river is up.',
    turn: 'The ferry leaves without them.',
    scenes: heads.map(({ scene, card }) => {
      const pov = /^Point of view: (.+)$/m.exec(card)?.[1]?.trim()
      const present = (/^Characters present: (.+)$/m.exec(card)?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean)
      return {
        scene,
        does: `${scene} moves the chapter on.`,
        ends: `${scene} ends on the far bank.`,
        threads: [],
        changes: [...(pov ? [pov] : []), ...present].map((who) => ({ who, change: `ends ${scene} further on her way` })),
        keep: [`Keep ${scene} true to the memory.`]
      }
    }),
    questions: /\bMara\b/.test(user) ? ["Sc 1's card has Mara at the inn; the memory has her at the ferry."] : [],
    ...(/give it one in `title`/.test(user) ? { title: 'The Far Bank' } : {})
  }
}

export function chapterToolCalls(system, messages, tools, model = '') {
  const job = jobOf(system)
  if (!job || !Array.isArray(tools) || !tools.length) return null
  if (model === 'fake/agent-words' || job !== 'plan') return null
  const user = contentOf(messages.find((m) => m.role === 'user'))
  const calls = messages.flatMap((m) => (m.tool_calls ?? []).map((c) => c.function?.name))
  const offered = new Set(tools.map((t) => t.function?.name ?? t.name))
  if (calls.includes('write_chapter_plan') && !messages.some((m) => m.role === 'tool' && contentOf(m).startsWith('Not kept'))) return null
  if (model === 'fake/agent-greedy' && !messages.some((m) => m.role === 'tool' && contentOf(m).startsWith('No more look-ups'))) {
    const looks = GREEDY.filter(([name]) => offered.has(name))
    if (looks.length) return [0, 1, 2].map((i) => ({ name: looks[(calls.length + i) % looks.length][0], arguments: looks[(calls.length + i) % looks.length][1] }))
  }
  const answered = messages.some((m) => m.role === 'tool')
  if (model === 'fake/agent-packs' && !answered && offered.has('load_instructions')) {
    return [{ name: 'load_instructions', arguments: { name: 'check-continuity' } }, { name: 'state_of', arguments: { name: 'Mara' } }]
  }
  if (!answered && offered.has('state_of') && /\bMara\b/.test(user)) return [{ name: 'state_of', arguments: { name: 'Mara' } }]
  return [{ name: 'write_chapter_plan', arguments: fakePlan(user) }]
}

/** The reply in words: the plan's JSON at its last request, or a fixed passage. Null for any other request. */
export function chapterReply(system, messages, model = '') {
  const job = jobOf(system)
  if (!job) return null
  const user = contentOf((messages ?? []).find((m) => m.role === 'user'))
  if (job === 'plan') return model === 'fake/agent-words' ? null : JSON.stringify(fakePlan(user))
  if (job === 'fix') {
    const passage = /## The passage to rewrite[^\n]*\n"""\n([\s\S]*?)\n"""/.exec(user)?.[1] ?? ''
    if (!passage) return null
    if (model === 'fake/fix-same') return passage
    return `${passage} The rain went on.`
  }
  return null
}
