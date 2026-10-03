// Builds the thesaurus shipped with AI Write (resources/thesaurus/) from the OpenOffice/LibreOffice
// MyThes English thesaurus, which is made from WordNet (Princeton University; the WordNet licence is
// resources/thesaurus/WordNet-LICENSE.txt and must stay beside the file).
//
//   node build/thesaurus.mjs path/to/th_en_US_v2.dat [path/to/WordNet_license.txt]
//
// The source lists each word ("word|n") and then its n senses ("(pos)|syn|syn (similar term)|..."). Kept:
// single-word headwords; for each, a few senses with a handful of synonyms each (one or two words, no proper
// nouns), plain synonyms before "similar terms"; antonyms, generic and related terms are left out, and so is a
// headword's own spelling in the other English (colour under color). The US and UK spellings the source
// pairs up (color/colour, center/centre, realize/realise, traveled/travelled...) are listed too, so the app can
// show synonyms in the writer's spelling.
//
// Output (gzipped UTF-8 text, resources/thesaurus/en-thesaurus.txt.gz):
//   AIWRITE-THESAURUS 1
//   #variants
//   us<TAB>uk[<TAB>other...]        one word spelt two (or more) ways per line: US, UK, then any others
//   #words
//   word<TAB>pos|syn|syn<TAB>pos|syn...   pos: n, v, adj, adv
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const SENSES = 4
const PER_SENSE = 6

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '..', 'resources', 'thesaurus')
const [source, licence] = process.argv.slice(2)
if (!source) {
  console.error('Usage: node build/thesaurus.mjs th_en_US_v2.dat [WordNet_license.txt]')
  process.exit(1)
}

const POS = { noun: 'n', verb: 'v', adj: 'adj', adv: 'adv' }
const WORD = /^[a-z][a-z'-]*[a-z]$|^[a-z]$/
const SYNONYM = /^[a-z][a-z'-]*( [a-z][a-z'-]*)?$/

// ---------- UK and US spellings ----------

/** Pairs that look like a spelling variant but are different words (or only sometimes are). */
const NOT_VARIANTS = new Set(['meter', 'meters', 'prize', 'prized', 'prizes', 'prizing', 'license', 'licensed', 'licenses', 'licensing', 'tire', 'tired', 'tires', 'curb', 'program', 'programs', 'check', 'draft', 'story', 'annex', 'disk', 'inquire', 'inquiry'])
/** Spellings no pattern finds. */
const EXTRA = [
  ['gray', 'grey'], ['grayish', 'greyish'], ['plow', 'plough'], ['mold', 'mould'], ['moldy', 'mouldy'], ['molding', 'moulding'],
  ['cozy', 'cosy'], ['mustache', 'moustache'], ['jewelry', 'jewellery'], ['aluminum', 'aluminium'], ['skeptic', 'sceptic'],
  ['skeptical', 'sceptical'], ['skepticism', 'scepticism'], ['ax', 'axe'], ['artifact', 'artefact'], ['pajamas', 'pyjamas'],
  ['maneuver', 'manoeuvre'], ['smolder', 'smoulder'], ['whiskey', 'whisky'], ['mom', 'mum'], ['sulfur', 'sulphur'],
  ['airplane', 'aeroplane'], ['somber', 'sombre'], ['fulfill', 'fulfil'], ['enroll', 'enrol'],
  ['willful', 'wilful'], ['skillful', 'skilful'], ['distill', 'distil'], ['instill', 'instil']
].filter(([a, b]) => a !== b)

/** Words spelt with s (or one l, or no u) in US English too: never paired with a z (or ll, or our) form. */
const ALWAYS = /advertis|advis|apprais|appris|aris|chastis|compris|compromis|despis|devis|disguis|enterpris|excis|exercis|franchis|improvis|incis|merchandis|revis|supervis|surmis|surpris|televis|partisan|cotillion|odor|glamor|humor|vapor|labori|clamor|rigor|valor|vigor/
/** The endings a US -or word takes where the UK one has -our (colorful, honorable, armored), and none (color). */
const OR_ENDS = /^(s|ed|ing|ings|ful|fully|fulness|less|lessness|able|ably|er|ers|ist|ists|ite|ites|y|some|someness|i[sz]e|i[sz]ed|i[sz]es|i[sz]ing|i[sz]ation|-.*)?$/

