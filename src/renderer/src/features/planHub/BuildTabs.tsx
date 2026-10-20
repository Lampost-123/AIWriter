// Build with AI's tabs (2026-10-20): the four sections in a row, each with its number and how it stands ("written",
// "4 people, 3 places"), one chosen. A real tab list: arrows, Home and End move between the tabs, Enter or Space (the
// button's own) picks one. Picking one is PlanHub's goTo: the view changes, so every way in lands on the same tab.

import type { Ref } from 'react'
import { cn } from '@/lib/cn'
import { SECTIONS, type BuildSection } from './buildLogic'

export const tabId = (s: BuildSection): string => `build-tab-${s}`
export const PANEL_ID = 'build-tabpanel'

export function BuildTabs({
  tab,
  statuses,
  onPick,
  navRef
}: {
  tab: BuildSection
  statuses: Record<BuildSection, string>
  onPick: (s: BuildSection) => void
  navRef: Ref<HTMLDivElement>
}): React.JSX.Element {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    const next =
      e.key === 'ArrowRight' ? (at + 1) % tabs.length : e.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1
    if (next < 0) return
    e.preventDefault()
    tabs[next]?.focus()
  }
  return (
    <div ref={navRef} className="build-nav" role="tablist" aria-label="Build with AI" data-build-nav onKeyDown={onKeyDown}>
      {SECTIONS.map((s, i) => {
        const on = tab === s.id
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={tabId(s.id)}
            aria-selected={on}
            aria-controls={PANEL_ID}
            tabIndex={on ? 0 : -1}
            className={cn('build-nav-btn', on && 'is-on')}
            onClick={() => onPick(s.id)}
            data-nav={s.id}
          >
            <span className="build-nav-no" aria-hidden>
              {i + 1}
            </span>
            <span className="build-nav-words">
              <span className="build-nav-t">{s.label}</span>
              {statuses[s.id] ? (
                <span className="build-nav-s" data-section-status={s.id}>
                  {statuses[s.id]}
                </span>
              ) : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
