// --chain for the trap harness (cli.mjs): which chains a run takes. Plain JavaScript so cli.mjs can use it before
// vitest starts; chain.ts CHAINS is the list it must match (tests/unit/trapsThreads.test.ts checks that).

/** The trap harness's chains (tests/traps/chain.ts CHAINS): K1 the inn, K2 the fog, K3 plot threads. */
export const CHAIN_IDS = ['K1', 'K2', 'K3']

/**
 * The chains `--chain` names, in the order given and once each: K1, K2, K3, `both` (K1 and K2, as before K3) or `all`,
 * or a comma list of those ("K1,K3", "both,K3"); null when a part is none of them.
 */
export function parseChains(arg) {
  const out = []
  for (const part of String(arg ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)) {
    const ids = part === 'BOTH' ? ['K1', 'K2'] : part === 'ALL' ? CHAIN_IDS : [part]
    for (const id of ids) {
      if (!CHAIN_IDS.includes(id)) return null
      if (!out.includes(id)) out.push(id)
    }
  }
  return out.length ? out : null
}
