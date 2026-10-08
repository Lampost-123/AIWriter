// True while `on`, and for a moment after it turns off (long enough for a fade out), so what fades can stay drawn until
// it has gone and then be taken away.
import { useEffect, useState } from 'react'

/** The longest a way out lasts on the desk (--dur-exit is 140ms), with a little to spare. */
const EXIT = 200

export function useStays(on: boolean, ms = EXIT): boolean {
  const [stays, setStays] = useState(on)
  useEffect(() => {
    if (on) {
      setStays(true)
      return
    }
    const t = setTimeout(() => setStays(false), ms)
    return () => clearTimeout(t)
  }, [on, ms])
  return on || stays
}
