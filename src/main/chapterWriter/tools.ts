// What the chapter writer's steps share: the chapter's scenes as the AI names them ("Sc 2"), and a finding (something the
// state check, the critic or the plain checks flagged, for a targeted fix or a scene written again). Pure.

import type { ID } from '@shared/types'

/** A scene of the chapter, as the AI names it. */
export interface SceneRef {
  id: ID
  /** Its number in the chapter, from 1. */
  n: number
  title: string
  /** "Sc 2 “The ferry”". */
  label: string
}

/** Something the state check, the critic or the plain checks found, for the run to put right. */
export interface Finding {
  /** "F1", "F2"... in the order found this run. */
  id: string
  sceneId: ID | null
  /**
   * check: the consistency checks (and the memory keeper's clashes); critic: a craft note; phrase: a stock AI phrase;
   * plan: the scene misses its part of the chapter plan (it is written again rather than a passage changed).
   */
  from: 'check' | 'critic' | 'phrase' | 'plan'
  /** The issue row it is (checks, and plan misses from the scene's contract). */
  issueId: ID | null
  /** What it is: "must fix · timeline", "critic · pacing · high", "plan · who is there". */
  kind: string
  what: string
  quote: string
  /** A suggested fix, rewrite or advice. */
  advice: string
  /** A critic note: its id in the kept critique and that critique's time, so it can be marked done when fixed. */
  note?: { id: string; at: string; target: { scope: 'scene' | 'chapter'; id: ID } }
  /** 'gone': no longer found, or found again under a new id. 'set-aside' is the earlier flow's. */
  status: 'open' | 'fixed' | 'set-aside' | 'gone'
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s)
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** A finding in one line, as the report lists it. */
export function findingLine(f: Finding, scenes: SceneRef[]): string {
  const where = f.sceneId ? (scenes.find((s) => s.id === f.sceneId)?.label ?? 'a scene') : 'the whole chapter'
  return `${f.id} [${where} · ${f.kind}] ${squash(f.what)}${f.quote ? ` Words: “${clip(squash(f.quote), 300)}”.` : ''}${f.advice ? ` Suggested: ${clip(squash(f.advice), 400)}` : ''}`
}

const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * A scene of the chapter from what the AI called it: "Sc 2", "Ch 3, Sc 2", "Scene 2", "2", its title or its id. Throws
 * (plain words, for the AI) when it names none of them.
 */
export function sceneNamed(scenes: SceneRef[], raw: string): ID {
  const v = raw.trim()
  if (!v) throw new Error(`Say which scene: ${scenes.map((s) => `“Sc ${s.n}”`).join(', ')}.`)
  const byId = scenes.find((s) => s.id === v)
  if (byId) return byId.id
  // "Sc 2 “The inn”": the number, before its title.
  const num = /(?:^|\bsc(?:ene)?\.?\s*)(\d+)\s*$/i.exec(v.replace(/\s*[“"].*$/, '').replace(/[“”"]/g, '').trim())
  if (num) {
    const s = scenes.find((x) => x.n === Number(num[1]))
    if (s) return s.id
  }
  const title = fold(v.replace(/^.*?sc(?:ene)?\s*\d+[,:]?\s*/i, '').replace(/["“”]/g, ''))
  const byTitle = scenes.find((s) => s.title && (fold(s.title) === title || fold(s.title) === fold(v)))
  if (byTitle) return byTitle.id
  throw new Error(`“${v}” isn't a scene of this chapter. Its scenes: ${scenes.map((s) => s.label).join(', ')}.`)
}
