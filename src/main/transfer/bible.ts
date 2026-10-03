// The series bible: the codex (every entry by kind, with its fields as they stand at a story's end, its
// relationships, what has happened to it and what a character knows), the timeline and the plot threads,
// as one readable document in Markdown or as a page to print to PDF. It is read with the same builders as
// the entry pages and the world views (memory/asOf.ts, worldViews/index.ts), never worked out again here,
// and shows no ids. No Electron imports.

import type Database from 'better-sqlite3'
import type { EntryKind, EntryState, ID } from '@shared/types'
import { ENTRY_KINDS, FIELD_GROUPS, KIND_LABELS } from '@shared/fields'
import { memoryAt } from '../memory/asOf'
import { threadsBoardOf, timelineOf } from '../worldViews'
import * as repo from '../db/repo'
import { esc } from './html'

type DB = Database.Database

export interface BibleEntry {
  name: string
  aliases: string[]
  summary: string
  description: string
  /** Lore that is a rule never to break. */
  hardRule: boolean
  /** The place it is inside, by name; '' for none. */
  inside: string
  /** The kind's fields that have words, in the order the entry page shows them. */
  fields: { label: string; value: string }[]
  tags: string[]
  /** "Sister: Tobin (protective of him)". */
  relationships: string[]
  /** "Lost her left hand (Book 1, Ch 3, Sc 2)". */
  happened: string[]
  /** Facts a character knows. */
  knows: string[]
  notes: string
}

export interface BibleThread {
  name: string
  /** "Open", "Resolved" or "Planned". */
  status: string
  promise: string
  setUp: string
  paidOff: string
  fields: { label: string; value: string }[]
}

export interface Bible {
  worldName: string
  storyTitle: string
  /** "As of the end of Book 1." */
  asOf: string
  sections: { title: string; entries: BibleEntry[] }[]
  timeline: { when: string; title: string; where: string }[]
  threads: BibleThread[]
}

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

const STATUS: Record<string, string> = { open: 'Open', resolved: 'Resolved', planned: 'Planned' }

function fieldsOf(kind: EntryKind, fields: Record<string, string>): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = []
  for (const g of FIELD_GROUPS[kind] ?? []) {
    for (const f of g.fields) {
      const value = (fields[f.key] ?? '').trim()
      if (value) out.push({ label: f.label, value })
    }
  }
  return out
}

/** The series bible as of a story's end. */
export function readBible(db: DB, storyId: ID): Bible {
  const story = repo.getStory(db, storyId)
  const { state } = memoryAt(db, { kind: 'end', storyId })
  // Every live entry: those in the story by its end, and the rest as they first are.
  const all: EntryState[] = [...state.entries.values(), ...state.absent.values()]
  const names = new Map(all.map((e) => [e.id, e.name]))

  const entryOf = (e: EntryState): BibleEntry => ({
    name: e.name,
    aliases: e.aliases.filter((a) => a.trim()),
    summary: e.summary.trim(),
    description: e.description.trim(),
    hardRule: e.hardRule,
    inside: e.parentId ? (names.get(e.parentId) ?? '') : '',
    fields: fieldsOf(e.kind, e.fields),
    tags: e.tags.filter((t) => t.trim()),
    relationships: state.relationships
      .filter((r) => (r.aId === e.id || r.bId === e.id) && names.has(r.aId === e.id ? r.bId : r.aId))
      .map((r) => {
        const other = names.get(r.aId === e.id ? r.bId : r.aId)!
        const feels = (r.aId === e.id ? r.aFeels : r.bFeels).trim()
        const type = r.type.trim() || 'Knows'
        return `${type[0].toUpperCase()}${type.slice(1)}: ${other}${feels ? ` (${feels})` : ''}`
      })
      .sort((a, b) => a.localeCompare(b)),
    happened: e.happened.map((h) => (h.where ? `${h.note} (${h.where})` : h.note)).filter((h) => h.trim()),
    knows: e.kind === 'character' ? state.facts.filter((f) => f.knownBy.includes(e.id)).map((f) => f.fact) : [],
    notes: e.notes.trim()
  })

  const sections = ENTRY_KINDS.filter((k) => k !== 'thread')
    .map((kind) => ({
      title: KIND_LABELS[kind].many,
      entries: all
        .filter((e) => e.kind === kind)
        .map(entryOf)
        .sort(byName)
    }))
    .filter((s) => s.entries.length)

  const timeline = timelineOf(db, storyId).points.map((p) => ({ when: p.when.trim(), title: p.title.trim(), where: p.place }))

  const threadEntries = new Map(all.filter((e) => e.kind === 'thread').map((e) => [e.id, e]))
  const threads = threadsBoardOf(db, storyId).threads.map((t) => {
    const e = threadEntries.get(t.id)
    return {
      name: t.name,
      status: STATUS[t.column] ?? t.column,
      promise: t.promise.trim(),
      setUp: t.setUp?.label || (t.setUp ? 'Before the story begins' : ''),
      paidOff: t.paidOff?.label ?? '',
      fields: e ? fieldsOf('thread', e.fields).filter((f) => f.value !== t.promise.trim()) : []
    }
  })

  const storyTitle = story.title.trim() || 'Untitled story'
  return {
    worldName: repo.getMeta(db, 'name') ?? 'Untitled world',
    storyTitle,
    asOf: `As of the end of ${storyTitle}.`,
    sections,
    timeline,
    threads
  }
}

