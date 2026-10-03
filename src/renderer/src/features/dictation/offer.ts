// Dictated words that couldn't go where they were meant to (milestone 4): the place closed, or can't be
// typed in now. They are offered in a message with a button to copy them, so what was said is never lost.
import { toast } from '@/components/ui'

export const BOX_GONE = "The box your words were for can't take them now, so here they are to copy:"

/** Offers words that couldn't go where they were meant to, with a button to copy them. */
export function offerWords(text: string, why: string): void {
  const shown = text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text
  toast(`${why} “${shown}”`, {
    action: {
      label: 'Copy',
      run: () =>
        void navigator.clipboard.writeText(text).then(
          () => toast('Copied. Paste them where you like.'),
          () => toast("Your words couldn't be copied. Try again, or say them again where you want them.", { tone: 'danger' })
        )
    }
  })
}