/** True when `uk` is the UK spelling of the US `us` by one of the usual patterns. */
function ukPattern(us, uk) {
  if (us === uk || NOT_VARIANTS.has(us) || ALWAYS.test(uk)) return false
  // color/colour, honorable/honourable, behavior/behaviour, armor-plated/armour-plated
  for (let i = us.indexOf('or'); i >= 0; i = us.indexOf('or', i + 1)) {
    if (us.slice(0, i) + 'our' + us.slice(i + 2) === uk && OR_ENDS.test(us.slice(i + 2))) return true
  }
  // center/centre, theater/theatre, centered/centred
  for (const [a, b] of [['er', 're'], ['ers', 'res'], ['ered', 'red'], ['ering', 'ring']]) {
    if (us.endsWith(a) && us.slice(0, -a.length) + b === uk) return true
  }
  // realize/realise, analyze/analyse, organization/organisation (one z for one s in -ize, -yze, -ization)
  if (us.length === uk.length) {
    let diff = -1
    for (let i = 0; i < us.length; i++) {
      if (us[i] === uk[i]) continue
      if (diff !== -1) {
        diff = -2
        break
      }
      diff = i
    }
    if (diff > 0 && us[diff] === 'z' && uk[diff] === 's' && /[iy]/.test(us[diff - 1]) && /[aei]/.test(us[diff + 1] ?? '')) return true
  }
  // catalog/catalogue, dialog/dialogue
  if (us.endsWith('og') && us + 'ue' === uk) return true
  // defense/defence, offense/offence, pretense/pretence
  if (us.endsWith('ense') && us.slice(0, -4) + 'ence' === uk) return true
  // traveled/travelled, traveler/traveller, labeling/labelling, medalist/medallist (an l before an ending)
  const l = /^(.*[^l])l(ed|er|ers|ing|ings|ist|ists)$/.exec(us)
  if (l && `${l[1]}ll${l[2]}` === uk) return true
  // anemia/anaemia, pediatrician/paediatrician, fetus/foetus (medical and scientific words)
  if (!/aesthet/.test(uk)) {
    for (let i = us.indexOf('e'); i >= 0; i = us.indexOf('e', i + 1)) {
      if (us.slice(0, i) + 'ae' + us.slice(i + 1) === uk || us.slice(0, i) + 'oe' + us.slice(i + 1) === uk) return true
    }
  }
  return false
}

// ---------- Reading the source ----------

const lines = readFileSync(source, 'utf8').split(/\r?\n/)
/** headword -> senses [{ pos, words: [{ word, kind }] }] */
const entries = new Map()
for (let i = 1; i < lines.length; ) {
  const head = lines[i++]
  const bar = head.lastIndexOf('|')
  if (bar < 0) continue
  const word = head.slice(0, bar)
  const n = Number(head.slice(bar + 1)) || 0
  const senses = []
  for (let k = 0; k < n && i < lines.length; k++) {
    const [posRaw, ...rest] = lines[i++].split('|')
    const pos = POS[posRaw.replace(/[()]/g, '')] ?? null
    const words = rest.map((r) => {
      const m = /^(.*?) \((similar term|antonym|generic term|related term)\)$/.exec(r)
      return m ? { word: m[1], kind: m[2] } : { word: r, kind: 'plain' }
    })
    senses.push({ pos, words })
  }
  if (WORD.test(word)) entries.set(word, senses)
}

// The spelling pairs: words the source lists together (or a headword and its synonym) that match a pattern.
const pairs = [...EXTRA]
for (const [word, senses] of entries) {
  for (const s of senses) {
    const group = [word, ...s.words.filter((w) => w.kind === 'plain').map((w) => w.word)].filter((w) => WORD.test(w))
    for (const a of group) for (const b of group) if (ukPattern(a, b)) pairs.push([a, b])
  }
}

