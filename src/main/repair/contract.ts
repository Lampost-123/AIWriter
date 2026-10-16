// The check of new words against the scene's contract (long story memory fix 13, ai/contract.ts), in the call check and
// repair already makes as the words land (repair/index.ts): the contract's items go in as C lines, and the model answers
// each one, kept, broken, not yet or untouched, with the sentence that shows it. The app then keeps only what it can
// stand behind:
//   - broken: only with words that are really in the new words; it goes on as a slip against its C line, through the
//     second opinion and the usual judging (repair/claims.ts). A C line is never on the stage, so it is never mended
//     without asking: it is one question, with the model's rewrite of that sentence to review (Fix the text);
//   - not yet: only for something that must change, never for Continue (a paragraph or two that plays out what is under
//     way), and not when most of its words are in the new words after all; asked as a question with no words to point
//     at ("…doesn't show it: …. Write it in, or leave it for later?");
//   - anything else (kept, untouched, or not answered) raises nothing.
// What came of each item is kept with the scene's check report (checks/report.ts saveContractCheck). The chapter writer's
// checks of a whole scene go through the contract the same way (checks/run.ts, CHECK_CONTRACT_RULES). Pure.

import type { ContractCheckItem, ContractResult, IssueSource } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import { contractText, mostlyIn, type ContractItem, type SceneContract } from '../ai/contract'
import type { FoundIssue } from '../db/checks'
import { KIND_OF_CHECK, plainQuote } from '../checks/quote'
import { parseLenient, str } from '../keeper/json'
import type { Claim } from './claims'
import type { CodexLine } from './prompts'
import { quotedIn } from './second'

/** The model's answer for one item. */
export interface ContractAnswer {
  item: string
  result: Exclude<ContractResult, 'unchecked'>
  quote: string
  why: string
  fix: { replace: string; with: string } | null
  /** The quote rewritten whole, as the consistency checks give a fix (checks/run.ts); '' when not given. */
  rewrite: string
  question: string
}

export const CONTRACT_SECTION = { id: 'contract', title: 'The scene’s contract (C ids)' } as const

/** The contract as C lines for the check, and its section of the request. */
export function contractSection(c: SceneContract): { lines: CodexLine[]; section: { id: string; title: string; text: string; entryIds: ID[] } } {
  return {
    lines: c.items.map((i) => ({ code: i.code, kind: 'contract' as const, label: i.text, ...(i.entryIds[0] ? { entryId: i.entryIds[0] } : {}) })),
    section: { id: CONTRACT_SECTION.id, title: CONTRACT_SECTION.title, text: contractText(c, { codes: true }), entryIds: [] }
  }
}

/** What the check is told about the contract, after its own instructions: the same every time (the cache). */
export const CONTRACT_RULES = `The scene's contract
- Under "The scene's contract" are the checks the new words were written to, each with an id (C1...): what must be true where they start, what must change, and what must not change. Answer every one in "contract", in order, with one of:
  - "kept": the new words keep it, or show it happening. "quote": the sentence that shows it, copied exactly from the new words.
  - "broken": the new words go against it. "quote": the words that break it, copied exactly from the new words.
  - "not yet": something that must change that the new words don't show happening. "quote": "".
  - "untouched": the new words have nothing to do with it. "quote": "".
- Judge what happens, not the wording: something that must change may happen in other words than the list's.
- For "broken": "why", one plain sentence for the author with names and no ids; "fix" only when changing a few words of that sentence puts it right ({"replace": the fewest words, copied exactly, "with": the change}); otherwise "question", one short question for the author with the choices in it. A broken item is not listed again as a claim.
With the contract, reply with {"claims": [...], "contract": [{"item": "C1", "result": "kept|broken|not yet|untouched", "quote": "", "why": "", "fix": {"replace": "", "with": ""}, "question": ""}]}.`

