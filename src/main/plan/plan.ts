// Plan before writing (step 4 of the consistency plan, Adam 2026-10-07; done properly in the overhaul, 2026-10-19, his
// spec "Plan before writing, done properly"). Before the prose is written, the memory model plans the scene:
// 1. Gather: the app gives it the core at no cost: the scene card, Adam's direction (said once), the end of the scene
//    before (or of the scene so far), everyone in the scene as the story index has them, what has already happened in
//    the last two chapters, the open plot threads, what must stay true and where things stand (core.ts).
// 2. Look up: it may ask for anything else the scene needs, all at once, with the look-up tools (ai/lookups/): codex
//    entries as they stand here, earlier passages, who knows what, where someone was last. The app answers them on this
//    computer, one round, and the model then plans in the same exchange.
// 3. Plan: what the point-of-view character wants, what stands in the way and the turn; the beats in order; who is
//    where; what it relies on; what changes by the end (place, clothes, things held, what people know); what must stay
//    true; the closing image; and the codex entries the briefing lacks.
// The app then checks the plan:
// - against the stage, as far as it still holds here (stageReach, as for what must stay true): a position the plan
//   relies on is told in the stage's own words; one the stage doesn't vouch for here only when the scene card says it.
//   Where the stage says nothing (not known, or empty), what people wear, hold and suffer is taken from the story index
//   in its own words, else kept when it is in what the planner was given or looked up (2026-10-19: starting facts were
//   mostly dropped before, against a stage that knew nothing);
// - a fact only when what the planner was given or looked up, the whole scene so far or the previous scene's end backs it,
//   in its words or in other words, and the scene so far's latest word on it doesn't say otherwise (2026-10-19: facts set
//   up earlier in the scene were dropped); never one kept from someone here;
// - a change is left out when it is already so, starts from something the stage says isn't so, is made by someone
//   dead, has someone learn what is kept from them (unless the scene card says so), or is an event the scene card or the
//   author's direction doesn't call for (moving, dressing, picking things up need no asking); a beat or the closing
//   image that brings someone in the card never asks for, or lets out a secret, is left out too.
// What is left goes in as the writer's own notes, after the closing instruction, so the prose carries on from it rather
// than from a distant rule: with cheap models (DeepSeek), events given as a rule were ignored 9 times in 9, and followed
// 3 times in 3 as text the model carried on from; what it looked up goes in the briefing beside it. Never holds a draft
// up: a plan that fails, is stopped or takes too long is no plan. No Electron imports.

import type Database from 'better-sqlite3'
import type { ChatMessage, ContextPreview, EntryState, ID } from '@shared/types'
import { clothesOf, quoteFound, thingsOf, type CharacterState, type SceneState, type StateField } from '@shared/continuity'
import { isOff, itemKey, namesItem, parsePiece, pieceText, thingText, type StageItem } from '@shared/stageItems'
import { looksLikeRefusalReply } from '@shared/refusal'
import { namedInProse } from '@shared/names'
import { beatsOnPage } from '@shared/beats'
import { newId } from '../util'
import * as gens from '../db/generations'
import type { MemoryModel } from '../keeper/model'
import { MEMORY_TEMPERATURE } from '../keeper/model'
import { modelKeyOf, noteRefusal } from '../keeper/refusals'
import { estimateTokens } from '../keeper/text'
import { EARLIER_BLOCK, LEFT_HERE_BLOCK, MUST_BLOCK, sceneTail, stageReach, type ContextInput, type PreparedContext } from '../ai/context'
import { OPEN_THREADS_BLOCK } from '../ai/openThreads'
import { deathOf } from '../ai/deaths'
import { pieceLine, secretsAmong, stageFor, stageLine, type Secret, type StageReach } from '../ai/mustStay'
import { SO_FAR_BLOCK } from '../beats/instructions'
import { CONTRACT_BLOCK, contractSays, directionAsks } from '../ai/contract'
import { BRIEF_BLOCK, type ContinuityBrief } from '../ai/brief'
import { runTask, stopTask } from '../ai/tasks'
import { answerLookups, LOOKUP_TOOLS, PASSAGE_WORDS, type LookupAnswer, type LookupContext } from '../ai/lookups'
import { clip } from '../ai/lookups/text'
import { coveredShare, REPEAT_SHARE, wordRuns } from '../ai/repeats'
import { CONTINUE_MARKS, PLAN_GO, PLAN_HEAD, PLAN_PARTS } from './echo'
import type { KnownFacts, PlanCore } from './core'
import type { CanHappen } from './preconditions'
import { BRIEF_LIMIT_MS, BRIEF_REPLY_SHARE, BRIEF_RULE, BRIEF_SHAPE, checkBrief, partText, readBrief, type BriefMaterial, type RawBrief } from './brief'

export { CONTINUE_MARKS, PLAN_GO, PLAN_HEAD, PLAN_PARTS } from './echo'

type DB = Database.Database

export const PLAN_MARKER = '[AIWRITE-PLAN v2]'
/** How long a draft waits for its plan (both requests, with a round of look-ups) before going ahead without one. */
export const PLAN_LIMIT_MS = 60_000
/** Room for the planner's reply. */
export const PLAN_REPLY_TOKENS = 1_600
/** The most of each the plan keeps (`must`: what must change, for the scene's contract, long story memory fix 13). */
export const PLAN_MOST = { relies: 10, changes: 8, needs: 4, must: 5, beats: 8, whoWhere: 6, mustStay: 5 }
/** Only a scene's newest few planning calls keep their whole prompt (each holds much of the briefing). */
export const KEEP_PLAN_PROMPTS = 10
/**
 * The most entries named for the planner: those in the briefing, and those it may ask for (2026-10-20: 150 before; those
 * that bear on the scene first, the rest found by name with get_entry).
 */
export const MOST_NAMED = { inBriefing: 40, others: 40 }
/** About how much of the words just before the planner reads. */
const BEFORE_WORDS = { min: 200, target: 300, max: 400 }
/** The longest line of the plan the writer gets. */
const LINE_MOST = 240

// ---------- What the planner is given ----------

export interface PlanMaterial {
  /** What is being written, in a few lines: a whole scene, a stretch carried on (with Adam's direction, said once), or the scene beat by beat. */
  ask: string
  card: string
  /** What must stay true (ai/mustStay.ts), as the writer gets it; '' for none. */
  must: string
  /** How far where things stand still holds here (stageReach). */
  reach: StageReach
  /** Where things stand, as the writer gets it, under its own title, with what of it may have changed; '' for none. */
  stand: string
  standTitle: string
  standNote: string
  /** The end of the scene so far, or of the previous scene. */
  before: { title: string; text: string } | null
  /** Each entry in the briefing, one line. */
  inBriefing: string[]
  /** The names of entries that exist here but aren't in the briefing, which the plan may ask for. */
  others: string[]
  /** The people on the scene card, and what some of them know and others don't. */
  people: string[]
  secrets: Secret[]
  /** What an event the plan has happen must answer to: the scene card, with the author's direction. */
  calls: string
  /**
   * The asks of Adam's direction about how the words read or how long they are ("more dialogue", "keep it under 800
   * words"; ai/contract.ts directionAsks), for the writer's notes (2026-10-19: the plan carried what happens and dropped
   * them). Left out: none.
   */
  reads?: string[]
  /**
   * The other plot threads still open, as the writer gets them (ai/openThreads.ts, 2026-10-08): kept alive gently, and
   * never paid off unless the card or the direction asks. '' or left out: none (the story index's, below, then).
   */
  threads?: string
  /**
   * What the story index gives at no cost (core.ts): everyone here as things stand, the scenes before, the threads, and
   * what was left in this place on an earlier visit (place memory; left out: none).
   */
  core?: (Pick<PlanCore, 'people' | 'recent' | 'threads'> & Partial<Pick<PlanCore, 'left' | 'travel' | 'notes'>>) | null
  /** The beats of the scene card already on the page (carrying on), as "Beat 1: …" lines. */
  done?: string[]
  /** The point-of-view character's name, for the writer's notes ("The point: Wren wants …"). */
  pov?: string
  /** The planner may look things up (ai/lookups/), one round, before it plans. */
  lookups?: boolean
  /**
   * The draft has a contract (long story memory fix 13, ai/contract.ts): the planner also says what must change by the
   * end, for its "Must change" list. Left out: no "must".
   */
  contract?: boolean
  /**
   * A continuity brief is wanted (long story memory fix 14, brief.ts): what the planner reads besides (the chapters so far
   * in short, the scene before and the scene so far word for word, what the story record says of the scene) and how long
   * the brief may be; it writes the brief with the plan. Left out: no brief.
   */
  brief?: BriefMaterial
  /** Said to the memory model when the style guide sets content above its second step (keeper/model.ts contentNoteFor). */
  contentNote?: string | null
  /**
   * Write the whole chapter (spec "Write the chapter, reworked", 2026-10-19): this scene's part of the chapter plan, made
   * before any scene was written, which the scene plan builds on. Left out: none.
   */
  chapter?: string
  /**
   * The words a fact the plan rests on may come from besides what the planner reads (2026-10-19: a stand-in test found
   * facts set up earlier in the same scene dropped, as only the last few hundred words were read): the whole scene so far
   * and the end of the previous scene as the writer gets it. Only for the check; never sent to the planner.
   */
  page?: { soFar?: string; previous?: string }
}

/**
 * The heading of what the card check found (plan/cardCheck.ts), in what the planner reads: the scene card against the story
 * so far, each line "Before writing, note: …", for the plan to resolve.
 */
export const CARD_NOTES_TITLE =
  'The scene card against the story so far (plan so that each of these is resolved: keep to the story so far, and never write what it rules out)'

/** The heading of the scene's part of the chapter plan, in what the planner reads. */
export const CHAPTER_PART_TITLE =
  "This scene's part of the chapter plan (made before any scene was written: build the scene plan on it, so its beats carry it out and what it says changes is among your changes)"

/** The words just before, as the planner reads them: the end of the scene so far, or of the previous scene. */
const BEFORE_TITLE = { soFar: 'The end of the scene so far', previous: 'The end of the previous scene' } as const

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()

/** What may have changed of where things stand, by how far it still holds here. */
export const STAND_NOTE: Record<StageReach, string> = {
  here: '',
  start:
    'This was as the scene before ended, earlier the same day. The scene card says where and when this scene is: people may have moved. Injuries, what people wear and what they hold carry on unless the card says otherwise, and so do the things in the place, given only when this scene is in the same place.',
  later:
    'This was as the scene before ended, and time has passed since (a later day, or how long is not known). Only injuries surely carry on: where people are, how they are placed and what they wear and hold may all have changed; what someone usually wears now, as what must stay true says, still holds.',
  none: ''
}

/**
 * What the planner reads, from the writer's briefing as it stands (before the plan) and what the story index gives
 * (`core`). `beats`: the scene is written beat by beat, so one plan is made for the whole of it (its beats, one for each
 * on the card), never one a beat.
 */