// ---------- Markdown ----------

const md = (s: string): string => s.replace(/([\\`*_[\]<>])/g, '\\$1')
const mdPara = (s: string): string =>
  s
    .split(/\n\s*\n/)
    .map((p) => md(p.trim()).replace(/\n/g, '  \n'))
    .filter(Boolean)
    .join('\n\n')

function entryMarkdown(e: BibleEntry): string {
  const out: string[] = [`### ${md(e.name)}`]
  const tags: string[] = []
  if (e.hardRule) tags.push('**A rule never to break.**')
  if (e.aliases.length) tags.push(`*Also called ${md(e.aliases.join(', '))}.*`)
  if (e.inside) tags.push(`*Inside ${md(e.inside)}.*`)
  if (tags.length) out.push(tags.join(' '))
  if (e.summary) out.push(mdPara(e.summary))
  if (e.description) out.push(mdPara(e.description))
  if (e.fields.length) out.push(e.fields.map((f) => `- **${md(f.label)}:** ${md(f.value).replace(/\n+/g, ' ')}`).join('\n'))
  const list = (title: string, items: string[]): void => {
    if (items.length) out.push(`**${title}**\n\n${items.map((i) => `- ${md(i).replace(/\n+/g, ' ')}`).join('\n')}`)
  }
  list('Relationships', e.relationships)
  list('What has happened', e.happened)
  list('Knows', e.knows)
  if (e.tags.length) out.push(`*Tags: ${md(e.tags.join(', '))}*`)
  if (e.notes) out.push(`**Notes**\n\n${mdPara(e.notes)}`)
  return out.join('\n\n')
}

export function bibleMarkdown(b: Bible): string {
  const out: string[] = [`# ${md(b.worldName)}: series bible`, `*${md(b.asOf)}*`]
  for (const s of b.sections) {
    out.push(`## ${md(s.title)}`)
    out.push(...s.entries.map(entryMarkdown))
  }
  if (b.timeline.length) {
    out.push('## Timeline')
    out.push(b.timeline.map((t) => `- **${md(t.when || 'No date')}**: ${md(t.title)}${t.where ? ` (${md(t.where)})` : ''}`).join('\n'))
  }
  if (b.threads.length) {
    out.push('## Plot threads')
    for (const t of b.threads) {
      const lines = [`### ${md(t.name)}`, `*${t.status}.*`]
      if (t.promise) lines.push(mdPara(t.promise))
      const facts = [
        ...(t.setUp ? [`- **Set up:** ${md(t.setUp)}`] : []),
        ...(t.paidOff ? [`- **Paid off:** ${md(t.paidOff)}`] : []),
        ...t.fields.map((f) => `- **${md(f.label)}:** ${md(f.value).replace(/\n+/g, ' ')}`)
      ]
      if (facts.length) lines.push(facts.join('\n'))
      out.push(lines.join('\n\n'))
    }
  }
  return `${out.join('\n\n')}\n`
}

// ---------- A page to print ----------

const htmlPara = (s: string): string =>
  s
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br/>')}</p>`)
    .join('')

const htmlList = (title: string, items: string[]): string =>
  items.length ? `<h4>${esc(title)}</h4><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''

const htmlFields = (fields: { label: string; value: string }[]): string =>
  fields.length ? `<dl>${fields.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value).replace(/\n/g, '<br/>')}</dd>`).join('')}</dl>` : ''

function entryHtml(e: BibleEntry): string {
  const notes: string[] = []
  if (e.hardRule) notes.push('<strong>A rule never to break.</strong>')
  if (e.aliases.length) notes.push(`Also called ${esc(e.aliases.join(', '))}.`)
  if (e.inside) notes.push(`Inside ${esc(e.inside)}.`)
  return `<article class="entry">
<h3>${esc(e.name)}</h3>
${notes.length ? `<p class="aside">${notes.join(' ')}</p>` : ''}
${e.summary ? `<div class="summary">${htmlPara(e.summary)}</div>` : ''}
${e.description ? htmlPara(e.description) : ''}
${htmlFields(e.fields)}
${htmlList('Relationships', e.relationships)}
${htmlList('What has happened', e.happened)}
${htmlList('Knows', e.knows)}
${e.tags.length ? `<p class="aside">Tags: ${esc(e.tags.join(', '))}</p>` : ''}
${e.notes ? `<h4>Notes</h4>${htmlPara(e.notes)}` : ''}
</article>`
}

export function bibleHtml(b: Bible, fonts = ''): string {
  const sections = b.sections.map((s) => `<section><h2>${esc(s.title)}</h2>\n${s.entries.map(entryHtml).join('\n')}</section>`)
  if (b.timeline.length) {
    sections.push(`<section><h2>Timeline</h2><table class="timeline"><tbody>${b.timeline
      .map((t) => `<tr><th>${esc(t.when || 'No date')}</th><td>${esc(t.title)}${t.where ? `<span class="where">${esc(t.where)}</span>` : ''}</td></tr>`)
      .join('')}</tbody></table></section>`)
  }
  if (b.threads.length) {
    sections.push(`<section><h2>Plot threads</h2>${b.threads
      .map(
        (t) => `<article class="entry"><h3>${esc(t.name)} <span class="status">${esc(t.status)}</span></h3>
${t.promise ? htmlPara(t.promise) : ''}
${htmlFields([...(t.setUp ? [{ label: 'Set up', value: t.setUp }] : []), ...(t.paidOff ? [{ label: 'Paid off', value: t.paidOff }] : []), ...t.fields])}
</article>`
      )
      .join('\n')}</section>`)
  }
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>${esc(b.worldName)}: series bible</title>
<style>
${fonts}
@page { size: A4; margin: 22mm 20mm 24mm; }
body { font-family: Literata, Georgia, "Times New Roman", serif; font-size: 10.5pt; line-height: 1.5; color: #1a1a1a; margin: 0; }
h1 { font-weight: normal; font-size: 26pt; margin: 40mm 0 4mm; text-align: center; }
.as-of { text-align: center; color: #555; font-style: italic; margin: 0 0 20mm; }
h2 { font-weight: normal; font-size: 18pt; border-bottom: 0.5pt solid #999; padding-bottom: 2mm; margin: 0 0 6mm; break-before: page; }
h3 { font-size: 12.5pt; margin: 7mm 0 1.5mm; break-after: avoid; }
h4 { font-size: 10pt; margin: 3mm 0 1mm; text-transform: uppercase; letter-spacing: 0.06em; color: #444; break-after: avoid; }
p { margin: 0 0 2mm; }
.summary p { font-style: italic; }
.aside { color: #555; font-size: 9.5pt; }
.status { font-weight: normal; font-size: 9.5pt; color: #555; margin-left: 2mm; }
dl { margin: 2mm 0; display: grid; grid-template-columns: 38mm 1fr; gap: 1mm 4mm; }
dt { color: #555; font-size: 9.5pt; }
dd { margin: 0; }
ul { margin: 0 0 2mm; padding-left: 5mm; }
.entry { break-inside: avoid-page; }
table.timeline { border-collapse: collapse; width: 100%; }
table.timeline th { text-align: left; font-weight: normal; color: #555; width: 40mm; vertical-align: top; padding: 1.2mm 4mm 1.2mm 0; }
table.timeline td { padding: 1.2mm 0; border-bottom: 0.3pt solid #ddd; }
.where { display: block; color: #777; font-size: 9pt; }
</style></head>
<body>
<h1>${esc(b.worldName)}</h1>
<p class="as-of">Series bible. ${esc(b.asOf)}</p>
${sections.join('\n')}
</body></html>`
}