/** The same for the consistency checks of a whole scene (the chapter writer's, checks/run.ts). */
export const CHECK_CONTRACT_RULES = `The scene's contract
- Under "The scene's contract" are the checks this scene was written to, each with an id (C1...): what must be true at the start, what must change by the end, and what must not change. Answer every one in "contract", in order, with one of:
  - "kept": the scene keeps it, or shows it happening. "quote": the sentence that shows it, copied exactly from the scene.
  - "broken": the scene goes against it. "quote": the words that break it, copied exactly from the scene.
  - "not yet": something that must change that the scene doesn't show happening. "quote": "".
  - "untouched": the scene has nothing to do with it. "quote": "".
- Judge what happens, not the wording: something that must change may happen in other words than the list's. When the scene is given in parts, answer for this part.
- For "broken": "why", one plain sentence for the author with names and no ids; "fix": the quote rewritten so it keeps to the contract, changing as few words as possible, when that can put it right. A broken item is not listed again under "issues".
Add to the reply: "contract": [{"item": "C1", "result": "kept|broken|not yet|untouched", "quote": "", "why": "", "fix": ""}]`

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A result as the model may write it. */
function resultOf(v: unknown): ContractAnswer['result'] | null {
  const s = str(v, 30).toLowerCase().replace(/[^a-z]/g, '')
  if (/^(kept|keeps|pass|passed|done|shown|yes|ok)$/.test(s)) return 'kept'
  if (/^(broken|broke|fail|failed|breaks|slip|no)$/.test(s)) return 'broken'
  if (/^(notyet|missing|notshown|notdone|absent)$/.test(s)) return 'not yet'
  if (/^(untouched|na|notapplicable|none|unrelated|nottouched)$/.test(s)) return 'untouched'
  return null
}

/** The answers in a reply's "contract" list (the first for each item); none when it has none or can't be read. */
export function readContractAnswers(reply: string): ContractAnswer[] {
  const parsed = parseLenient(reply)
  if (!parsed.ok || !isObj(parsed.value)) return []
  const list = parsed.value.contract
  if (!Array.isArray(list)) return []
  const out: ContractAnswer[] = []
  for (const a of list.filter(isObj)) {
    const item = str(a.item ?? a.id ?? a.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, '')
    const result = resultOf(a.result ?? a.verdict)
    if (!/^C\d+$/.test(item) || !result || out.some((x) => x.item === item)) continue
    const fix = isObj(a.fix) && typeof a.fix.replace === 'string' && a.fix.replace.trim() ? { replace: a.fix.replace, with: typeof a.fix.with === 'string' ? a.fix.with : '' } : null
    const rewrite = typeof a.fix === 'string' ? a.fix.trim().slice(0, 600) : ''
    out.push({ item, result, quote: typeof a.quote === 'string' ? a.quote.trim().slice(0, 600) : '', why: str(a.why, 400), fix, rewrite, question: str(a.question, 400) })
  }
  return out
}

/**
 * The answers of a check given in parts (a long scene), one for each item: broken in any part (with its words) before
 * kept in any part, before not yet, before untouched.
 */
export function mergeAnswers(parts: ContractAnswer[][]): ContractAnswer[] {
  const rank: Record<ContractAnswer['result'], number> = { broken: 0, kept: 1, 'not yet': 2, untouched: 3 }
  const best = new Map<string, ContractAnswer>()
  for (const a of parts.flat()) {
    const was = best.get(a.item)
    if (a.result === 'broken' && !a.quote) continue
    if (!was || rank[a.result] < rank[was.result]) best.set(a.item, a)
  }
  return [...best.values()]
}

export interface JudgedContract {
  /** Broken items with words that are in the new words, as slips against their C lines (judged with the rest). */
  broken: Claim[]
  /** Things that must change that the new words don't show yet: each asked about. */
  notYet: ContractItem[]
  /** What the model said of each item, by its code. */
  said: Map<string, ContractAnswer>
}