export function planMaterial(
  input: ContextInput,
  preview: ContextPreview,
  prepared: Pick<PreparedContext, 'finals' | 'contract'>,
  o: { core?: PlanCore | null; beats?: boolean; chapter?: string } = {}
): PlanMaterial {
  const sent = preview.blocks.filter((b) => !b.dropped)
  const block = (id: string) => sent.find((b) => b.id === id)
  const text = (id: string): string => block(id)?.text.trim() ?? ''
  const soFar = text(SO_FAR_BLOCK)
  const previous = text('previous-scene')
  const before = soFar
    ? { title: BEFORE_TITLE.soFar, text: sceneTail(soFar, BEFORE_WORDS) }
    : previous
      ? { title: BEFORE_TITLE.previous, text: sceneTail(previous, BEFORE_WORDS) }
      : null
  const byId = new Map<ID, EntryState>([...input.memory.elsewhere.map((x) => [x.entry.id, x.entry] as const), ...input.memory.entries.map((e) => [e.id, e] as const)])
  const shown = new Set((preview.entries ?? []).filter((e) => !e.hidden && e.blockId).map((e) => e.entryId))
  const hidden = new Set((preview.entries ?? []).filter((e) => e.hidden).map((e) => e.entryId))
  const inBriefing = [...shown]
    .map((id) => byId.get(id))
    .filter((e): e is EntryState => !!e)
    .slice(0, MOST_NAMED.inBriefing)
    .map((e) => `${e.name} (${e.kind})${clean(e.summary) ? `: ${clean(e.summary)}` : ''}`)
  const card = input.scene.card
  const people = [...new Set([card.povId, ...card.presentIds])]
    .map((id) => (id ? byId.get(id) : undefined))
    .filter((e): e is EntryState => !!e && e.kind === 'character')
  const others = othersFor(input, { shown, hidden, people, recent: o.core?.recent ?? [] })
  const reach = stageReach(input)
  const stand = reach === 'none' ? null : block('continuity')
  // Adam's direction is said once, in what is being written (2026-10-19: the writer's scene card leaves it out for a whole
  // scene too, as it is the closing instruction's last words); Beat by beat's scene card still says it.
  const direction = clean(input.options.direction)
  const carrying = !!input.options.addBelow && !!soFar
  const cardText = text('scene-card')
  const reads = o.beats ? [] : directionAsks(direction).filter((a) => a.kind !== 'event').map((a) => a.text)
  // With a contract (fix 13), what must stay true leaves out what the contract says at the start and must not change:
  // the planner is told those lines with the rest of it.
  const contractLines = sent.some((b) => b.id === CONTRACT_BLOCK.id) ? [...contractSays(prepared.contract)].map((l) => `- ${l}`) : []
  const must = [text(MUST_BLOCK), ...contractLines].filter(Boolean).join('\n')
  const beats = card.beats.map(clean).filter(Boolean)
  const onPage = soFar ? beatsOnPage(beats, input.soFar ?? soFar) : 0
  const pov = card.povId ? byId.get(card.povId)?.name : undefined
  const page = { soFar: soFar ? (input.soFar?.trim() || soFar) : '', previous }
  return {
    ...(page.soFar || page.previous ? { page } : {}),
    ask: askText(input, { carrying, beats: !!o.beats, soFar: !!soFar, onPage }),
    card: cardText,
    must,
    reach,
    stand: stand?.text.trim() ?? '',
    standTitle: stand?.title ?? 'Where things stand',
    standNote: stand ? STAND_NOTE[reach] : '',
    before,
    inBriefing,
    others,
    people: people.map((e) => e.name),
    secrets: secretsAmong(people, input.memory.facts),
    calls: [cardText, direction && !o.beats ? `The author's direction for this ${carrying ? 'stretch' : 'draft'}:\n${direction}` : '']
      .filter(Boolean)
      .join('\n\n'),
    ...(reads.length ? { reads } : {}),
    threads: text(OPEN_THREADS_BLOCK),
    ...(o.core
      ? {
          core: {
            people: o.core.people,
            recent: o.core.recent,
            threads: o.core.threads,
            left: o.core.left ?? [],
            travel: o.core.travel ?? [],
            ...(o.core.notes?.length ? { notes: o.core.notes } : {})
          }
        }
      : {}),
    ...(onPage ? { done: beats.slice(0, onPage).map((b, i) => `Beat ${i + 1}: ${b}`) } : {}),
    ...(pov ? { pov } : {}),
    // A scene planned once for its beats leaves each beat's own contract as the card says it.
    ...(input.contract && !o.beats ? { contract: true } : {}),
    ...(o.chapter?.trim() ? { chapter: o.chapter.trim() } : {})
  }
}

/**
 * The codex's other entries, not in the briefing, which the plan may ask for ("needs"), in name order: at most
 * MOST_NAMED.others, those that bear on the scene first (tied to someone on the card, or named in what has just happened),
 * then anything but an event, then events; and how many more there are, found by name with get_entry (2026-10-20).
 */
function othersFor(
  input: ContextInput,
  o: { shown: ReadonlySet<ID>; hidden: ReadonlySet<ID>; people: EntryState[]; recent: readonly string[] }
): string[] {
  const here = new Set(o.people.map((p) => p.id))
  const tied = new Set(input.memory.relationships.flatMap((r) => (here.has(r.aId) ? [r.bId] : here.has(r.bId) ? [r.aId] : [])))
  const recent = o.recent.join('\n')
  const named = (e: EntryState): boolean => [e.name, ...(e.aliases ?? [])].some((n) => clean(n).length >= 2 && namedInProse(recent, clean(n)))
  const rank = (e: EntryState): number => (tied.has(e.id) || (recent && named(e)) ? 0 : e.kind === 'event' ? 2 : 1)
  const all = input.memory.entries.filter((e) => !o.shown.has(e.id) && !o.hidden.has(e.id))
  const kept = all
    .map((e) => ({ e, r: rank(e) }))
    .sort((a, b) => a.r - b.r || a.e.name.localeCompare(b.e.name))
    .slice(0, MOST_NAMED.others)
    .map((x) => x.e)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => {
      const aka = (e.aliases ?? []).map(clean).filter(Boolean)
      return `${e.name} (${e.kind}${aka.length ? `; also ${aka.join(', ')}` : ''})`
    })
  const more = all.length - kept.length
  return more > 0 ? [...kept, `(and ${more.toLocaleString('en-GB')} more: get_entry finds any by name)`] : kept
}

/**
 * What is being written, for the planner: a whole scene or a stretch carried on (the direction said here, once), or the
 * scene beat by beat (its direction on the scene card).
 */
function askText(input: ContextInput, o: { carrying: boolean; beats: boolean; soFar: boolean; onPage: number }): string {
  const words = input.options.targetWords
  const beats = input.scene.card.beats.map(clean).filter(Boolean)
  const direction = clean(input.options.direction)
  if (o.beats) {
    const each = words == null ? '' : `, about ${words.toLocaleString('en-GB')} words a beat`
    const left = beats.slice(o.onPage)
    return [
      `The whole scene, written one beat at a time${o.soFar ? ', carrying on from the end of the scene so far' : ''}${each}.`,
      left.length ? `Give "beats" one line for each beat on the scene card not yet on the page, in the same order (${left.length} in all).` : ''
    ]
      .filter(Boolean)
      .join(' ')
  }
  if (o.carrying) {
    const most = words == null ? 'a few hundred words at most' : `at most about ${words.toLocaleString('en-GB')} words`
    const next = beats[o.onPage]
    const what = direction
      ? `what the author directs:\n${direction}`
      : next
        ? `the next beat on the scene card, beat ${o.onPage + 1} of ${beats.length}:\n${next}`
        : 'a short way on from where the scene has got to, towards what the scene card describes.'
    return `The next stretch of the scene, carrying straight on from the end of the scene so far, ${most}. Plan only this stretch: ${what}`
  }
  const whole = `A whole scene, ${words == null ? 'as long as it needs to be' : `about ${words.toLocaleString('en-GB')} words`}`
  return direction ? `${whole}, as the author directs:\n${direction}` : `${whole}.`
}

const SYSTEM = `${PLAN_MARKER} plan
You plan one scene of a novel just before it is written, so that it has a clear shape and keeps to the facts. You don't write any of the scene.

Read what you are given: what has already happened, the scene card, what must stay true, everyone in the scene as things stand, where things stand, the words just before, and what is being written. When you are asked to carry the scene on for a stretch, plan only that stretch.

The plan:
- wants, against, turn: what the point-of-view character wants here, what stands in the way, and how it turns by the end. One short sentence each, from the scene card's goal, conflict and outcome where it has them.
- beats: what happens, in order, one short sentence each: the scene card's beats and the author's direction made concrete, with the moves they need. Nothing that has already happened or is already on the page, and no events of your own.
- who_where: who is there as it starts and where each is ("Wren: by the hearth, on the settle").
- relies: the facts and positions the scene relies on: where people are, each piece of clothing they wear or took off, what they hold, how they are placed, injuries, and the things in the place (a door barred, a case on the windowsill). Copy each value word for word from what you are given or looked up. Never guess one.
- changes: what changes on the page, in the order it happens: a move to another place, clothes put on or taken off, something picked up, put down or handed over, someone learning something. Only what the scene card, its beats or the author's direction call for, and the moves they need. For each: how it is now (from), how it is after (to), and how it happens, in one short sentence (how). Add no events of your own.
- must_stay: what must stay true all through the scene, at most 5 short lines, from what you were given: what someone doesn't know, an injury, where something is.
- closing_image: the image the scene (or the stretch) ends on, in one short sentence.
- needs: the names of entries under "Also in the world" that the scene needs and the briefing lacks (a place it moves to, an object or a person it brings in). Exactly as listed, at most 4. None is fine.

Reply with only a JSON object:
{"wants": "", "against": "", "turn": "", "beats": [""], "who_where": [""], "relies": [{"who": "", "what": "", "value": ""}], "changes": [{"who": "", "what": "", "from": "", "to": "", "how": ""}], "must_stay": [""], "closing_image": "", "needs": [""]}
- who: a character's name as given, or "" for the scene itself or a fact about the world.
- what: one of where, wearing, position, touching, sees, holding, condition, mood, knows, time, light, weather, thing, or fact.
- A piece of clothing: what is "wearing", and the value, from and to name the piece and how it is ("boots off, by the door"). A thing in the place: what is "thing", who is whoever changes it (or ""), and the value, from and to name the thing and how it is ("the door: barred from inside").
- Keep to what must stay true and to where things stand: nothing changes unless it happens on the page, and each change starts from how things are now.
- What is kept from someone stays kept: never have them learn, guess or be told it, unless the scene card says so.
- Open plot threads stay open: plan no payoff for one unless the scene card or the author's direction asks for it, or its line says to pay it off now. One may come in only where it fits what is asked.
- At most ${PLAN_MOST.beats} beats, ${PLAN_MOST.relies} relies and ${PLAN_MOST.changes} changes, the ones that matter most. Keep each short.`

/** What the planner is told of the look-ups, when it may make them (the tools themselves go with the request). */
export const LOOKUP_RULE =
  'Before you plan, if the scene needs something you weren’t given (a codex entry as it stands here, where someone was last, who knows something), look it up with the tools. You have what happened earlier only in short, not the earlier scenes’ own words: to read what an earlier scene said, word for word, use read_passage (find_in_story finds where something was said). Ask for everything you need at once: you get one round of look-ups. Look up nothing you were already given.'

