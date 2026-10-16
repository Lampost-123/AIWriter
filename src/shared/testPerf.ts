// Time budgets for the speed checks in tests (never used by the app). GitHub's shared Windows runners run the whole suite
// many times slower than a desk machine while hundreds of files share four cores (worldFile.test.ts: 1.5 s here, 22 s
// there), so a budget that is strict at a desk failed there at random (a 40 ms layout took 47 ms). On CI each budget
// gets PERF_SLACK times the room; at a desk it stays exactly as strict, so a real slowdown still shows where it is made.
export const PERF_SLACK = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CI ? 4 : 1

/** A time budget in milliseconds, with CI's room. */
export const budget = (ms: number): number => ms * PERF_SLACK