// Spellings of one word, together (colorize, colorise, colourize, colourise): the most American of them is the
// US spelling and the most British the UK one.
const parent = new Map()
const find = (w) => {
  while (parent.has(w) && parent.get(w) !== w) w = parent.get(w)
  return w
}
for (const [a, b] of pairs) {
  for (const w of [a, b]) if (!parent.has(w)) parent.set(w, w)
  const ra = find(a)
  const rb = find(b)
  if (ra !== rb) parent.set(rb, ra)
}
const groups = new Map()
for (const w of parent.keys()) groups.set(find(w), [...(groups.get(find(w)) ?? []), w])
const ukScore = (w) =>
  (w.match(/our/g) ?? []).length + (w.match(/is(e|a|i)/g) ?? []).length + (w.match(/ys(e|i)/g) ?? []).length + (/(re|res|red|ring)$/.test(w) ? 1 : 0) +
  (w.match(/ll(e|i)/g) ?? []).length + (w.match(/ae|oe/g) ?? []).length + (/ogue$|ence$/.test(w) ? 1 : 0) + (EXTRA.some(([, uk]) => uk === w) ? 2 : 0)
/** Each group: [US, UK, the others]. */
const variantGroups = [...groups.values()].map((g) => {
  const sorted = [...g].sort((a, b) => ukScore(a) - ukScore(b) || a.localeCompare(b))
  const us = sorted[0]
  const uk = sorted[sorted.length - 1]
  return [us, uk, ...sorted.slice(1, -1)]
})
const usOf = new Map()
for (const [us, ...rest] of variantGroups) for (const w of rest) usOf.set(w, us)
/** One spelling for both (word by word), so a word and its other spelling count as the same word. */
const same = (w) => w.split(/([ -])/).map((x) => usOf.get(x) ?? x).join('')

/** True when two words are one letter apart (sizable, sizeable; partisan, partizan): another spelling, not another word. */
function oneApart(a, b) {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

/**
 * The senses to keep: the first of each part of speech, then the second of each, and so on (so "run" shows
 * its verbs as well as its nouns).
 */
function pickSenses(senses) {
  const byPos = new Map()
  for (const s of senses) if (s.pos) byPos.set(s.pos, [...(byPos.get(s.pos) ?? []), s])
  const picked = []
  for (let round = 0; picked.length < senses.length; round++) {
    const more = [...byPos.values()].map((l) => l[round]).filter(Boolean)
    if (!more.length) break
    picked.push(...more)
  }
  return picked
}

// ---------- Writing the compact file ----------

const out = ['AIWRITE-THESAURUS 1', '#variants', ...variantGroups.sort(([a], [b]) => a.localeCompare(b)).map((g) => g.join('\t')), '#words']
let kept = 0
for (const [word, senses] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
  const parts = []
  const used = new Set([same(word)])
  for (const s of pickSenses(senses)) {
    if (parts.length >= SENSES) break
    const ranked = [...s.words.filter((w) => w.kind === 'plain'), ...s.words.filter((w) => w.kind === 'similar term')]
    const words = []
    for (const { word: w } of ranked) {
      if (!SYNONYM.test(w) || used.has(same(w)) || oneApart(w, word) || words.some((x) => oneApart(x, w))) continue
      used.add(same(w))
      // As the source spells it: the app turns it into the writer's own spelling.
      words.push(w)
      if (words.length >= PER_SENSE) break
    }
    if (words.length) parts.push(`${s.pos}|${words.join('|')}`)
  }
  if (!parts.length) continue
  out.push(`${word}\t${parts.join('\t')}`)
  kept++
}

mkdirSync(outDir, { recursive: true })
const file = join(outDir, 'en-thesaurus.txt.gz')
writeFileSync(file, gzipSync(Buffer.from(out.join('\n') + '\n', 'utf8'), { level: 9 }))
if (licence) copyFileSync(licence, join(outDir, 'WordNet-LICENSE.txt'))
console.log(`${kept} words, ${variantGroups.length} words spelt two ways: ${file} (${(statSync(file).size / 1e6).toFixed(2)} MB)`)