/**
 * The instructions with the scene's contract (long story memory fix 13): the plan also says what must change by the end,
 * as short statements the check after the draft can find in the words. The plan's own call, a little longer: no new call.
 */
const SYSTEM_WITH_CONTRACT = SYSTEM.replace(
  '- needs: the names of entries',
  `- must: what must be different by the end of what is being written for it to do what is asked: at most ${PLAN_MOST.must} short statements a reader could check in the finished words ("Mara tells Tobin the letter is forged"). Only what the scene card's beats, goal and outcome, the author's direction, or a plot thread the card sets up or pays off call for, never the moves on the way. Nothing of your own.
- needs: the names of entries`
).replace('"needs": [""]}', '"needs": [""], "must": [""]}')

/**
 * The planner's instructions: with "must" when the draft has a contract, with "brief" when a continuity brief is wanted
 * (fix 14; how long it may be is said at the end of the request, so these stay the same from scene to scene and what
 * comes after them stays in a provider's cache), and with the look-ups when it may make them.
 */
export const planSystem = (contract = false, brief = false, lookups = false): string => {
  let s = contract ? SYSTEM_WITH_CONTRACT : SYSTEM
  if (lookups) s = s.replace('\n\nThe plan:\n', `\n${LOOKUP_RULE}\n\nThe plan:\n`)
  if (!brief) return s
  return s.replace('\n\nReply with only a JSON object:', `\n${BRIEF_RULE}\n\nReply with only a JSON object:`).replace(/^(\{"wants".*)\}$/m, `$1, ${BRIEF_SHAPE}}`)
}

/** What the planner is asked last, and (with the look-ups) again once they are answered. */
export function planAsk(m: Pick<PlanMaterial, 'brief' | 'lookups'>, again = false): string {
  const what = m.brief ? `plan the scene and write its continuity brief (at most about ${m.brief.words.toLocaleString('en-GB')} words)` : 'plan the scene'
  if (again) return `Now ${what}, as one JSON object. Reply with only the JSON object.`
  return m.lookups ? `Look up anything else the scene needs, all at once; or ${what} now, as one JSON object.` : `P${what.slice(1)} now, as one JSON object.`
}

/**
 * What the memory model is asked. In an order a provider that reuses the start of a prompt it has seen (DeepSeek,
 * OpenAI) can use: what stays the same from one step of a scene to the next first (what has already happened, the scene
 * card, what must stay true, the codex, the threads, everyone here), then where things stand and the words just before,
 * and last what is being written, which changes at every step.
 *
 * With a continuity brief (fix 14, trimmed 2026-10-20): the story record first, its steadiest parts leading (the chapters
 * so far in short, the same at every scene of a chapter, and the scene before, the same at every step of a scene: Claude
 * is asked to cache up to its end, `cacheUpTo`), then the plan's own parts, then what changes from step to step (the scene
 * so far word for word, the earlier passages found, the scene's contract), and last what is being written. The words just
 * before aren't said again when the record has their scene word for word. `whole` false: the scenes' own words are a note
 * (for the record kept in the world).
 */
export function planMessages(m: PlanMaterial, whole = true): ChatMessage[] {
  const part = (title: string, body: string): string => (body.trim() ? `## ${title}\n${body.trim()}` : '')
  const lines = (list: readonly string[] | undefined): string => (list ?? []).map((l) => `- ${l}`).join('\n')
  const b = m.brief
  const threads = clean(m.threads) ? m.threads! : lines(m.core?.threads)
  // The words just before, unless the record has their scene word for word.
  const beforeOf = m.before?.title === BEFORE_TITLE.soFar ? 'soFar' : 'previous'
  const before = m.before && ![...(b?.record ?? []), ...(b?.late ?? [])].some((p) => p.scene?.of === beforeOf) ? m.before : null
  const record = (b?.record ?? []).map((p) => partText(p, whole))
  const steady = (b?.record ?? []).findIndex((p) => !p.steady)
  const user = [
    ...record,
    part('Already happened (a line a scene; never plan any of it again)', lines(m.core?.recent)),
    part('The scene card', m.card),
    part(CHAPTER_PART_TITLE, m.chapter ?? ''),
    part('Must stay true', m.must),
    part('In the briefing', lines(m.inBriefing)),
    part('Also in the world (not in the briefing)', m.others.join('; ')),
    part('Open plot threads', threads),
    part('Everyone in the scene, as things stand (from the story so far)', lines(m.core?.people)),
    part('Left in this place on an earlier visit (from the story so far)', lines(m.core?.left)),
    part('Getting here (from the story so far)', lines(m.core?.travel)),
    part(CARD_NOTES_TITLE, lines(m.core?.notes)),
    part(m.standTitle, m.stand ? [m.standNote, m.stand].filter(Boolean).join('\n') : ''),
    before ? part(before.title, `"""\n${before.text}\n"""`) : '',
    part('Already on the page in this scene (done: never plan it again)', lines(m.done)),
    ...(b?.late ?? []).map((p) => partText(p, whole)),
    part('What is being written', m.ask),
    planAsk(m)
  ]
    .filter(Boolean)
    .join('\n\n')
  // The record's steady parts, the same at every step of a scene: marked for a model that caches only where asked
  // (client.ts sentMessages).
  const lead = record.slice(0, steady < 0 ? record.length : steady).filter(Boolean)
  const cacheUpTo = whole && lead.length ? lead.join('\n\n').length : 0
  const system = planSystem(!!m.contract, !!b, !!m.lookups)
  return [
    { role: 'system', content: m.contentNote ? `${system}\n\n${m.contentNote}` : system },
    { role: 'user', content: user, ...(cacheUpTo ? { cacheUpTo } : {}) }
  ]
}

// ---------- Reading the reply ----------

export interface RawPlan {
  relies: { who: string; what: string; value: string }[]
  changes: { who: string; what: string; from: string; to: string; how: string }[]
  needs: string[]
  /** What must change by the end (the scene's contract, fix 13); empty or left out when not asked for or not given. */
  must?: string[]
  /** The scene's shape (2026-10-19); each '' or empty when the reply has none. */
  wants?: string
  against?: string
  turn?: string
  beats?: string[]
  whoWhere?: string[]
  mustStay?: string[]
  closing?: string
  /** The continuity brief's lists (fix 14); left out when the reply has none. */
  brief?: RawBrief
}

const str = (v: unknown): string => (typeof v === 'string' ? clean(v).slice(0, 400) : '')
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []
/** A list of short texts: strings, or objects with their words under one of `keys`. */
const texts = (v: unknown, keys: string[] = ['text', 'what', 'beat', 'line']): string[] =>
  (Array.isArray(v) ? v : [])
    .map((n) => {
      if (typeof n === 'string') return str(n)
      if (!n || typeof n !== 'object') return ''
      const o = n as Record<string, unknown>
      const who = str(o.who) || str(o.name)
      const at = str(o.where) || str(o.place)
      if (who && at && !keys.some((k) => str(o[k]))) return `${who}: ${at}`
      return keys.map((k) => str(o[k])).find(Boolean) ?? ''
    })
    .filter(Boolean)

/** The planner's reply, read; null when it isn't JSON. Anything missing is empty. */
export function readPlan(reply: string): RawPlan | null {
  const body = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)
  let v: unknown
  try {
    v = JSON.parse(body)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const brief = readBrief(o.brief)
  return {
    ...(brief ? { brief } : {}),
    relies: list(o.relies).map((r) => ({ who: str(r.who), what: str(r.what), value: str(r.value) })),
    changes: list(o.changes).map((c) => ({ who: str(c.who), what: str(c.what), from: str(c.from), to: str(c.to), how: str(c.how) })),
    needs: (Array.isArray(o.needs) ? o.needs : [])
      .map((n) => (typeof n === 'string' ? str(n) : n && typeof n === 'object' ? str((n as Record<string, unknown>).name) : ''))
      .filter(Boolean),
    must: texts(o.must),
    wants: str(o.wants),
    against: str(o.against),
    turn: str(o.turn),
    beats: texts(o.beats),
    whoWhere: texts(o.who_where ?? o.whoWhere),
    mustStay: texts(o.must_stay ?? o.mustStay),
    closing: str(o.closing_image ?? o.closingImage)
  }
}

// ---------- Checking it against the stage ----------

type SceneField = 'time' | 'light' | 'weather'
type Field = StateField | SceneField | 'wearing' | 'thing' | 'knows'

/** The stage's field for what the planner wrote ("position" is posture); null for a fact. */
export function fieldOf(what: string): Field | null {
  const w = what.toLowerCase().replace(/[^a-z]/g, '')
  if (['where', 'place', 'location', 'whereabouts'].includes(w)) return 'where'
  if (['wearing', 'clothes', 'clothing', 'dress', 'outfit'].includes(w)) return 'wearing'
  if (['position', 'posture', 'pose', 'placed'].includes(w)) return 'posture'
  if (['touching', 'touch', 'touches', 'contact'].includes(w)) return 'touching'
  if (['sees', 'seeing', 'sight', 'hears', 'hearing', 'seesorhears', 'senses'].includes(w)) return 'sees'
  if (['thing', 'things', 'object', 'objects', 'item', 'items', 'door', 'prop'].includes(w)) return 'thing'
  if (['holding', 'carrying', 'held', 'holds'].includes(w)) return 'holding'
  if (['knows', 'knowledge', 'learns', 'learned', 'learnt', 'learn', 'findsout'].includes(w)) return 'knows'
  if (['condition', 'injury', 'injuries', 'health', 'body'].includes(w)) return 'condition'
  if (['mood', 'feeling', 'feelings'].includes(w)) return 'mood'
  if (['lastaction', 'action'].includes(w)) return 'lastAction'
  if (w === 'time' || w === 'light' || w === 'weather') return w
  return null
}

const SCENE_FIELDS: readonly string[] = ['time', 'light', 'weather']
/**
 * The stage's fields that still hold here, by how far the stage reaches (as what must stay true keeps them). The things
 * in the place reach a new scene's start only when it is the same place: the stage has none otherwise.
 */
const IN_REACH: Record<StageReach, readonly Field[]> = {
  here: [
    'where',
    'wearing',
    'posture',
    'touching',
    'sees',
    'holding',
    'condition',
    'mood',
    'lastAction',
    'time',
    'light',
    'weather',
    'thing'
  ],
  start: ['condition', 'wearing', 'holding', 'thing'],
  later: ['condition'],
  none: []
}
/**
 * Changes that need no asking: people moving, dressing, touching, picking things up and putting them down, opening a
 * door, and how they feel. Who sees whom is not among them: someone being seen can be what happens.
 */
const FREE_MOVES: readonly Field[] = ['where', 'wearing', 'posture', 'touching', 'holding', 'mood', 'lastAction', 'thing']

