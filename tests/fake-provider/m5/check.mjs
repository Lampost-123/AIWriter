// Fake replies for the consistency checks (src/main/checks/prompts.ts: every request about a scene has the system prompt
// "[AIWRITE-CHECK v2] scene ...", and one that makes checks says which in its task, after the scene:
// "[AIWRITE-CHECK-TASK v1] <checks>"; a request with another task, a second opinion, isn't answered here). They read the
// memory in the request (each entry under a heading "### E1 Mara (character; ...)", its fields as "- Eyes: blue" lines
// and "What has happened so far:" items) and the scene's text (everything after the "## The scene" heading, up to the
// task), with these rules, so tests know exactly what a scene raises:
//   facts   "<Name>'s eyes are|were|flashed|shone <colour>" or "<Name>'s <colour> eyes" (either apostrophe), when the memory gives
//           <Name> other eyes: a warning about the eyes field, with a fix that puts the memory's colour back
//           (and "memory" / "text", so a field of Adam's can be updated from it).
//           A line of dialogue said by <Name> ("...," said Name / Name said / Name asked, replied, whispered,
//           shouted) when the memory says <Name> died, is dead or was killed: must fix, with no fix.
//   other checks find nothing.
//   story   (comparing two stories) finds nothing.
//   Every reply also says what each check looked at ("checked"): "Looked at <check>.", ok unless it raised something.
//   The scene's contract (long story memory fix 13, "## The scene’s contract (C ids)", the chapter writer's checks):
//           "<Name> is dead: ..." is broken when <Name> speaks (quoting the line; the death isn't raised again as an
//           issue); something that must change is kept when every word of four letters or more is in the scene, else
//           not yet; anything else is untouched.
// The model fake/check-bad-json answers its first check with words, not JSON (asked once more, it answers
// properly). Returns null for any other request.

