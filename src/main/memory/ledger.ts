// The who-knows-what ledger (long story memory fix 9). For each character, as of a point on the line: the facts they
// know, since which scene and how they learned them (saw it, heard it from someone, overheard it, read it, guessed it,
// said it themselves), and what they believe that isn't true. It is worked out from the memory's knowledge changes by
// state.ts, with the rest of what is true at a point, so it is scene-scoped as every fact is: a draft or a check of an
// earlier scene sees only what was known by then. No new store and no new AI call: the memory keeper's reading reply says
// how, from whom and whether a belief is wrong (keeper/prompts.ts); older knowledge says what `said` and `seen` can.
//
// `Ledger` answers "could character C know fact F at this point?" in one look-up, for the briefing (ai/whoKnows.ts), the
// checks (checks/context.ts, repair/prompts.ts) and the rule-based checks (fix 8, checks/rules.ts): build it once per
// scene from the scene's memory (`ledgerOf(sceneMemory(...))`, or `ledgerForScene` in memory/scene.ts), then ask as
// often as needed.
// Pure.

import type { BeliefState, FactState, ID, KnowledgePayload, Learned } from '@shared/types'

/**
 * How a learning came about: what the words said (`how`, and `from` for being told or overhearing), else what was said
 * (the speaker said it; anyone else heard it from the speaker), else an event seen happening.
 */
export function learnedHow(entryId: ID, p: Pick<KnowledgePayload, 'how' | 'from' | 'said' | 'seen'>): Pick<Learned, 'how' | 'from'> {
  const from = p.from && p.from !== entryId ? p.from : undefined
  if (p.how) return { how: p.how, ...(from && (p.how === 'told' || p.how === 'overheard') ? { from } : {}) }
  if (p.said?.by) return p.said.by === entryId ? { how: 'said' } : { how: 'told', from: p.said.by }
  if (p.seen) return { how: 'saw' }
  if (from) return { how: 'told', from }
  return {}
}

/** What the ledger is read from: a point's facts (true knowledge) and beliefs (SceneMemory, MemoryState, EntryAsOf). */
export interface LedgerSource {
  facts: readonly FactState[]
  beliefs?: readonly BeliefState[]
}

/** One thing a character knows or believes, with since when and how (null when not recorded: memory kept before). */
export interface Knowing {
  factId: ID
  fact: string
  since: Learned | null
}

/** Whether a character could know a fact at a point (Ledger.couldKnow). */
export interface CouldKnow {
  /** They know it here. */
  knows: boolean
  /** They believe it here, though it isn't true. */
  believesWrongly: boolean
  /** Since when and how, when they know or believe it (null when not recorded). */
  since: Learned | null
}

/** The ledger at one point, indexed so each question is one look-up. */
export class Ledger {
  private readonly known = new Map<ID, Map<ID, Knowing>>()
  private readonly believed = new Map<ID, Map<ID, Knowing>>()
  private readonly knowers = new Map<ID, ID[]>()

  constructor(src: LedgerSource) {
    for (const f of src.facts) {
      this.knowers.set(f.factId, [...f.knownBy])
      for (const id of f.knownBy) put(this.known, id, { factId: f.factId, fact: f.fact, since: f.since?.[id] ?? null })
    }
    for (const b of src.beliefs ?? []) for (const id of b.believedBy) put(this.believed, id, { factId: b.factId, fact: b.fact, since: b.since[id] ?? null })
  }

  /** What a character knows here, in the memory's order. */
  knows(entryId: ID): Knowing[] {
    return [...(this.known.get(entryId)?.values() ?? [])]
  }

  /** What a character believes here that isn't true, in the memory's order. */
  believes(entryId: ID): Knowing[] {
    return [...(this.believed.get(entryId)?.values() ?? [])]
  }

  /** Could character C know fact F here? Knows it (since when, how), believes it wrongly, or neither. */
  couldKnow(entryId: ID, factId: ID): CouldKnow {
    const k = this.known.get(entryId)?.get(factId)
    if (k) return { knows: true, believesWrongly: false, since: k.since }
    const b = this.believed.get(entryId)?.get(factId)
    return { knows: false, believesWrongly: !!b, since: b?.since ?? null }
  }

  /** Who knows a fact here. */
  whoKnows(factId: ID): ID[] {
    return this.knowers.get(factId) ?? []
  }
}

function put(map: Map<ID, Map<ID, Knowing>>, entryId: ID, k: Knowing): void {
  let m = map.get(entryId)
  if (!m) map.set(entryId, (m = new Map()))
  m.set(k.factId, k)
}

/** The ledger at a point. */
export const ledgerOf = (src: LedgerSource): Ledger => new Ledger(src)
