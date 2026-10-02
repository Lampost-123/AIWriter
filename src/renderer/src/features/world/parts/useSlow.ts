import { useEffect, useState } from 'react'

/** True once loading has taken long enough to be worth a spinner, so quick loads never flash one. */
export function useSlow(loading: boolean, ms = 300): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!loading) {
      setSlow(false)
      return
    }
    const t = setTimeout(() => setSlow(true), ms)
    return () => clearTimeout(t)
  }, [loading, ms])
  return slow
}