const MARKER = '[AIWRITE-CHECK v1]'
const SCENE_MARKER = '[AIWRITE-CHECK v2] scene'
const TASK_MARKER = '[AIWRITE-CHECK-TASK v1]'
const TASK_HEADING = '\n## Your task\n'
let badJsonSeen = 0

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const sentencesOf = (text) =>
  text
    .split(/\n+/)
    .flatMap((l) => l.match(/[^.!?]+[.!?]+["'’”]?|[^.!?]+$/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean)

/** The entries in the request: id, name, fields by label (lower case), and what has happened to them. */
function entriesIn(user) {
  const out = []
  let cur = null
  let inHappened = false
  for (const line of user.split('\n')) {
    const head = line.match(/^### (E\d+) (.+?) \(([^;)]+)/)
    if (head) {
      cur = { id: head[1], name: head[2].trim(), kind: head[3].trim(), fields: {}, happened: [], text: '' }
      out.push(cur)
      inHappened = false
      continue
    }
    if (/^## /.test(line)) {
      cur = null
      continue
    }
    if (!cur) continue
    cur.text += `${line}\n`
    if (/^What has happened so far:/.test(line)) {
      inHappened = true
      continue
    }
    const item = line.match(/^- (.+)$/)
    if (item && inHappened) {
      cur.happened.push(item[1])
      continue
    }
    const field = line.match(/^- ([^:]+): (.+)$/)
    if (field) cur.fields[field[1].trim().toLowerCase()] = field[2].trim()
  }
  return out
}

/** The request without its task: the material and the scene. */
const openingOf = (user) => (user.includes(TASK_HEADING) ? user.slice(0, user.indexOf(TASK_HEADING)) : user)

/** The scene's text: everything after its heading, up to the task. */
const sceneIn = (user) => openingOf(user).match(/(?:^|\n)## The scene[^\n]*\n([\s\S]*)$/)?.[1] ?? ''

/** The checks a request makes, from its task's "[AIWRITE-CHECK-TASK v1] facts, timeline" line; null when it makes none. */
function checksAsked(user) {
  const line = user.split('\n').find((l) => l.startsWith(TASK_MARKER))
  return line
    ? line
        .slice(TASK_MARKER.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null
}

const dead = (e) => [...e.happened, e.text].some((t) => /\b(died|dead|killed)\b/i.test(t))

/** The contract's items in the request: id, which list, and words. */
function contractIn(user) {
  const at = user.indexOf('## The scene’s contract (C ids)')
  if (at < 0) return []
  const body = user.slice(user.indexOf('\n', at) + 1).split('\n## ')[0]
  const out = []
  let part = ''
  for (const line of body.split('\n')) {
    if (/^Must change/.test(line)) part = 'change'
    else if (/^Must not change/.test(line)) part = 'keep'
    else if (/^Must be true/.test(line)) part = 'start'
    const m = line.match(/^- \[(C\d+)\] (.+)$/)
    if (m) out.push({ item: m[1], part, text: m[2] })
  }
  return out
}

/** Each item of the contract answered against the scene (see the top of this file). */
function contractAnswers(user) {
  // The scene's own text: the last part of the opening, under "## The scene" (or "## The scene (part 1 of 2)").
  const scene = openingOf(user).match(/\n## The scene(?: \(part \d+ of \d+\))?\n([\s\S]*)$/)?.[1] ?? ''
  const sentences = sentencesOf(scene)
  const words = new Set((scene.toLowerCase().match(/[a-z’']{4,}/g) ?? []))
  return contractIn(user).map((c) => {
    const dead = c.text.match(/^([A-Z][a-z]+) is dead/)
    if (dead) {
      const says = new RegExp(`(?:said|asked|replied|whispered|shouted) ${dead[1]}\\b|\\b${dead[1]} (?:said|asked|replied|whispered|shouted)\\b`)
      const s = sentences.find((x) => says.test(x))
      return s ? { item: c.item, result: 'broken', quote: s, why: `${dead[1]} is dead, but speaks here.`, fix: '' } : { item: c.item, result: 'untouched', quote: '' }
    }
    if (c.part === 'change') {
      const need = (c.text.toLowerCase().match(/[a-z’']{4,}/g) ?? []).filter((w) => !['must', 'with', 'from', 'that'].includes(w))
      const shown = need.every((w) => words.has(w) || words.has(w.replace(/s$/, '')) || [...words].some((x) => x.startsWith(w.slice(0, 4))))
      return shown ? { item: c.item, result: 'kept', quote: sentences[0] ?? '' } : { item: c.item, result: 'not yet', quote: '' }
    }
    return { item: c.item, result: 'untouched', quote: '' }
  })
}

function checkIssues(checks, user) {
  if (!checks.includes('facts')) return []
  const scene = sceneIn(user)
  const sentences = sentencesOf(scene)
  const issues = []
  for (const e of entriesIn(user)) {
    const name = escape(e.name.split(' ')[0])
    const eyes = (e.fields.eyes ?? '').toLowerCase().match(/[a-z]+/)?.[0]
    if (eyes) {
      for (const s of sentences) {
        const m =
          s.match(new RegExp(`\\b${name}['’]s eyes (?:are|were|flashed|shone|gleamed) ([a-z]+)`)) ?? s.match(new RegExp(`\\b${name}['’]s ([a-z]+) eyes`))
        if (!m || m[1].toLowerCase() === eyes) continue
        issues.push({
          check: 'facts',
          severity: 'warning',
          quote: s,
          message: `${e.name}'s eyes are ${eyes} in the memory, but ${m[1]} here.`,
          conflicts: { entry: e.id, field: 'eyes' },
          memory: eyes,
          text: m[1],
          fix: s.replace(m[1], eyes)
        })
      }
    }
    // Broken items of the contract aren't listed again as issues.
    if (dead(e) && !contractIn(user).some((c) => c.text.startsWith(`${e.name.split(' ')[0]} is dead`))) {
      const says = new RegExp(`(?:said|says|asked|replied|whispered|shouted) ${name}\\b|\\b${name} (?:said|says|asked|replied|whispered|shouted)\\b`)
      const s = sentences.find((x) => says.test(x))
      if (s) {
        issues.push({
          check: 'facts',
          severity: 'must-fix',
          quote: s,
          message: `${e.name} is dead by this point in the story, but speaks here.`,
          advice: 'Give the line to someone alive, or cut it.',
          conflicts: { entry: e.id }
        })
      }
    }
  }
  return issues
}

/** The reply for a consistency check request, or null when it isn't one. */
export function checkReply(system, messages, model = '') {
  if (!system.startsWith(MARKER) && !system.startsWith(SCENE_MARKER)) return null
  const users = (messages ?? []).filter((m) => m.role === 'user').map((m) => String(m.content ?? ''))
  // A request about a scene with another task (a second opinion on what the checks found) isn't the checks'.
  const checks = system.startsWith(SCENE_MARKER) ? checksAsked(users[0] ?? '') : []
  if (!checks) return null
  if (model === 'fake/check-bad-json' && users.length === 1 && badJsonSeen++ === 0) return 'I found a couple of things worth a look in this scene.'
  if (/^\[AIWRITE-CHECK v1\] story/.test(system)) return JSON.stringify({ issues: [] })
  const issues = checkIssues(checks, users[0] ?? '')
  // What each check looked at (the critic's report): "Looked at <check>." with ok unless it raised something.
  const checked = checks.map((check) => ({ check, ok: !issues.some((i) => i.check === check), note: `Looked at ${check}.` }))
  const contract = contractIn(users[0] ?? '').length ? contractAnswers(users[0] ?? '') : undefined
  return JSON.stringify({ issues, checked, ...(contract ? { contract } : {}) }, null, 1)
}