/** Words that say how something is, in pairs that can't both hold. */
const OPPOSITES: [string, string][] = [
  ['on', 'off'],
  ['open', 'closed'],
  ['open', 'shut'],
  ['up', 'down'],
  ['in', 'out'],
  ['standing', 'sitting'],
  ['standing', 'lying'],
  ['sitting', 'lying'],
  ['standing', 'kneeling'],
  ['asleep', 'awake'],
  ['locked', 'unlocked'],
  ['locked', 'open'],
  ['barred', 'open'],
  ['barred', 'unbarred'],
  ['bolted', 'open'],
  ['bolted', 'unbolted'],
  ['lit', 'unlit'],
  ['lit', 'out'],
  ['dry', 'wet'],
  ['dry', 'soaked'],
  ['buttoned', 'unbuttoned'],
  ['laced', 'unlaced'],
  ['tied', 'untied']
]
const STATE_WORDS = new Set(OPPOSITES.flat())
const opposite = (a: string, b: string): boolean => OPPOSITES.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
const SMALL = new Set(['the', 'and', 'her', 'his', 'their', 'its', 'a', 'an', 'of', 'with', 'by', 'at', 'to', 'from', 'over', 'under', 'she', 'he', 'they'])
const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/** Words that say how a thing is only when no "the", "a" or "her" comes after them: "boots on" but "boots on the hearth". */
const PREPOSITIONS = new Set(['on', 'off', 'in', 'out', 'up', 'down'])
const DETERMINERS = new Set(['the', 'a', 'an', 'his', 'her', 'their', 'its', 'my', 'our', 'your', 'this', 'that', 'these', 'those'])

/** The word saying how a thing is, nearest to it (within three words; after it on a tie), or null. */
function stateNear(words: string[], at: number): string | null {
  let best: { word: string; d: number; after: boolean } | null = null
  for (let j = Math.max(0, at - 3); j <= Math.min(words.length - 1, at + 3); j++) {
    if (j === at || !STATE_WORDS.has(words[j])) continue
    // Where it is, not how it is: "on the hearth", "in her pocket".
    if (PREPOSITIONS.has(words[j]) && DETERMINERS.has(words[j + 1] ?? '')) continue
    const d = Math.abs(j - at)
    if (!best || d < best.d || (d === best.d && j > at && !best.after)) best = { word: words[j], d, after: j > at }
  }
  return best?.word ?? null
}

/**
 * True when two descriptions disagree about something both name: "boots on" and "shirt open, boots off by the door"
 * (the boots), "sitting by the fire" and "standing by the fire". Only the word saying how each thing is counts, so
 * different wording that agrees ("cloak on, boots off" and "boots off, cloak on") doesn't.
 */
export function contradicts(a: string, b: string): boolean {
  const x = tokens(a)
  const y = tokens(b)
  for (let i = 0; i < x.length; i++) {
    const w = x[i]
    if (w.length < 3 || SMALL.has(w) || STATE_WORDS.has(w)) continue
    const s = stateNear(x, i)
    if (!s) continue
    for (let j = 0; j < y.length; j++) {
      if (y[j] !== w) continue
      const t = stateNear(y, j)
      if (t && opposite(s, t)) return true
    }
  }
  // How a person is placed: "standing" against "sitting on the bed", with nothing named in both.
  const pose = (ws: string[]): string | null => ws.find((v) => ['standing', 'sitting', 'lying', 'kneeling'].includes(v)) ?? null
  const p = pose(x)
  const q = pose(y)
  return !!p && !!q && opposite(p, q)
}

const plainText = (s: string): string => tokens(s).join(' ')

/** Words that say little about what happens. */
const FILLER = new Set([
  'the', 'and', 'her', 'his', 'him', 'she', 'they', 'them', 'their', 'its', 'was', 'were', 'are', 'has', 'had', 'have', 'been', 'for',
  'but', 'not', 'who', 'how', 'did', 'does', 'one', 'out', 'off', 'can', 'may', 'that', 'this', 'with', 'from', 'into', 'onto',
  'then', 'than', 'there', 'what', 'when', 'where', 'which', 'while', 'about', 'over', 'under', 'after', 'before', 'still', 'just',
  'only', 'some', 'more', 'most', 'very', 'back', 'down', 'again', 'once', 'each', 'other', 'will', 'would', 'says', 'said', 'tells',
  'told', 'scene', 'beat', 'now', 'all', 'any', 'too', 'yet', 'own'
])
const stem = (w: string): string => (w.length > 5 ? w.replace(/(ing|ed|es|s)$/, '') : w)
/** The words of a text that say what happens: no filler, no names of the people in the scene, endings taken off. */
const meaningWords = (s: string, names: ReadonlySet<string>): Set<string> =>
  new Set(tokens(s).filter((w) => w.length >= 3 && !FILLER.has(w) && !names.has(w)).map(stem))
const sharedWords = (a: Set<string>, b: Set<string>): number => [...a].filter((w) => b.has(w)).length

/** The words of a change's `to` that weren't there before (`was`: its `from` and how things stand), in order. */
export function newWordsOf(to: string, was: string): string {
  const old = new Set(tokens(was))
  return tokens(to)
    .filter((t) => !old.has(t))
    .join(' ')
}

/** True when `text` says the secret `fact`: enough of the fact's own words (two, or a third of them) are in it. */
function says(text: string, fact: string, names: ReadonlySet<string>): boolean {
  const f = meaningWords(fact, names)
  if (!f.size) return false
  return sharedWords(f, meaningWords(text, names)) >= Math.min(f.size, Math.max(2, Math.ceil(f.size / 3)))
}

/** True when what a change makes happen answers to `calls` (the card, or the beat): a third of its words are there. */
function calledFor(change: string, calls: string, names: ReadonlySet<string>): boolean {
  const c = meaningWords(change, names)
  if (!c.size) return false
  return sharedWords(c, meaningWords(calls, names)) >= Math.max(1, Math.ceil(c.size / 3))
}

export interface CheckWith {
  /** Where things stand at the point of writing; null when not known. */
  stand: SceneState | null | undefined
  /** How far it still holds here (stageReach). */
  reach: StageReach
  /**
   * What the planner was given (without where things stand, unless it all holds here) and what it looked up, for the facts
   * it relies on.
   */
  material: string
  /** The scene card as the writer gets it: a position the stage doesn't vouch for here only when the card says it. */
  card: string
  /** What an event must answer to: the scene card, with the author's direction. */
  calls: string
  /** The people on the scene card, and what some of them know and others don't. */
  people: string[]
  secrets: Secret[]
  /** Every entry that exists here, for what the plan asks for and who is dead. */
  entries: EntryState[]
  /** Entries already in the briefing, and those Adam kept out: never asked for. */
  inBriefing: ReadonlySet<ID>
  hidden: ReadonlySet<ID>
  /**
   * What the story index says of each person here (core.ts), by name: where the stage says nothing, what they wear, hold
   * and suffer is taken from it, in its own words. Left out: nothing known.
   */
  known?: KnownFacts
  /** Everyone in the scene by name (the card, the stage, the story index), for who may be placed and who is a stranger. */
  present?: string[]
  /** The beats of the card already on the page ("Beat 1: …"): a plan beat that says one again is left out. */
  done?: string[]
  /**
   * The scene so far, whole, when the writing carries on from it: a fact or position it gives (anywhere in it, not only in
   * the last few hundred words the planner reads) is one the plan may rest on, and one its latest words say otherwise of
   * is not (2026-10-19).
   */
  soFar?: string
  /** The end of the previous scene as the writer gets it: what people wear, hold and suffer, and facts, may rest on it. */
  previous?: string
}

export interface ScenePlan {
  /** What the point-of-view character wants, what stands in the way, and the turn; '' for any not said. */
  point: { wants: string; against: string; turn: string }
  /** What happens, in order. */
  beats: string[]
  /** Who is where as it starts ("Wren: by the hearth"). */
  whoWhere: string[]
  /** What the scene rests on, as things stand. */
  keep: string[]
  /** What changes on the page, in order. */
  changes: string[]
  /** What must stay true all through it. */
  mustStay: string[]
  /** The image it ends on; '' for none. */
  closing: string
  /** The codex entries to bring into the briefing. */
  needs: ID[]
  /** What must change by the end, for the scene's contract (fix 13): only what the card or the direction calls for. */
  must: string[]
  /** How the check went: values put right from the stage or the story index, and things left out. */
  checked: { corrected: number; dropped: number }
  /**
   * What must happen first for a beat to be able to happen (plan/preconditions.ts, 2026-10-19), by the beat's index from 0:
   * "First Mara must fetch the letter from the vestry, …". Said after that beat in the writer's notes. Left out: none.
   */
  first?: { beat: number; note: string }[]
}

/** A plan that says nothing yet. */
export const emptyPlan = (): ScenePlan => ({
  point: { wants: '', against: '', turn: '' },
  beats: [],
  whoWhere: [],
  keep: [],
  changes: [],
  mustStay: [],
  closing: '',
  needs: [],
  must: [],
  checked: { corrected: 0, dropped: 0 }
})

/** The fields a new scene carries over from the scene before: what people wear, hold and suffer (the story index's). */
const CARRIED: readonly Field[] = ['wearing', 'holding', 'condition']
/** Words saying someone comes into the scene. */
const ARRIVES =
  /\b(?:arriv\w*|enter\w*|appear\w*|turn\w* up|burst\w*|barge\w*|step\w* in|walk\w* in|come\w* in|came in|shows? up|showed up|knock\w*|ride\w* in|rode in|is let in|lets? \w+ in)\b/i
/** Someone not named but coming in all the same: "a stranger bursts in", "someone knocks". */
const SOMEONE = /\b(?:a stranger|strangers|someone|somebody|a man|a woman|a figure|a rider|men|soldiers|guards)\b/i