/** Judges the model's answers (see the top of this file). */
export function judgeContract(answers: ContractAnswer[], c: SceneContract, newWords: string): JudgedContract {
  const said = new Map(answers.map((a) => [a.item, a] as const))
  const out: JudgedContract = { broken: [], notYet: [], said }
  for (const item of c.items) {
    const a = said.get(item.code)
    if (!a) continue
    if (a.result === 'broken' && a.quote && quotedIn(newWords, a.quote)) {
      out.broken.push({
        quote: a.quote,
        who: '',
        about: 'other',
        line: item.code,
        verdict: 'slip',
        bothTrue: 'no',
        between: 'unclear',
        why: a.why,
        fix: a.fix,
        question: a.question
      })
    } else if (a.result === 'not yet' && item.part === 'change' && c.asks !== 'continue' && !mostlyIn(item.text, newWords)) {
      out.notYet.push(item)
    }
  }
  return out
}

/** The codex entries an item is about, as an issue's links (those that exist here, with their names). */
export function contractSources(entryIds: ID[], names: ReadonlyMap<ID, string>): IssueSource[] {
  return entryIds.flatMap((id) => (names.has(id) ? [{ kind: 'entry' as const, entryId: id, name: names.get(id)!, field: null }] : []))
}

/** Something the contract says must change that the words don't show yet, as a question with no words to point at. */
export function notYetIssue(
  where: { sceneId: ID; storyId: ID; names: ReadonlyMap<ID, string> },
  item: ContractItem,
  asks: SceneContract['asks']
): FoundIssue {
  return {
    sceneId: where.sceneId,
    storyId: where.storyId,
    kind: KIND_OF_CHECK[item.check],
    severity: 'warning',
    quote: '',
    message: notYetMessage(item.text, asks),
    key: `contract:change:${plainQuote(item.text)}`,
    payload: {
      by: 'check',
      check: item.check,
      sources: contractSources(item.entryIds, where.names),
      fix: null,
      memoryFix: null,
      // Never written in by itself, not even by the chapter writer (fix 13's review): it is Adam's to decide.
      contract: { part: item.part, text: item.text, missing: true }
    }
  }
}

/** What is asked when something that must change isn't in the new words. */
export function notYetMessage(text: string, asks: SceneContract['asks']): string {
  const what = asks === 'scene' ? 'This scene was planned' : asks === 'beat' ? 'This beat was planned' : 'These words were asked'
  const said = text.trim().replace(/[.!?]?$/, '.')
  return `${what} to show this, but the new words don’t yet: “${said}” Write it in, or leave it for later?`
}

/**
 * How each item came out, for the check report: broken when a question was raised for it (after the second opinion and
 * the judging), not yet when one was asked, kept when the second opinion found it shown after all (`shown`), else what
 * the model said (a broken item not stood behind is untouched), or unchecked when it said nothing.
 */
export function contractResults(
  c: SceneContract,
  j: JudgedContract,
  asked: { broken: ReadonlySet<string>; notYet: ReadonlySet<string>; shown?: ReadonlySet<string> }
): ContractCheckItem[] {
  return c.items.map((i) => {
    const a = j.said.get(i.code)
    const result: ContractResult = asked.broken.has(i.code)
      ? 'broken'
      : asked.notYet.has(i.code)
        ? 'not yet'
        : asked.shown?.has(i.code)
          ? 'kept'
          : !a
            ? 'unchecked'
            : a.result === 'kept'
              ? 'kept'
              : 'untouched'
    const quote = (result === 'kept' || result === 'broken') && a?.quote ? a.quote : ''
    return { part: i.part, text: i.text, result, ...(quote ? { quote } : {}) }
  })
}

/** The counts the page is told (RepairOutcome.contract). */
export const contractCounts = (items: ContractCheckItem[]): { items: number; kept: number; broken: number; notYet: number } => ({
  items: items.length,
  kept: items.filter((i) => i.result === 'kept').length,
  broken: items.filter((i) => i.result === 'broken').length,
  notYet: items.filter((i) => i.result === 'not yet').length
})
