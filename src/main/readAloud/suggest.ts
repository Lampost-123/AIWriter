// Adapted from mcreader-v2, src/server/speech/cast.ts (voiceDesignPrompt, cleanDesign and linesSpokenBy; reading
// aloud's own text-to-speech code; Adam's rule, 2 October 2026). MCreader read a character from its story summary
// and its marks table; AI Write reads the character's page and the scenes' words.
//
// Suggest (a character's Read-aloud voice): the AI describes how the character sounds from their age, looks,
// background and lines, for the voice to be made from. Nothing is kept until Adam picks "Use this". Hear plays one
// of their own lines from the story.
import type Database from 'better-sqlite3'
import type { ChatMessage, Entry, ID } from '@shared/types'
import * as repo from '../db/repo'
import { everyone, namesFor, speakerOf, type CastMember } from './cast'
import { MARKER, QUOTE, quoteKey } from './speakers'

type DB = Database.Database

/** A scene's paragraphs from its saved document: each with its id and words (a line break as "\n"). */
export function paragraphsOfDoc(doc: unknown): { pid: string; text: string }[] {
  const out: { pid: string; text: string }[] = []
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; attrs?: { pid?: unknown }; content?: unknown[]; text?: string }
    if (n.type === 'paragraph') {
      let text = ''
      for (const child of n.content ?? []) {
        const c = child as { type?: string; text?: string }
        if (c.type === 'text') text += c.text ?? ''
        else if (c.type === 'hardBreak') text += '\n'
      }
      if (text.trim()) out.push({ pid: typeof n.attrs?.pid === 'string' ? n.attrs.pid : '', text })
      return
    }
    for (const child of n.content ?? []) visit(child)
  }
  visit(doc)
  return out
}

/** A line worth hearing: long enough to show the voice, short enough to be one breath or two. */
const goodLine = (line: string): boolean => line.length >= 12 && line.length <= 240

/**
 * Some of the lines this character says in the stories, word for word: lines a dialogue tag gives them (or the
 * AI's marks, `marked`: scene id → paragraph id → quote keys), the open story's scenes first.
 */
export function linesSpokenBy(
  db: DB,
  entry: Pick<Entry, 'id' | 'name' | 'aliases'>,
  opts: { storyIds: ID[]; marked?: (sceneId: ID) => Map<string, Set<string>>; max?: number }
): string[] {
  const max = opts.max ?? 6
  const me: CastMember = { id: entry.id, name: entry.name, names: namesFor(entry) }
  if (!me.names.length) return []
  const cast = everyone([me])
  const out: string[] = []
  for (const storyId of opts.storyIds) {
    let scenes: { id: ID }[]
    try {
      scenes = repo.getOutline(db, storyId).scenes
    } catch {
      continue
    }
    for (const meta of scenes) {
      let doc: unknown
      try {
        doc = repo.getScene(db, meta.id).doc
      } catch {
        continue
      }
      const marked = opts.marked?.(meta.id)
      for (const p of paragraphsOfDoc(doc)) {
        for (const m of p.text.matchAll(new RegExp(QUOTE.source, 'g'))) {
          const quote = m[0]
          const theirs = marked?.get(p.pid)?.has(quoteKey(quote)) || speakerOf(p.text, m.index!, quote.length, cast)?.how === 'tagged'
          if (!theirs) continue
          const line = quote.replace(/^["“]|["”]$/g, '').trim()
          if (goodLine(line) && !out.includes(line)) out.push(line)
          if (out.length >= max) return out
        }
      }
    }
  }
  return out
}

const FIELDS: [string, string][] = [
  ['pronouns', 'PRONOUNS'],
  ['age', 'AGE'],
  ['role', 'ROLE IN THE STORY'],
  ['build', 'BUILD'],
  ['face', 'FACE'],
  ['movement', 'HOW THEY MOVE'],
  ['traits', 'PERSONALITY'],
  ['origin', 'WHERE THEY COME FROM'],
  ['pastEvents', 'THEIR PAST'],
  ['speech', 'HOW THEY SPEAK'],
  ['tics', 'VERBAL TICS']
]

/** Asks for a voice description from what the world knows about a character. */
export function voicePrompt(entry: Entry, lines: string[], current: string): ChatMessage[] {
  const field = (key: string): string => (entry.fields[key] ?? '').trim()
  const samples = field('sampleLines')
    .split('\n')
    .map((l) => l.trim().replace(/^["“]|["”]$/g, ''))
    .filter(Boolean)
  const heard = [...lines, ...samples.filter((s) => !lines.includes(s))].slice(0, 8)
  return [
    {
      role: 'system',
      content:
        `${MARKER} voice\n` +
        'You write voice descriptions for a text-to-speech voice designer. From what is known about a character, describe how their voice sounds: ' +
        'apparent age and gender, pitch and register, texture (breathy, gravelly, clear, nasal), accent, pace, and the mood it usually carries. ' +
        'One or two sentences, at most 40 words, in plain English, like "A woman in her sixties with a low, smoky voice, a soft Scottish accent and a slow, amused delivery." ' +
        'Describe the sound only, not the plot or what they say. Output only the description.'
    },
    {
      role: 'user',
      content: [
        `CHARACTER: ${entry.name}${entry.aliases.length ? ` (also called ${entry.aliases.join(', ')})` : ''}`,
        entry.summary.trim() ? `IN ONE LINE: ${entry.summary.trim()}` : '',
        ...FIELDS.map(([key, label]) => (field(key) ? `${label}: ${field(key).slice(0, 600)}` : '')),
        entry.description.trim() ? `ABOUT THEM:\n${entry.description.trim().slice(0, 1500)}` : '',
        heard.length ? `SOME OF THEIR LINES:\n${heard.map((line) => `- “${line}”`).join('\n')}` : '',
        current.trim() ? `CURRENT DESCRIPTION (keep what fits):\n${current.trim()}` : ''
      ]
        .filter(Boolean)
        .join('\n\n')
    }
  ]
}

/** The description as the AI wrote it, without quotes, labels or code fences around it. */
export const cleanDesign = (raw: string): string =>
  raw
    .trim()
    .replace(/^```\w*\s*|```$/g, '')
    .trim()
    .replace(/^(?:voice|description)\s*[:—-]\s*/i, '')
    .replace(/^["“]([\s\S]*)["”]$/, '$1')
    .trim()
    .slice(0, 600)
