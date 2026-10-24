// Under suggestion (src/main/commands/read.ts): the fake memory model's reading of a scene for hypnotic suggestions and
// commands. Made-up rules over made-up scenes, so app tests can see commands found, stacked and set off:
//   - “<words>,” <Giver> told <Subject>.   (or "whispered to")  gives a command; its words say what it does:
//     socks / bra / shoes are pieces it keeps off, "naked" or "nothing on" keeps every piece off, "When you hear the word
//     <x>, ..." plants a trigger (every time when the words say "every time").
//   - a scene saying a waiting command's trigger word sets it off, quoting the sentence it is in.
export const COMMANDS_MARKER = 'report hypnotic suggestions and commands'

const sentences = (text) => text.match(/[^.!?”]+(?:[.!?]+”?|”)/g)?.map((s) => s.trim()) ?? []

export function commandsReply(user) {
  const people = new Map()
  for (const m of user.matchAll(/^(E\d+) ([^\n(]+?)(?: \(also [^)]*\))?$/gm)) {
    people.set(m[2].trim(), m[1])
    people.set(m[2].trim().split(/\s+/)[0], m[1])
  }
  const commands = [...user.matchAll(/^(C\d+) .*?trigger: [^·]*?['‘"“]([^'’"”]+)['’"”][^·]*·.*waiting for its trigger$/gm)].map((m) => ({ c: m[1], word: m[2] }))
  const text = user.slice(user.indexOf('The scene:') + 'The scene:'.length).trim()
  const steps = []
  const given = /“([^”]+?)[,.!]?” (\w+) (?:told|whispered to) (\w+)/g
  for (const m of text.matchAll(given)) {
    const words = m[1].trim()
    const by = people.get(m[2])
    const who = people.get(m[3])
    if (!who) continue
    const lower = words.toLowerCase()
    const off = ['socks', 'bra', 'shoes', 'knickers'].filter((p) => lower.includes(p))
    const all = /\bnaked\b|nothing on/.test(lower)
    const trig = /^when you hear the word ([\w’']+),?\s*(.*)$/i.exec(words)
    steps.push({
      step: 'given',
      who,
      by: by ?? null,
      words,
      does: trig ? trig[2].replace(/^you will\s*/i, '') : words.replace(/^you (?:will|won['’]t)\s*/i, (x) => (/won/.test(x) ? 'will not ' : '')),
      kind: off.length || all ? 'clothing' : 'other',
      off,
      all,
      trigger: trig ? `she hears the word '${trig[1].replace(/[’']/g, '')}'` : '',
      trigger_by: 'anyone',
      every: /every time/.test(lower),
      lasts: 'story',
      feels: '',
      quote: words,
      sure: true
    })
  }
  for (const { c, word } of commands) {
    const at = sentences(text).find((s) => s.toLowerCase().includes(word.toLowerCase()) && !/when you hear/i.test(s))
    if (at) steps.push({ step: 'fired', c, quote: at, sure: true })
  }
  return JSON.stringify({ steps })
}
