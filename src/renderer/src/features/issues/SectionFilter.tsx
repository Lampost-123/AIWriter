// The Issues list's filters (the calm overhaul): All, or one section (sections.ts), each with how many it has. The scene's
// Issues list has all five; the Check room's story-wide list the three its issues fall in (Slips, Questions, Plot
// threads). Keyboard: Tab to them, Enter or Space to pick.
import { cn } from '@/lib/cn'
import { SECTION_HINTS, SECTION_WORDS, SECTIONS, type IssueSection } from './sections'

export function SectionFilter<S extends IssueSection>({
  value,
  counts,
  onChange,
  sections = SECTIONS as readonly S[],
  className
}: {
  value: S | 'all'
  counts: Partial<Record<S | 'all', number>>
  onChange: (v: S | 'all') => void
  sections?: readonly S[]
  className?: string
}): React.JSX.Element {
  const chip = (v: S | 'all', label: string): React.JSX.Element => (
    <button
      key={v}
      type="button"
      aria-pressed={value === v}
      data-filter={v}
      onClick={() => onChange(v)}
      title={v === 'all' ? 'Every section' : SECTION_HINTS[v as IssueSection]}
      className={cn(
        'flex h-7 min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-full px-2 text-[12px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/40',
        value === v ? 'bg-surface-3 font-medium text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'
      )}
    >
      {label}
      {counts[v] ? <span className="tabular-nums text-faint">{counts[v]}</span> : null}
    </button>
  )
  return (
    // Two even rows in a narrow panel, one row where there is room (the panel is a container).
    <div
      role="group"
      aria-label="Show"
      className={cn('grid gap-1 px-3 pb-1.5', sections.length > 3 ? 'grid-cols-3 @min-[560px]:grid-cols-6' : 'w-fit grid-flow-col', className)}
    >
      {chip('all', 'All')}
      {sections.map((k) => chip(k, SECTION_WORDS[k]))}
    </div>
  )
}
