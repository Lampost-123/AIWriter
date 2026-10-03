// Whether the words of a scene contradict what the memory says about someone or something, or only
// say it differently. A scene that describes a field in other words ("a redder beard" for "red beard",
// "about twelve" for "12"), more fully or more vaguely, or adds a detail the memory doesn't have, is not a
// clash: only a value that can't be true alongside the memory's is (blue eyes against green). Pure, so
// it is unit-tested.

/**
 * Fields that hold one value at a time, so a different value can't also be true (eyes are blue or
 * green). The other fields describe (how a place smells, how someone speaks, what happened before):
 * there another description adds to the memory rather than contradicting it, and only the memory
 * model's own report of a contradiction raises an issue.
 */
export const ONE_VALUE_FIELDS = new Set(['pronouns', 'age', 'build', 'hair', 'eyes', 'skin', 'when'])

/** Words that say nothing about the value itself. */
const FILLER = new Set(
  (
    'a an the and or of with in on at to for from by as is was are were be been has had have his her hers their its ' +
    'he she they him them it this that these those about around roughly nearly almost some somewhat very quite rather ' +
    'just only still now then than like look looks looked looking kept keeps wore wears worn one'
  ).split(' ')
)

const NUMBERS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18',
  nineteen: '19', twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70', eighty: '80', ninety: '90'
}

const SPELLINGS: Record<string, string> = { colour: 'color', colourless: 'colorless', gray: 'grey', blond: 'blonde' }

/** One word as compared: "redder" and "red" are the same word here, as are "curls" and "curl". */
function stem(word: string): string {
  let w = SPELLINGS[word] ?? NUMBERS[word] ?? word
  if (/^\d+$/.test(w)) return w
  if (w.length > 5 && w.endsWith('est')) w = w.slice(0, -3)
  else if (w.length > 4 && w.endsWith('er')) w = w.slice(0, -2)
  else if (w.length > 4 && w.endsWith('ish')) w = w.slice(0, -3)
  if (w.length > 3 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`
  else if (w.length > 3 && w.endsWith('es') && /(s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2)
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
  // "redder" lost its "er" above; a doubled last letter ("redd") goes back to one.
  if (/([b-df-hj-np-tv-z])\1$/.test(w) && w.length > 3) w = w.slice(0, -1)
  return w
}

/** The words that carry the value, as compared. */
export function valueWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !FILLER.has(w))
  return new Set(words.map(stem))
}

const within = (a: Set<string>, b: Set<string>): boolean => [...a].every((w) => b.has(w))

/**
 * The scene says the same as the memory, in other words: one value's words all appear in the other's,
 * so the scene repeats it, says it more fully, or says less of it.
 */
export function saysTheSame(memory: string, text: string): boolean {
  const m = valueWords(memory)
  const t = valueWords(text)
  if (!m.size || !t.size) return true
  return within(m, t) || within(t, m)
}

/**
 * True when the scene's words contradict the memory's value for this field (null: not a field, such as
 * a whole entry). `reported`: the memory model itself reported it as a contradiction, rather than the
 * memory and the text simply being worded differently.
 */
export function contradicts(field: string | null, memory: string, text: string, reported = false): boolean {
  if (!text.trim()) return false
  if (!memory.trim()) return reported
  if (saysTheSame(memory, text)) return false
  return reported || (!!field && ONE_VALUE_FIELDS.has(field))
}
