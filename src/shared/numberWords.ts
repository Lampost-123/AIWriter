// Numbers as words, for the desk's chapter labels ("Chapter One · The Night Ferry", "Scene 1 of 2"): one to ninety-nine
// in words, plain figures after that. Pure, so it is unit-tested.

const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

/** "One", "Twelve", "Twenty-One", "Ninety-Nine"; 100 and over (or anything that isn't a whole number from 1) as figures. */
export function numberWords(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) return String(n)
  if (n < 20) return ONES[n]
  const ones = n % 10
  return ones ? `${TENS[Math.floor(n / 10)]}-${ONES[ones]}` : TENS[n / 10]
}

/** Chapter titles that stand alone, with no "Chapter N" before them. */
const STANDALONE = /^(prologue|epilogue|interlude|afterword|foreword|preface|coda|chapter\b)/i

/**
 * The small line over a scene's title on the desk: "Chapter One · The Night Ferry", "Chapter Twelve" (no title),
 * "Prologue" alone, "Chapter 104 · The Last Bell".
 */
export function chapterLabel(position: number, title: string): string {
  const t = title.trim()
  if (t && STANDALONE.test(t)) return t
  const name = `Chapter ${numberWords(position)}`
  return t ? `${name} · ${t}` : name
}
