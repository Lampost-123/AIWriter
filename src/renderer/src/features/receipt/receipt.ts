// The direction receipt (2026-10-19): after a draft (Generate, Add below) written with a direction, which of Adam's asks
// landed. The check as the words land already goes through the scene's contract, where the direction is split into its
// asks (main/ai/contract.ts directionAsks): what happens, how it reads, how long. How each came out is kept with the
// scene's check report (CheckReport.contract, with the record it was checked for), so no new AI call is made. Pure.

import type { CheckReport } from '@shared/contracts/checks'
import type { ID } from '@shared/types'

export interface ReceiptAsk {
  /** The ask in Adam's own words ("Mira lies about the key"). */
  text: string
  /** Something that happens, how the words read, or how long they are (never written in by Continue). */
  kind: 'event' | 'reads' | 'length'
  /** The new words show it (or keep to it). */
  landed: boolean
}

export interface Receipt {
  /** The draft's record. */
  recordId: ID
  /** When it was checked. */
  at: string
  asks: ReceiptAsk[]
}

/** How long after its check a receipt still shows on the desk. */
export const RECEIPT_FRESH_MS = 15 * 60_000

/**
 * The receipt from a scene's check report: each ask of the direction a draft was written with, and whether it landed.
 * Null when the latest check wasn't of a draft's words as they landed (Check this scene, Continue, a beat), the draft had
 * no direction, or the check said nothing of its asks.
 */
export function receiptOf(report: Pick<CheckReport, 'contract'> | null | undefined): Receipt | null {
  const c = report?.contract
  if (!c?.recordId || (c.asks !== 'scene' && c.asks !== 'stretch') || !Array.isArray(c.items)) return null
  const asks = c.items
    .filter((i) => i.part === 'change' && i.ask && i.result !== 'unchecked' && i.text?.trim())
    .map((i) => ({ text: i.text.trim(), kind: i.ask!, landed: i.result === 'kept' }))
  return asks.length ? { recordId: c.recordId, at: c.at, asks } : null
}

/** The receipt was checked lately enough to show on the desk. */
export const isFresh = (r: Pick<Receipt, 'at'>, now = Date.now()): boolean => {
  const at = Date.parse(r.at)
  return Number.isFinite(at) && now - at <= RECEIPT_FRESH_MS
}

/** Every ask landed: the receipt says so in one quiet line, and goes. */
export const allLanded = (r: Pick<Receipt, 'asks'>): boolean => r.asks.every((a) => a.landed)

/** The asks that didn't land and can be written in (not one of length: more words never make a draft shorter). */
export const toWriteIn = (r: Pick<Receipt, 'asks'>): ReceiptAsk[] => r.asks.filter((a) => !a.landed && a.kind !== 'length')

const sentence = (s: string): string => (/[.!?…]["'”’)\]]*$/.test(s.trim()) ? s.trim() : `${s.trim()}.`)

/** What "Write it in" asks Continue for: the asks still to write in, as Adam wrote them. '' when there are none. */
export const writeInDirection = (r: Pick<Receipt, 'asks'>): string =>
  toWriteIn(r)
    .map((a) => sentence(a.text))
    .join(' ')

/** The receipt in one line, as a screen reader hears it: "Your direction: Mira lies about the key, done; More dialogue, not yet." */
export function receiptLabel(r: Pick<Receipt, 'asks'>): string {
  return `Your direction: ${r.asks.map((a) => `${a.text.replace(/[.!?]+$/, '')}, ${a.landed ? 'done' : 'not yet'}`).join('; ')}.`
}