/** The plan, checked against the stage, the story index and the codex (see the top of this file). */
export function checkPlan(raw: RawPlan, w: CheckWith): ScenePlan {
  const keep: string[] = []
  const changes: string[] = []
  const needs: ID[] = []
  let corrected = 0
  let dropped = 0
  const reaches = (f: Field): boolean => IN_REACH[w.reach].includes(f)
  const stage = (who: string): CharacterState | null => (who ? stageFor({ name: who, aliases: [] }, w.stand) : null)
  /**
   * The pieces someone wears, or the things in the place, that `about` names (for clothing with none named, all of them;
   * a thing has to be named), where the stage still holds here.
   */
  const itemsOf = (who: string, f: 'wearing' | 'thing', about: string): StageItem[] => {
    if (!reaches(f)) return []
    const all = f === 'thing' ? thingsOf(w.stand) : clothesOf(stage(who))
    const named = all.filter((x) => namesItem(about, x))
    return named.length || f === 'thing' ? named : all
  }
  /** What the stage says of a field here (of the pieces or things `about` names); '' when it doesn't say, or doesn't hold here. */
  const nowOf = (who: string, f: Field, about = ''): string => {
    if (f === 'wearing') return itemsOf(who, f, about).map(pieceText).join('; ')
    if (f === 'thing') return itemsOf(who, f, about).map(thingText).join('; ')
    if (f === 'knows') return ''
    return !reaches(f) ? '' : SCENE_FIELDS.includes(f) ? clean(w.stand?.[f as SceneField]) : clean(stage(who)?.[f as StateField])
  }
  /** True when a change's `to` is how it already is: the same words, or putting on a piece already on. */
  const alreadySo = (who: string, f: Field, to: string, now: string): boolean => {
    if (plainText(to) === plainText(now)) return true
    if (f !== 'wearing') return false
    const want = parsePiece(to)
    return itemsOf(who, f, to).some(
      (p) =>
        plainText(pieceText(p)) === plainText(to) || (!!want && !isOff(p.state) && !want.state && itemKey(want.name) === itemKey(p.name))
    )
  }
  const nameOf = (who: string): string => clean(stage(who)?.name) || who
  /** What the story index says of someone's field here (its own words), for the fields a new scene carries over. */
  const indexOf = (who: string, f: Field): string[] => {
    if (!who || !CARRIED.includes(f)) return []
    const n = clean(who).toLowerCase()
    const key = Object.keys(w.known ?? {}).find((k) => k === n || k.startsWith(`${n} `))
    return key ? (w.known![key][f as 'wearing' | 'holding' | 'condition'] ?? []).map(clean).filter(Boolean) : []
  }
  const put = (line: string): void => {
    if (line && !keep.some((l) => l.toLowerCase() === line.toLowerCase())) keep.push(line)
  }
  const names = new Set(w.people.flatMap((n) => tokens(n)))
  const onCard = (who: string): boolean => {
    const n = clean(who).toLowerCase()
    return !!n && w.people.some((p) => p.toLowerCase() === n || p.toLowerCase().startsWith(`${n} `))
  }
  const here = new Set([...w.people, ...(w.present ?? []), ...(w.stand?.characters ?? []).map((c) => c.name)].map((n) => clean(n).toLowerCase()))
  const isHere = (who: string): boolean => {
    const n = clean(who).toLowerCase()
    return !!n && [...here].some((p) => p === n || p.startsWith(`${n} `) || n.startsWith(`${p} `))
  }
  /** Says something kept from someone in the scene that the scene card doesn't bring up. */
  const tellsSecret = (text: string): boolean => w.secrets.some((s) => says(text, s.fact, names) && !says(w.card, s.fact, names))
  const dead = w.entries.filter((e) => deathOf(e)).flatMap((e) => [e.name, ...(e.aliases ?? [])].map((n) => clean(n).toLowerCase()))
  const isDead = (who: string): boolean => {
    const n = clean(who).toLowerCase()
    return !!n && dead.some((d) => d === n || d.startsWith(`${n} `))
  }
  /**
   * Someone comes in whom the card, the direction and the scene don't have: a character named with words of arriving, or
   * someone unnamed arriving ("a stranger bursts in").
   */
  const strangerIn = (text: string): boolean => {
    if (!ARRIVES.test(text)) return false
    const callWords = plainText(w.calls)
    const named = w.entries.filter(
      (e) => e.kind === 'character' && [e.name, ...(e.aliases ?? [])].some((n) => clean(n).length >= 3 && namedInProse(text, n))
    )
    if (named.some((e) => !isHere(e.name) && ![e.name, ...(e.aliases ?? [])].some((n) => callWords.includes(plainText(n))))) return true
    return !named.length && SOMEONE.test(text) && !says(w.calls, text, names)
  }

  /**
   * The words a fact or position may rest on, besides what the planner was given and looked up: the scene so far, for
   * anything (they are this scene's own words); the end of the previous scene for what people wear, hold and suffer, the
   * things in the place and facts (only injuries after a later day). The previous scene's end comes first: the scene so
   * far is after it.
   */
  const pageFor = (f: Field | null): string[] => {
    const out: string[] = []
    const carried = f == null || CARRIED.includes(f) || f === 'thing'
    if (clean(w.previous) && carried && (w.reach !== 'later' || f == null || f === 'condition')) out.push(w.previous!)
    if (clean(w.soFar)) out.push(w.soFar!)
    return out
  }
  /**
   * True when what the plan relies on is backed: its words are in what the planner was given or looked up (`given`), or in
   * the words of the scene so far or the scene before (pageFor), whole or each of its parts ("stockinged feet; jumper damp
   * at the cuffs", told paragraphs apart), and the scene so far's latest word on it (on each part) doesn't say otherwise.
   * The weather, the time and the light may be one word ("rain"). Never a secret kept from someone here.
   */
  const backed = (value: string, who: string, f: Field | null, given: string): boolean => {
    if (tellsSecret(value)) return false
    const alone = !!f && SCENE_FIELDS.includes(f)
    const found = (v: string): boolean =>
      quoteFound(v, given) || saysIn(v, who, given, names, { alone }) || pageFor(f).some((t) => quoteFound(v, t) || saysIn(v, who, t, names, { alone }))
    const parts = partsOf(value)
    if (!found(value) && !(parts.length && parts.every(found))) return false
    return ![value, ...parts].some((v) => latestSaysOtherwise(v, w.soFar ?? '', names))
  }

  for (const r of raw.relies.slice(0, PLAN_MOST.relies)) {
    if (!r.value) continue
    const f0 = fieldOf(r.what)
    // What someone knows is a fact like any other.
    const f = f0 === 'knows' ? null : f0
    // The scene's time and the like, and a thing in the place, belong to no one.
    const scene = !!f && (SCENE_FIELDS.includes(f) || f === 'thing')
    if (f && (scene || r.who)) {
      // A position or the like: the stage's own words, whatever the planner wrote, where the stage still holds.
      const now = nowOf(r.who, f, r.value)
      if (now) {
        if (plainText(now) !== plainText(r.value)) corrected++
        // What someone wears: each piece it names on its own line, or, naming none, the whole of it.
        const named = f === 'wearing' && reaches(f) ? clothesOf(stage(r.who)).filter((x) => namesItem(r.value, x)) : []
        if (named.length) for (const p of named) put(pieceLine(nameOf(r.who), p))
        else put(stageLine(scene ? '' : nameOf(r.who), f, now))
        continue
      }
      // The stage says nothing of it here: what people wear, hold and suffer from the story index, in its own words.
      const known = indexOf(r.who, f)
      if (known.length) {
        const agrees = known.filter((v) => plainText(v) === plainText(r.value) || quoteFound(r.value, v) || quoteFound(v, r.value))
        if (!agrees.length) corrected++
        for (const v of agrees.length ? agrees : known) put(stageLine(nameOf(r.who), f, v))
        continue
      }
      // Otherwise only what the planner was given or looked up, or the words of the scene so far (and, for what people
      // wear, hold and suffer, of the scene before); where people are, how they are placed and the like at a new scene's
      // start only when the scene card says it, never where they were in the scene before.
      const source = reaches(f) || CARRIED.includes(f) || clean(w.soFar) ? w.material : w.card
      if (backed(r.value, r.who, f, source)) put(stageLine(r.who || '', f, r.value))
      else dropped++
      continue
    }
    // A fact: only one in what the planner was given or looked up, or in the words before, and never one kept from
    // someone here.
    if (!backed(r.value, r.who, null, w.material)) {
      dropped++
      continue
    }
    put(r.who && !r.value.toLowerCase().startsWith(r.who.toLowerCase()) ? `${r.who}: ${r.value}` : r.value)
  }

  const callWords = new Set(tokens(w.calls))
  for (const c of raw.changes.slice(0, PLAN_MOST.changes)) {
    if (!c.how && !c.to) continue
    const f = fieldOf(c.what)
    const now = f && (SCENE_FIELDS.includes(f) || f === 'thing' || c.who) ? nowOf(c.who, f, [c.from, c.to, c.how].join(' ')) : ''
    const said = [c.how, c.to].filter(Boolean).join('. ')
    // Only what the change makes new is tested for a secret, never what it carries over (the writer lab's bridge
    // reviews: "to": "the survey case under her arm; the key in her pocket" read as telling "Gale does not know what is
    // in the survey case", so Wren's key into her pocket was dropped from the notes).
    const secretSaid = [c.how, newWordsOf(c.to, `${c.from} ${now}`)].filter(Boolean).join('. ')
    // Someone who could move or dress here (on the card, or on the stage carrying on inside the scene); anyone else only
    // when the card (or the direction) names them.
    const present = onCard(c.who) || (w.reach === 'here' && !!stage(c.who))
    const named = !c.who || present || tokens(c.who).every((t) => callWords.has(t))
    const leave =
      isDead(c.who) ||
      // Already so: nothing to change. Starting from something the stage says isn't so: planned from a wrong picture.
      (!!now && ((!!c.to && alreadySo(c.who, f!, c.to, now)) || (!!c.from && contradicts(c.from, now)))) ||
      // Someone learning what is kept from them, when the scene card doesn't say they do.
      tellsSecret(secretSaid) ||
      // An event (or an injury, someone learning something, or someone not in the scene) the card doesn't call for.
      (!(f && FREE_MOVES.includes(f) && present) && !(named && calledFor(said, w.calls, names))) ||
      strangerIn(said)
    if (leave) {
      dropped++
      continue
    }
    const line = clip(changeLine(c, f, names), LINE_MOST)
    if (line && !changes.some((l) => l.toLowerCase() === line.toLowerCase())) changes.push(line)
  }

  // What it asks for: an entry by its name or other name exactly (a note after it in brackets, or "the" before it,
  // aside), never one the briefing has or Adam kept out.
  const bare = (s: string): string =>
    clean(s)
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/^the\s+/i, '')
      .toLowerCase()
  const byName = new Map<string, EntryState>()
  for (const e of w.entries) {
    if (w.inBriefing.has(e.id) || w.hidden.has(e.id)) continue
    for (const n of [e.name, ...(e.aliases ?? [])]) if (bare(n) && !byName.has(bare(n))) byName.set(bare(n), e)
  }
  for (const n of raw.needs) {
    if (needs.length >= PLAN_MOST.needs) break
    const e = byName.get(bare(n))
    if (e && !needs.includes(e.id)) needs.push(e.id)
  }

  // What must change by the end (the scene's contract, fix 13): only what the card or the author's direction calls for
  // (a third of its words there), never something kept from someone here that the card doesn't bring up.
  const must: string[] = []
  for (const m of raw.must ?? []) {
    if (must.length >= PLAN_MOST.must) break
    const text = clean(m).slice(0, 240)
    if (!text || must.some((x) => x.toLowerCase() === text.toLowerCase())) continue
    if (!calledFor(text, w.calls, names) || tellsSecret(text)) {
      dropped++
      continue
    }
    must.push(text)
  }

  // The scene's shape: the point, the beats and the closing image, never a secret let out or someone the card never
  // brings in; who is where, only for those in the scene and alive; what must stay true, only what it was given.
  const shaped = (text: string | undefined): string => {
    const t = clip(clean(text), LINE_MOST)
    if (!t) return ''
    if (tellsSecret(t) || strangerIn(t)) {
      dropped++
      return ''
    }
    return t
  }
  const listOf = (items: string[] | undefined, most: number, ok: (t: string) => boolean): string[] => {
    const out: string[] = []
    for (const item of items ?? []) {
      if (out.length >= most) break
      const t = clip(clean(item).replace(/^(?:\d+[.)]|[-*•])\s+/, ''), LINE_MOST)
      if (!t || out.some((x) => x.toLowerCase() === t.toLowerCase())) continue
      if (!ok(t)) {
        dropped++
        continue
      }
      out.push(t)
    }
    return out
  }
  const point = { wants: shaped(raw.wants), against: shaped(raw.against), turn: shaped(raw.turn) }
  // A beat of the card already on the page is done: never planned again (the planner is told so, and may still).
  const done = (w.done ?? []).map((d) => meaningWords(d.replace(/^Beat \d+:\s*/, ''), names)).filter((d) => d.size)
  const onPage = (t: string): boolean => {
    const b = meaningWords(t, names)
    return !!b.size && done.some((d) => sharedWords(b, d) >= Math.ceil(Math.min(b.size, d.size) * 0.6))
  }
  const beats = listOf(raw.beats, PLAN_MOST.beats, (t) => !tellsSecret(t) && !strangerIn(t) && !onPage(t))
  const whoWhere = listOf(raw.whoWhere, PLAN_MOST.whoWhere, (t) => {
    const who = /^([^:]+):\s*\S/.exec(t)?.[1] ?? ''
    return !!who && isHere(who) && !isDead(who)
  })
  const mustStay = listOf(raw.mustStay, PLAN_MOST.mustStay, (t) => grounded(t, w.material, names) && !tellsSecret(t))
  return { point, beats, whoWhere, keep, changes, mustStay, closing: shaped(raw.closing), needs, must, checked: { corrected, dropped } }
}

