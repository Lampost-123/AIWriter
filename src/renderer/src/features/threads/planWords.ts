// What the promises ledger's actions say (long story memory fix 10): the toasts after "Pay off by", Mark as dropped and
// Pick up again, from the board or Worth a look. Pure, so it is unit-tested (boardLogic.test.ts).

const named = (name: string): string => `“${name.trim() || 'This plot thread'}”`

/** "“The drowned bell” is to be paid off by the end of Ch 5." or, with none, "“…” has no chapter to be paid off by now." */
export function payByToast(name: string, chapter: string | null): string {
  return chapter ? `${named(name)} is to be paid off by the end of ${chapter}.` : `${named(name)} has no chapter to be paid off by now.`
}

/** "Marked “…” as dropped. The AI won’t bring it up again." / "“…” is open again. The AI will keep it alive." */
export function droppedToast(name: string, dropped: boolean): string {
  return dropped ? `Marked ${named(name)} as dropped. The AI won’t bring it up again.` : `${named(name)} is open again. The AI will keep it alive.`
}
