// What the promises ledger's actions say (long story memory fix 10): the toasts after "Pay off by", Mark as dropped and
// Pick up again, from the board or Worth a look. Pure, so it is unit-tested (boardLogic.test.ts).

const named = (name: string): string => `“${name.trim() || 'This plot thread'}”`

/**
 * After "Pay off by": "“The drowned bell” is to be paid off by the end of Ch 5."; with no chapter while a scene card plans
 * its pay-off (`cards`, "Ch 5, Sc 2"), "“…” will be paid off where the cards plan it: Ch 5, Sc 2."; with neither, "“…”
 * no longer has a chapter to be paid off by."
 */
export function payByToast(name: string, chapter: string | null, cards?: string | null): string {
  if (chapter) return `${named(name)} is to be paid off by the end of ${chapter}.`
  if (cards) return `${named(name)} will be paid off where the cards plan it: ${cards}.`
  return `${named(name)} no longer has a chapter to be paid off by.`
}

/** What "Pay off by" offers as none: the cards' plan when a scene card has one ("As the cards plan (Ch 5, Sc 2)"). */
export const noChapterLabel = (cards: string | null | undefined): string => (cards ? `As the cards plan (${cards})` : 'No chapter')

/** "Marked “…” as dropped. The AI won’t bring it up again." / "“…” is open again. The AI will keep it alive." */
export function droppedToast(name: string, dropped: boolean): string {
  return dropped ? `Marked ${named(name)} as dropped. The AI won’t bring it up again.` : `${named(name)} is open again. The AI will keep it alive.`
}
