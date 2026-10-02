import { useEffect } from 'react'
import type { ThemeName } from '@shared/types'

/**
 * Applies the chosen theme to <html data-theme>, following the system when set to 'system'.
 * Until settings load (theme undefined) it keeps the theme the window opened in.
 */
export function useTheme(theme: ThemeName | undefined): void {
  useEffect(() => {
    if (!theme) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const t = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = t
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}