/** How a change line names what changes, by the stage's field ("Wren, holding: …"); knowing is said as learning. */
const CHANGE_LABEL: Partial<Record<Field, string>> = {
  where: 'where',
  wearing: 'wearing',
  posture: 'position',
  touching: 'touching',
  sees: 'sees',
  holding: 'holding',
  condition: 'condition',
  mood: 'mood',
  lastAction: 'doing',
  time: 'time',
  light: 'light',
  weather: 'weather'
}

/**
 * A change as the writer's notes say it, whole in itself (2026-10-19: the notes kept only the planner's "how", so the
 * writer got "She sets it down" with no "it"): who, what about them, how it is now and how it is after, and how it
 * happens when that adds something ("Wren, holding: the key → nothing. She sets it down on the table."). A thing in the
 * place is named once ("the door: unbarred → barred from inside"); someone learning something says what they learn.
 */
export function changeLine(c: RawPlan['changes'][number], f: Field | null = fieldOf(c.what), names: ReadonlySet<string> = new Set()): string {
  const who = clean(c.who)
  let from = clean(c.from).replace(/[.;]+$/, '')
  let to = clean(c.to).replace(/[.;]+$/, '')
  const how = clean(c.how)
  let head = ''
  if (f === 'knows') {
    head = who ? `${who} learns` : 'Learned'
    from = ''
  } else if (f === 'thing') {
    // "the door: unbarred" → "the door: barred from inside": the thing named once, before both.
    const thing = (s: string): string => /^([^:]{1,60}):\s*\S/.exec(s)?.[1]?.trim() ?? ''
    const a = thing(from)
    const b = thing(to)
    const name = a && b ? (a.toLowerCase() === b.toLowerCase() ? a : '') : a || b
    if (name) {
      const off = (s: string): string => (s.toLowerCase().startsWith(`${name.toLowerCase()}:`) ? s.slice(name.length + 1).trim() : s)
      from = off(from)
      to = off(to)
    }
    head = [who, name].filter(Boolean).join(', ')
  } else {
    head = [who, f ? (CHANGE_LABEL[f] ?? '') : ''].filter(Boolean).join(', ')
  }
  const move = from && to ? `${from} → ${to}` : to ? (f === 'knows' ? to : `now ${to}`) : ''
  const said = move ? `${head ? `${head}: ` : ''}${move}` : ''
  // How it happens, when it says more than who, what and how things are before and after.
  const known = new Set(meaningWords([who, from, to, head].join(' '), names))
  const adds = !!how && [...meaningWords(how, names)].some((x) => !known.has(x))
  const line = !said
    ? how
      ? who && !namedInProse(how, who.split(' ')[0])
        ? `${who}: ${ended(how)}`
        : ended(how)
      : ''
    : adds
      ? `${ended(said)} ${ended(how)}`
      : ended(said)
  return line.charAt(0).toUpperCase() + line.slice(1)
}

/** Words that only say which of the stage's fields a value is (the field says it), never what it is. */
const FIELD_WORDS = new Set(['wearing', 'wears', 'wore', 'worn', 'holding', 'holds', 'held', 'carrying', 'carries', 'carried', 'still', 'now', 'has', 'have', 'had', 'is', 'are', 'was', 'were'])
/**
 * The forms of the verbs that most often say how things are placed, each to one word (2026-10-19: "the key drawn out"
 * against "she drew it out"; "lying on the settle" against "she lay down on the settle").
 */
const VERB_FORMS: Record<string, string[]> = {
  draw: ['draws', 'drawing', 'drew', 'drawn'],
  take: ['takes', 'taking', 'took', 'taken'],
  hang: ['hangs', 'hanging', 'hung', 'hanged'],
  lie: ['lies', 'lying', 'lay', 'lays', 'laying', 'laid', 'lain'],
  stand: ['stands', 'standing', 'stood'],
  sit: ['sits', 'sitting', 'sat', 'seated'],
  hold: ['holds', 'holding', 'held'],
  keep: ['keeps', 'keeping', 'kept'],
  throw: ['throws', 'throwing', 'threw', 'thrown'],
  shake: ['shakes', 'shaking', 'shook', 'shaken'],
  break: ['breaks', 'breaking', 'broke', 'broken'],
  tear: ['tears', 'tearing', 'tore', 'torn'],
  bind: ['binds', 'binding', 'bound'],
  hide: ['hides', 'hiding', 'hid', 'hidden'],
  fall: ['falls', 'falling', 'fell', 'fallen'],
  give: ['gives', 'giving', 'gave', 'given'],
  bring: ['brings', 'bringing', 'brought'],
  kneel: ['kneels', 'kneeling', 'knelt'],
  light: ['lights', 'lighting', 'lit', 'lighted'],
  burn: ['burns', 'burning', 'burnt', 'burned'],
  shut: ['shuts', 'shutting'],
  put: ['puts', 'putting'],
  set: ['sets', 'setting']
}
const VERB_OF = new Map(Object.entries(VERB_FORMS).flatMap(([base, forms]) => [base, ...forms].map((f) => [f, base] as const)))
/**
 * A word as compared for what backs a value: a verb's forms as one, else its ending off, its first five letters ("pegs"
 * and "peg", "stables" and "stable").
 */
