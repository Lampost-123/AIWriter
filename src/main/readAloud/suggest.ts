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
export function paragraphsOfDoc(doc: unknown): { pid: string; text: string; italics?: [number, number][] }[] {
  const out: { pid: string; text: string; italics?: [number, number][] }[] = []
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; attrs?: { pid?: unknown }; content?: unknown[]; text?: string }
    if (n.type === 'paragraph') {
      let text = ''
      // The stretches in italics, as the page gives them to reading aloud (italic speech, italicSpeech.ts).
      const italics: [number, number][] = []
      for (const child of n.content ?? []) {
        const c = child as { type?: string; text?: string; marks?: { type?: string }[] }
        if (c.type === 'text') {
          const at = text.length
          text += c.text ?? ''
          if (c.marks?.some((m) => m.type === 'italic')) {
            const last = italics[italics.length - 1]
            if (last && last[1] === at) last[1] = text.length
            else italics.push([at, text.length])
          }
        } else if (c.type === 'hardBreak') text += '\n'
      }
      if (text.trim()) out.push({ pid: typeof n.attrs?.pid === 'string' ? n.attrs.pid : '', text, ...(italics.length ? { italics } : {}) })
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

/**
 * Asks for a voice description from what the world knows about a character. With `say`, it also asks how the name
 * is said, as a last "SAY IT AS:" line, only when a narrator would likely misread it (readVoiceReply reads both).
 */
/** What a page that isn't a character is, for the voice prompt. */
const KIND_NOUN: Partial<Record<Entry['kind'], string>> = { item: 'an item', place: 'a place', group: 'a group' }

export function voicePrompt(entry: Entry, lines: string[], current: string, opts: { say?: boolean } = {}): ChatMessage[] {
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
        'You write voice descriptions for a text-to-speech voice designer. From what is known about a character (or a thing in the story that talks), describe how their voice sounds: ' +
        'apparent age and gender, pitch and register, texture (breathy, gravelly, clear, nasal), accent, pace, and the mood it usually carries. ' +
        'One or two sentences, at most 40 words, in plain English, like "A woman in her sixties with a low, smoky voice, a soft Scottish accent and a slow, amused delivery." ' +
        'Describe the sound only, not the plot or what they say. ' +
        (opts.say ? SAY_RULE : 'Output only the description.')
    },
    {
      role: 'user',
      content: [
        `${entry.kind === 'character' ? 'CHARACTER' : `SPEAKER (${KIND_NOUN[entry.kind] ?? 'a thing'} in the story that talks)`}: ${entry.name}${entry.aliases.length ? ` (also called ${entry.aliases.join(', ')})` : ''}`,
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

/** How the name is said, asked for with the voice when the AI fills in a character by itself (autoVoice.ts). */
const SAY_RULE =
  'Then, only if a narrator reading the name aloud would likely say it wrong, add one last line on its own: SAY IT AS: and a respelling ' +
  'with the stressed part in capitals, like "SAY IT AS: shiv-AWN" for Siobhan. For a name of more than one word, give pairs for just the ' +
  'words that need one, like "SAY IT AS: Siobhan = shiv-AWN; Nguyen = win". Most names need none (Tom, Elena, Marcus, Brann, Mara): ' +
  'then leave that line out. Output only the description, and that line when it is needed.'

/** The "SAY IT AS:" line in a reply, however the AI dressed it (bold, a bullet, a dash for the colon). */
const SAY_LINE = /^[ \t*_>#-]*say it as[ \t*_]*[:\uFF1A\u2013\u2014-][ \t*_]*(.*)$/im

/** A name as letters and digits only, to compare spellings ("Mara-Lee" and "maralee" are the same). */
const bare = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/**
 * "Say it as" as the AI wrote it, or '' when it gave none worth keeping: "none", the name as it is spelled, pairs
 * for words that aren't in the name, or one respelling that doesn't match a name of several words.
 */
export function cleanSay(raw: string, entry: Pick<Entry, 'name' | 'aliases'>): string {
  const say = raw
    .trim()
    .replace(/^[\s*_"“'‘`]+|[\s*_"”'’`.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!say || say.length > 120 || !/\p{L}/u.test(say)) return ''
  if (/^(?:none|n\/?a|nothing|no|not needed|no need|-)$/i.test(say)) return ''
  const names = [entry.name, ...entry.aliases].map((n) => n.trim()).filter(Boolean)
  if (names.some((n) => bare(n) === bare(say))) return ''
  if (say.includes('=')) {
    const words = new Set(
      names
        .flatMap((n) => [n, ...n.split(/\s+/)])
        .map(bare)
        .filter(Boolean)
    )
    return say
      .split(/;+/)
      .flatMap((pair) => {
        const [word, as] = pair.split('=').map((x) => x.trim())
        return word && as && words.has(bare(word)) && bare(word) !== bare(as) ? [`${word} = ${as}`] : []
      })
      .join('; ')
      .slice(0, 200)
  }
  // One respelling stands for the whole name, so for a name of several words it must say every one of them.
  const parts = (s: string): number => s.split(/\s+/).filter(Boolean).length
  const words = parts(entry.name.trim())
  return words <= 1 || parts(say) === words ? say.slice(0, 200) : ''
}

/** A reply to voicePrompt with `say`: the description, and how the name is said ('' when the AI gave none). */
export function readVoiceReply(raw: string, entry: Pick<Entry, 'name' | 'aliases'>): { design: string; say: string } {
  const m = SAY_LINE.exec(raw)
  if (!m) return { design: cleanDesign(raw), say: '' }
  const rest = raw.slice(0, m.index) + raw.slice(m.index + m[0].length)
  return { design: cleanDesign(rest), say: cleanSay(m[1] ?? '', entry) }
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
