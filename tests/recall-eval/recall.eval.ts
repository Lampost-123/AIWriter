// The offline recall measure (recallEval.ts says what it measures): keyword search alone, then with the search model
// when AIWRITE_TEST_SEARCH_MODEL points at its files (a folder with vocab.txt and onnx/model.onnx, as the app downloads
// them), each without and with the summaries searched; and, when AIWRITE_TEST_RERANKER points at the cross-encoder's
// files, the re-ranker experiment (reranker.ts). No AI call, no download, never part of npm test:
//
//   npx vitest run --config tests/recall-eval/vitest.config.ts
//
// AIWRITE_RECALL_EVAL_STORIES=book,v3 picks the stories, AIWRITE_RECALL_EVAL_ONLY a list of the runs by name,
// AIWRITE_RECALL_EVAL_OUT a file for every fact's ranks as JSON, AIWRITE_RECALL_EVAL_STATUS a file it adds a line to as
// each probe is searched (item N of M), for watching a long run. Prints a table.
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import type { Embedder } from '../../src/main/retrieval/types'
import { Vectors } from '../../src/main/retrieval/vectors'
import { bookStory, evaluate, realEmbedder, score, v3Story, type EvalOptions, type EvalStory, type FactResult } from './recallEval'
import { crossEncoder, reranker, type RerankQuery } from './reranker'

const MODEL = process.env.AIWRITE_TEST_SEARCH_MODEL ?? ''
const haveModel = !!MODEL && existsSync(join(MODEL, 'onnx', 'model.onnx'))
const STORIES = (process.env.AIWRITE_RECALL_EVAL_STORIES ?? 'book,v3').split(',')
const STATUS = process.env.AIWRITE_RECALL_EVAL_STATUS
/** The re-ranker experiment (reranker.ts): its files' folder, and which ways to make its query (all three by default). */
const RERANKER = process.env.AIWRITE_TEST_RERANKER ?? ''
const haveReranker = !!RERANKER && existsSync(join(RERANKER, 'onnx', 'model_quint8_avx2.onnx'))
const RERANK_HOW = (process.env.AIWRITE_RECALL_EVAL_RERANK ?? 'joined,best part,direction').split(',') as RerankQuery[]
const ONLY = process.env.AIWRITE_RECALL_EVAL_ONLY ? process.env.AIWRITE_RECALL_EVAL_ONLY.split(',') : null

const pct = (x: number): string => `${(x * 100).toFixed(0).padStart(3)}%`

const status = (line: string): void => {
  console.log(line)
  if (STATUS) writeFileSync(STATUS, `${new Date().toISOString()} ${line}\n`, { flag: 'a' })
}

describe('recall, measured offline on the trap stories', () => {
  it('scores each tested fact', async () => {
    const embedder: Embedder | null = haveModel ? await realEmbedder(MODEL) : null
    const vectors = new Vectors()
    const stories: EvalStory[] = [...(STORIES.includes('book') ? [bookStory()] : []), ...(STORIES.includes('v3') ? [v3Story()] : [])]
    const ce = haveReranker ? await crossEncoder(RERANKER) : null
    const searches: { name: string; o: Omit<EvalOptions, 'log'> }[] = [
      { name: 'keyword', o: { embedder: null, summaries: false } },
      { name: 'keyword + summaries', o: { embedder: null, summaries: true } },
      ...(embedder
        ? [
            { name: 'meaning', o: { embedder, summaries: false } },
            { name: 'meaning + summaries', o: { embedder, summaries: true } }
          ]
        : [])
    ]
    const reranked = ce
      ? searches
          .filter((c) => c.o.embedder)
          .flatMap((c) => [
            ...RERANK_HOW.map((how) => ({ name: `${c.name} + rerank (${how})`, o: { ...c.o, rerank: reranker(ce, how) } })),
            ...(c.o.summaries ? RERANK_HOW.map((how) => ({ name: `${c.name} + rerank passages (${how})`, o: { ...c.o, rerank: reranker(ce, how, true) } })) : [])
          ])
      : []
    const configs = [...searches, ...reranked].filter((c) => !ONLY || ONLY.includes(c.name))
    const all: Record<string, Record<string, { facts: FactResult[]; msPerQuery: number }>> = {}
    const rows: string[] = []
    let step = 0
    for (const story of stories) {
      all[story.name] = {}
      for (const c of configs) {
        step++
        status(`run ${step} of ${stories.length * configs.length}: ${story.name}, ${c.name}`)
        const { facts, timings } = await evaluate(story, { ...c.o, vectors, log: status })
        const s = score(facts)
        const ms = timings.reduce((t, x) => t + x.ms, 0) / (timings.length || 1)
        all[story.name][c.name] = { facts, msPerQuery: ms }
        rows.push(
          [
            story.name.padEnd(5),
            c.name.padEnd(44),
            `facts ${String(s.facts).padStart(2)}`,
            `recall@6 ${pct(s.recallAt6)}`,
            `MRR@30 ${s.mrr30.toFixed(3)}`,
            `top30 ${pct(s.in30)}`,
            `passage@6 ${pct(s.passageAt6)}`,
            `scene@6 ${pct(s.sceneAt6)}`,
            `via summary ${s.viaSceneSummary}+${s.viaChapterSummary}ch`,
            `${Math.round(ms)} ms`
          ].join('  ')
        )
      }
    }
    console.log(`\n${rows.join('\n')}\n`)
    for (const story of stories) {
      for (const c of configs) {
        const misses = all[story.name][c.name].facts.filter((f) => f.states6 === null).map((f) => `${f.probe}/${f.trap}${f.states30 ? `@${f.states30}` : ''}`)
        console.log(`${story.name} ${c.name} missed: ${misses.join(' ') || 'none'}`)
      }
    }
    if (process.env.AIWRITE_RECALL_EVAL_OUT) writeFileSync(process.env.AIWRITE_RECALL_EVAL_OUT, JSON.stringify(all, null, 1))
    embedder?.close?.()
  })
})