const root = (w: string): string => (VERB_OF.get(w) ?? (w.length > 4 ? w.replace(/(?:ing|ed|es|s)$/, '') : w.replace(/s$/, ''))).slice(0, 5)
/** The words of a value that say what it is: no filler, no field words, no names of the people in the scene. */
const valueRoots = (s: string, names: ReadonlySet<string>): string[] => [
  ...new Set(
    tokens(s)
      .filter((w) => w.length >= 3 && !FILLER.has(w) && !FIELD_WORDS.has(w) && !names.has(w))
      .map(root)
  )
]
/** A text's sentences (and its lines), in order. */
const sentencesOf = (text: string): string[] =>
  text
    .split(/(?<=[.!?…]["'”’)\]]*)\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)

/** The most sentences of one paragraph a value may be told over ("The boots came hard. … She stood them on their sides …"). */
const PARAGRAPH_SENTENCES = 6

/**
 * Where in `text` a value may be told: each sentence with the one after it, and, for a value of more than one word that
 * matters, a paragraph (or, in a longer one, each run of PARAGRAPH_SENTENCES of its sentences): a scene sets a thing up
 * over a few sentences, with "them" and "it" between (2026-10-19).
 */
function windowsOf(text: string, wide: boolean): string[] {
  const ss = sentencesOf(text)
  const out = ss.map((s, i) => `${s} ${ss[i + 1] ?? ''}`)
  if (!wide) return out
  for (const para of text.split(/\n\s*\n/)) {
    const ps = sentencesOf(para)
    if (ps.length <= 2) continue
    const size = Math.min(PARAGRAPH_SENTENCES, ps.length)
    for (let i = 0; i + size <= ps.length; i++) out.push(ps.slice(i, i + size).join(' '))
  }
  return out
}

/**
 * True when `text` says what a value says, though not in its words exactly (2026-10-19: "boots off, by the hearth" against
 * "She set her boots by the hearth"): within a sentence and the one after it, or a few sentences of one paragraph, every
 * word of it that matters (all but one of five or more), and, for a value of one such word, within a sentence and the
 * next, the person's name or the word saying how it is ("off", "barred"), unless `alone` (the weather, the time or the
 * light: "rain"); never in words that say otherwise of it ("boots on" against "pulled her boots off").
 */
export function saysIn(value: string, who: string, text: string, names: ReadonlySet<string> = new Set(), o: { alone?: boolean } = {}): boolean {
  const v = valueRoots(value, names)
  if (!v.length || !clean(text)) return false
  const need = v.length <= 4 ? v.length : v.length - 1
  const whoRoots = tokens(who)
    .filter((w) => w.length >= 3)
    .map(root)
  const states = tokens(value).filter((w) => STATE_WORDS.has(w))
  for (const win of windowsOf(text, v.length > 1)) {
    const words = tokens(win)
    const have = new Set(words.map(root))
    if (v.filter((x) => have.has(x)).length < need) continue
    if (v.length === 1 && !o.alone && !whoRoots.some((x) => have.has(x)) && !states.some((x) => words.includes(x))) continue
    if (contradicts(value, win)) continue
    return true
  }
  return false
}

/** A value that says two things or more ("stockinged feet; jumper damp at the cuffs"), each on its own; [] for one. */
export function partsOf(value: string): string[] {
  const parts = value
    .split(';')
    .map(clean)
    .filter(Boolean)
  return parts.length > 1 ? parts : []
}

/**
 * True when the latest sentence of the scene so far to speak of what a value is about says otherwise ("boots off, by the
 * hearth", and later "she pulled her boots back on"): the plan would rest on what no longer holds.
 */
export function latestSaysOtherwise(value: string, soFar: string, names: ReadonlySet<string> = new Set()): boolean {
  const v = valueRoots(value, names)
  if (!v.length || !clean(soFar)) return false
  const ss = sentencesOf(soFar)
  for (let i = ss.length - 1; i >= 0; i--) {
    const have = new Set(tokens(ss[i]).map(root))
    const hits = v.filter((x) => have.has(x)).length
    if (!hits) continue
    if (contradicts(value, ss[i])) return true
    if (hits >= Math.min(v.length, 2)) return false
  }
  return false
}

/** True when most of what `text` says (three in five of its words that matter) is in `material`. */
function grounded(text: string, material: string, names: ReadonlySet<string>): boolean {
  const t = meaningWords(text, names)
  if (!t.size) return false
  return sharedWords(t, meaningWords(material, names)) >= Math.max(1, Math.ceil((t.size * 3) / 5))
}

/** What the point-of-view character wants, as the notes say it: the planner's sentence, or with who wants it before it. */
const wantsText = (wants: string, pov?: string): string =>
  !wants ? '' : /\bwants?\b/i.test(wants) ? ended(wants) : `${pov ? `${pov} wants` : 'Wants'}: ${ended(wants)}`

/** A sentence that ends with a full stop (or other end mark). */
const ended = (s: string): string => (/[.!?…]["'”’)\]]*$/.test(s) ? s : `${s}.`)

/** The notes for one beat of a scene planned once (Beat by beat): which beat is being written, of how many. */
export interface BeatAt {
  index: number
  of: number
}

/**
 * The plan as the writer's own notes, leading into the prose; '' when it says nothing. `carryingOn`: the prose carries
 * on from the scene so far. `beat`: the scene is written beat by beat, and this is the one being written now. `reads`:
 * the asks of Adam's direction about how the words read or how long they are, the notes' last line (2026-10-19: the
 * plan carried what happens, and the writer carries on from its notes, but how it should read was left behind).
 */
export function planText(
  p: Partial<ScenePlan> & Pick<ScenePlan, 'keep' | 'changes'>,
  carryingOn: boolean,
  o: { pov?: string; beat?: BeatAt; reads?: string[] } = {}
): string {
  const point = p.point ?? { wants: '', against: '', turn: '' }
  const beats = p.beats ?? []
  const whoWhere = p.whoWhere ?? []
  const mustStay = p.mustStay ?? []
  const closing = clean(p.closing)
  const parts: string[] = []
  const said = [
    wantsText(point.wants, o.pov),
    point.against ? `Against it: ${ended(point.against)}` : '',
    point.turn ? `How it turns: ${ended(point.turn)}` : ''
  ].filter(Boolean)
  if (said.length) parts.push(`${PLAN_PARTS.point} ${said.join(' ')}`)
  if (whoWhere.length) parts.push(`${PLAN_PARTS.where} ${whoWhere.map((l) => l.replace(/[.;]$/, '')).join('; ')}.`)
  if (p.keep.length) parts.push(`${PLAN_PARTS.keep}\n${p.keep.map((l) => `- ${l}`).join('\n')}`)
  if (beats.length) {
    const now = o.beat ? ` (I write only beat ${o.beat.index} of ${o.beat.of} now, and stop at its end)` : ''
    const mark = (i: number): string => (o.beat && beats.length === o.beat.of && i + 1 === o.beat.index ? ' (now)' : '')
    // What must happen first for a beat to be able to happen (preconditions.ts), after it: "2. Mara reads … First Mara must …".
    const first = (i: number, l: string): string => {
      const notes = (p.first ?? []).filter((f) => f.beat === i && clean(f.note)).map((f) => ended(clean(f.note)))
      return notes.length ? `${ended(l)}${mark(i)} ${notes.join(' ')}` : `${l}${mark(i)}`
    }
    parts.push(`${PLAN_PARTS.beats}${now}:\n${beats.map((l, i) => `${i + 1}. ${first(i, l)}`).join('\n')}`)
  }
  if (p.changes.length) {
    parts.push(`${PLAN_PARTS.changes}${o.beat ? ', over the whole scene' : ''}:\n${p.changes.map((l, i) => `${i + 1}. ${l}`).join('\n')}`)
  }
  if (mustStay.length) parts.push(`${PLAN_PARTS.stay}\n${mustStay.map((l) => `- ${l}`).join('\n')}`)
  if (closing && (!o.beat || o.beat.index === o.beat.of)) parts.push(`${PLAN_PARTS.end} ${ended(closing)}`)
  if (!parts.length) return ''
  const reads = (o.reads ?? []).map((r) => clean(r).replace(/[.;]+$/, '')).filter(Boolean)
  if (reads.length) parts.push(`${PLAN_PARTS.reads} ${reads.map(ended).join(' ')}`)
  return [PLAN_HEAD, ...parts, carryingOn ? PLAN_GO.here : PLAN_GO.start].join('\n')
}

/**
 * The plan as Continue is given it (no extra call; the plan made before the scene's draft): where the scene is heading
 * (the point, the beats, what must stay true, the closing image), not how things stood as it started, which the scene
 * so far and where things stand at the cursor say now. `done`: how many of its beats, from the first, are on the page
 * (2026-10-19: Continue was given beats already written as still to come): each marked done, the next marked "next";
 * with all of them done, the plan is complete, and Continue carries on towards the card's `outcome` and the closing
 * image. '' when it says nothing of that.
 */
export function planForContinue(p: Partial<ScenePlan>, pov?: string, o: { done?: number; outcome?: string } = {}): string {
  const point = p.point ?? { wants: '', against: '', turn: '' }
  const said = [
    wantsText(point.wants, pov),
    point.against ? `Against it: ${ended(point.against)}` : '',
    point.turn ? `How it turns: ${ended(point.turn)}` : ''
  ].filter(Boolean)
  const beats = p.beats ?? []
  const done = Math.max(0, Math.min(beats.length, o.done ?? 0))
  const mark = (i: number): string => (i < done ? ` ${CONTINUE_MARKS.done}` : i === done ? ` ${CONTINUE_MARKS.next}` : '')
  const closing = clean(p.closing)
  const outcome = clean(o.outcome)
  const complete =
    beats.length && done >= beats.length
      ? `Every beat of the plan is on the page: the plan is complete. Add no new beats of your own: carry on towards ${
          outcome ? `the scene card's outcome (${outcome.replace(/[.]$/, '')})` : 'the end of the scene'
        }${closing ? ` and the image it ends on (${closing.replace(/[.]$/, '')})` : ''}.`
      : ''
  const parts = [
    said.length ? `${PLAN_PARTS.point} ${said.join(' ')}` : '',
    beats.length ? `${PLAN_PARTS.beats}:\n${beats.map((l, i) => `${i + 1}. ${l}${mark(i)}`).join('\n')}` : '',
    complete,
    p.mustStay?.length ? `${PLAN_PARTS.stay}\n${p.mustStay.map((l) => `- ${l}`).join('\n')}` : '',
    closing ? `${PLAN_PARTS.end} ${ended(closing)}` : ''
  ].filter(Boolean)
  if (!parts.length) return ''
  return ['The plan made for this scene before it was drafted. Carry on towards it from where the words are now; what is on the page already has happened.', ...parts].join('\n')
}

/**
 * What the planner looked up, for the writer beside the plan: the facts (as things stand, who knows what, what happened)
 * and a few passages word for word; short, the facts alone. '' when it found nothing worth passing on.
 */
export function lookedUpText(answers: readonly LookupAnswer[], short = false): string {
  const facts: string[] = []
  for (const a of answers) for (const f of a.facts) if (!facts.includes(f)) facts.push(f)
  // Each passage once (2026-10-19): one read twice (a search and a read of the same scene) goes in the first time only.
  const seen = new Set<string>()
  const passages = short
    ? []
    : answers
        .flatMap((a) => a.passages)
        .filter((p) => {
          const runs = wordRuns(p.text)
          if (runs.size && coveredShare(runs, seen) >= REPEAT_SHARE) return false
          for (const r of runs) seen.add(r)
          return true
        })
        .slice(0, LOOKED_UP_MOST.passages)
  const parts = [
    facts.length ? facts.slice(0, LOOKED_UP_MOST.facts).map((l) => `- ${l}`).join('\n') : '',
    ...passages.map((p) => {
      const w = p.text.trim().split(/\s+/)
      return `### ${p.where}\n${w.length > PASSAGE_WORDS.short ? `${w.slice(0, PASSAGE_WORDS.short).join(' ')} …` : p.text.trim()}`
    })
  ].filter(Boolean)
  return parts.length ? [LOOKED_UP_LEAD, ...parts].join('\n\n') : ''
}

/** The most the writer is given of what was looked up. */
export const LOOKED_UP_MOST = { facts: 14, passages: 2 }
export const LOOKED_UP_LEAD = 'Looked up from the story so far just before writing, as things stand at this scene:'

/**
 * True when the briefing with the plan (and what it asked for) loses nothing the briefing without it had room for:
 * every part sent before is still sent, none of it shorter (but the scenes before word for word, sent only in room to
 * spare), the reply's room is the same, and it still fits (or didn't fit before either). Not enough room means no plan.
 */
export function keepsRoom(before: Pick<ContextPreview, 'blocks' | 'budget'>, after: Pick<ContextPreview, 'blocks' | 'budget'>): boolean {
  const now = new Map(after.blocks.map((x) => [x.id, x]))
  // The parts the continuity brief (fix 14) says what matters of go short beside it, on purpose: only that short.
  const forBrief = new Set(after.blocks.some((x) => x.id === BRIEF_BLOCK.id && !x.dropped) ? after.blocks.filter((x) => x.shortFor === 'brief').map((x) => x.id) : [])
  for (const x of before.blocks) {
    // The scenes before word for word go only in room to spare: the plan may have that room (2026-10-15). The scene's
    // contract (fix 13) is the plan's to change: what it says must change takes the place of the card's own words. What
    // was left in this place is read again with the plan, with the story index brought up to date (place memory).
    if (x.dropped || x.id === EARLIER_BLOCK.id || x.id === CONTRACT_BLOCK.id || x.id === LEFT_HERE_BLOCK.id || forBrief.has(x.id)) continue
    const y = now.get(x.id)
    if (!y || y.dropped || y.tokens < x.tokens) return false
  }
  if (after.budget.reserved < before.budget.reserved) return false
  return after.budget.used <= after.budget.available || before.budget.used > before.budget.available
}

// ---------- The call ----------

export interface PlanCall {
  db: DB
  model: MemoryModel
  sceneId: ID
  material: PlanMaterial
  check: Pick<CheckWith, 'stand' | 'entries' | 'inBriefing' | 'hidden' | 'known' | 'present'>
  /** The writing carries on from words already in the scene (Add below, a later beat). */
  carryingOn: boolean
  /** The look-ups the planner may make, one round, answered here (ai/lookups/); left out: none offered. */
  lookups?: LookupContext
  /** For Beat by beat's notes: the beat being written now. */
  beat?: BeatAt
  /** Adam stopped the draft before it began. */
  signal?: AbortSignal
  /** True once the world has closed. */
  closed: () => boolean
  limitMs?: number
  fetchImpl?: typeof fetch
  retryDelays?: number[]
  /**
   * Can each planned beat happen (plan/preconditions.ts, no AI call)? Asked of the checked plan: what must happen first goes
   * in the writer's notes (ScenePlan.first), and what can't be put right is noted for Adam on the plan's record (What the
   * AI saw, "Steps it took"). Left out: not checked.
   */
  preconditions?: (plan: ScenePlan) => CanHappen
}

export interface MadePlan {
  needs: ID[]
  /** The writer's notes; '' when the plan only asked for entries. */
  text: string
  /** What must change by the end, for the scene's contract (fix 13); empty without a contract. */
  must: string[]
  checked: ScenePlan['checked']
  /** The continuity brief for the writer (fix 14), checked (brief.ts checkBrief); left out when none was asked for or kept. */
  brief?: ContinuityBrief
  /** The plan itself, checked, for writing its notes again (a later beat, Continue). */
  plan?: ScenePlan
  /** What the planner looked up that the writer gets beside the plan (lookedUpText); '' or left out: nothing. */
  lookedUp?: string
  /** Beats that can't happen as planned, as Adam is told on the plan's record (preconditions.ts); left out: none. */
  flags?: string[]
  /**
   * What was left in the scene's place on an earlier visit ("Left here before: …", plan/core.ts), read with the story index
   * just brought up to date, for the writer's briefing (ContextInput.leftHere), in place of the briefing's own reading
   * (empty: nothing is left there now). Left out: not read (no core).
   */
  leftHere?: string[]
  /**
   * The writer's notes for this plan made again from a plan Adam changed (plan-first, plan/review.ts), with the same point of
   * view, the same stretch or beat and the same asks of how it reads. Left out: planText as a whole scene.
   */
  writeAgain?: (plan: ScenePlan) => string
}

/** The step on the plan's record that says what the card check found (plan/cardCheck.ts; What the AI saw, "Steps it took"). */
export const CARD_CHECK_LABEL = 'The scene card against the story so far (checked on this computer, no AI)'

/** The step on the plan's record that says what the check of each beat found (What the AI saw, "Steps it took"). */
export const BEATS_CHECK_LABEL = 'Can each beat happen? (checked on this computer, no AI)'

/** What the check of each beat found, for the plan's record: what was added to the writer's notes, and what Adam should see. */
export function beatsCheckText(can: CanHappen, beats: readonly string[]): string {
  const added = can.notes.map((n) => `- Beat ${n.beat + 1}${beats[n.beat] ? ` (“${clip(beats[n.beat], 80)}”)` : ''}: ${n.note}`)
  return [
    added.length ? ['Added to the writer’s plan:', ...added].join('\n') : '',
    can.flags.length ? ['For you to look at (the plan was left as it is):', ...can.flags.map((f) => `- ${f}`)].join('\n') : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Checks the plan's beats can happen (o.preconditions), notes what must come first in the plan, and keeps what it found on the record. */
function beatsChecked(o: PlanCall, plan: ScenePlan, generationId: ID): CanHappen | null {
  if (!o.preconditions || !plan.beats.length) return null
  try {
    const can = o.preconditions(plan)
    if (can.notes.length) plan.first = can.notes
    if ((can.notes.length || can.flags.length) && o.db.open && !o.closed()) {
      gens.addSteps(o.db, generationId, [{ label: BEATS_CHECK_LABEL, tool: 'check', arguments: '', result: beatsCheckText(can, plan.beats) }])
    }
    return can
  } catch (e) {
    console.warn('Could not check the plan’s beats can happen', e)
    return null
  }
}

/** Keeps what the card check found (cardCheck.ts) on the plan's record, as a step Adam can read in What the AI saw. */
function cardChecked(o: Pick<PlanCall, 'db' | 'closed'>, m: PlanMaterial, generationId: ID): void {
  const notes = m.core?.notes ?? []
  if (!notes.length) return
  try {
    if (o.db.open && !o.closed()) {
      gens.addSteps(o.db, generationId, [{ label: CARD_CHECK_LABEL, tool: 'check', arguments: '', result: notes.map((n) => `- ${n}`).join('\n') }])
    }
  } catch (e) {
    console.warn('Could not keep what the card check found', e)
  }
}

/** Nothing happens when the plan's call is told of its progress: no window is listening. */
const quiet = (): void => undefined

/**
 * Plans the scene with the memory model (as a 'memory' record, so "What the AI saw" shows what it was asked and what it
 * looked up; only the scene's newest KEEP_PLAN_PROMPTS keep their whole prompt), with one round of look-ups when it may
 * make them, and checks the plan. Null when there is nothing to go on: the call failed, was stopped, took longer than
 * `limitMs` (it is then stopped too), or said nothing usable. Never throws.
 */
export async function makePlan(o: PlanCall): Promise<MadePlan | null> {
  if (o.signal?.aborted || o.closed()) return null
  const m: PlanMaterial = { ...o.material, ...(o.lookups ? { lookups: true } : {}) }
  // A plan with a continuity brief (fix 14) reads and writes more: it may take longer.
  const limit = o.limitMs ?? (m.brief ? BRIEF_LIMIT_MS : PLAN_LIMIT_MS)
  const taskId = `plan-${newId()}`
  let timer: ReturnType<typeof setTimeout> | undefined
  let late: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const stop = (): void => {
    stopped = true
    void stopTask(taskId).catch(() => undefined)
  }
  o.signal?.addEventListener('abort', stop, { once: true })
  const answers: LookupAnswer[] = []
  try {
    const messages = planMessages(m)
    const user = messages[1].content
    // The record in the world keeps the scene before and the scene so far as notes: they are the scenes' own words, and
    // the scene's newest planning calls each keep their prompt.
    const kept = [...(m.brief?.record ?? []), ...(m.brief?.late ?? [])].some((p) => p.scene) ? planMessages(m, false) : null
    const lookups = o.lookups
    const call = runTask({
      db: o.db,
      taskId,
      job: 'memory',
      sceneId: o.sceneId,
      model: { job: 'memory', target: o.model.target, choice: o.model.choice, thinking: o.model.thinking ?? 'off' },
      messages,
      ...(kept ? { kept } : {}),
      reply: PLAN_REPLY_TOKENS + (m.brief ? Math.ceil(m.brief.tokens * BRIEF_REPLY_SHARE) : 0),
      temperature: MEMORY_TEMPERATURE,
      topP: 1,
      blocks: [
        {
          id: 'plan',
          title: m.brief ? 'Planning the scene and writing its continuity brief' : 'Planning the scene',
          text: (kept ?? messages)[1].content,
          tokens: estimateTokens(user),
          priority: 1,
          dropped: false,
          entryIds: []
        }
      ],
      emit: quiet,
      ...(lookups
        ? {
            agent: {
              tools: LOOKUP_TOOLS,
              // One round: the look-ups, then the plan. The answering request keeps the tools listed, none to be called
              // (tool_choice 'none'), so it starts as the first did and a provider's cache keeps all of it (2026-10-19).
              maxSteps: 2,
              lastKeepsTools: true,
              run: async (calls) => {
                const r = await answerLookups(calls, lookups)
                answers.push(...r.answers)
                return { results: r.results, steps: r.steps }
              },
              lastWords: () => planAsk(m, true),
              // Words written before the look-ups (thinking aloud) are never part of the plan.
              dropBeforeTools: () => true
            }
          }
        : {}),
      fetchImpl: o.fetchImpl,
      retryDelays: o.retryDelays
    })
    timer = setTimeout(stop, limit)
    // Stopping the call ends it at once; this is only in case something doesn't hear the stop.
    const gaveUp = new Promise<null>((resolve) => {
      late = setTimeout(() => resolve(null), limit + 2_000)
    })
    const got = await Promise.race([call, gaveUp])
    forgetOld(o)
    if (!got || stopped || o.closed()) return null
    // What the card check found before planning (cardCheck.ts), on the plan's record for Adam (What the AI saw).
    cardChecked(o, m, got.generationId)
    // Turned down in so many words: no plan, and the top bar is told the draft went without one (as for any memory job).
    if (got.status === 'complete' && looksLikeRefusalReply(got.text)) {
      noteRefused(o)
      return null
    }
    if (got.status !== 'complete') return null
    const raw = readPlan(got.text)
    if (!raw) return null
    // A fact is taken from what the planner was given or looked up, but never from where things stood in a scene before
    // that no longer holds here. Only the plan's own parts count: never the record read for the brief (a scene long ago
    // may say what no longer holds).
    const own: PlanMaterial = { ...m, brief: undefined }
    const given = m.reach === 'here' ? planMessages(own)[1].content : planMessages({ ...own, stand: '' })[1].content
    const material = [given, ...answers.filter((a) => a.ok).map((a) => a.text)].join('\n\n')
    const plan = checkPlan(raw, {
      ...o.check,
      reach: m.reach,
      material,
      card: m.card,
      calls: m.calls,
      people: m.people,
      secrets: m.secrets,
      ...(m.done?.length ? { done: m.done } : {}),
      ...(m.page?.soFar ? { soFar: m.page.soFar } : {}),
      ...(m.page?.previous ? { previous: m.page.previous } : {})
    })
    // What it looked up by name comes into the briefing, as what it asked for does.
    for (const a of answers) {
      if (!a.entryId || plan.needs.length >= PLAN_MOST.needs || plan.needs.includes(a.entryId)) continue
      if (!o.check.inBriefing.has(a.entryId) && !o.check.hidden.has(a.entryId)) plan.needs.push(a.entryId)
    }
    // Can each planned beat happen? What must come first goes in the notes; what can't be put right, on the record.
    const can = beatsChecked(o, plan, got.generationId)
    const notesOf = (p: ScenePlan): string =>
      planText(p, o.carryingOn, {
        ...(m.pov ? { pov: m.pov } : {}),
        ...(o.beat ? { beat: o.beat } : {}),
        ...(m.reads?.length ? { reads: m.reads } : {})
      })
    const text = notesOf(plan)
    const must = m.contract ? plan.must : []
    // The brief cites only chapters and scenes the planner was given (all of it, the chapters in short too) or looked up,
    // and never names what Adam kept out of the scene's briefing.
    const brief =
      m.brief && raw.brief
        ? checkBrief(raw.brief, {
            material: [user, ...answers.filter((a) => a.ok).map((a) => a.text)].join('\n\n'),
            tokens: m.brief.tokens,
            ...(m.brief.tokensNoKnows != null ? { tokensNoKnows: m.brief.tokensNoKnows } : {}),
            hidden: m.brief.hidden ?? []
          }).brief
        : null
    if (!text && !plan.needs.length && !must.length && !brief) return null
    const lookedUp = lookedUpText(answers.filter((a) => a.ok))
    return {
      needs: plan.needs,
      text,
      must,
      checked: plan.checked,
      ...(brief ? { brief } : {}),
      plan,
      ...(lookedUp ? { lookedUp } : {}),
      ...(can?.flags.length ? { flags: can.flags } : {}),
      writeAgain: notesOf
    }
  } catch (e) {
    console.warn('Could not plan the scene; writing without a plan', e)
    return null
  } finally {
    clearTimeout(timer)
    clearTimeout(late)
    o.signal?.removeEventListener('abort', stop)
  }
}

/** The memory model turned the plan down: noted for the top bar's lasting note, as callModel does for every memory job. */
function noteRefused(o: Pick<PlanCall, 'db' | 'model' | 'sceneId' | 'closed'>): void {
  try {
    if (o.db.open && !o.closed()) noteRefusal(o.db, { task: 'plan', model: 'memory', modelKey: modelKeyOf(o.model), sceneId: o.sceneId })
  } catch (e) {
    console.warn('Could not note the plan was turned down', e)
  }
}

/** Only the scene's newest few planning calls keep their whole prompt. */
function forgetOld(o: Pick<PlanCall, 'db' | 'sceneId' | 'closed'>): void {
  try {
    if (o.db.open && !o.closed()) gens.forgetOldPrompts(o.db, o.sceneId, PLAN_MARKER, KEEP_PLAN_PROMPTS)
  } catch (e) {
    console.warn('Could not let go of older planning prompts', e)
  }
}
