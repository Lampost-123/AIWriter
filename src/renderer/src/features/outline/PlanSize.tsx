// How to plan and how much (the outline in stages, 2026-10-19): In stages or All at once, and the acts, chapters and
// scenes in each. The Plan hub's start (features/planHub) and the outline helper's page use it.
import { useId } from 'react'
import type { OutlineSize } from '@shared/contracts/outline'
import { Select } from '@/components/ui'
import { cn } from '@/lib/cn'
import { Segmented } from '@/features/generate/parts'
import { SIZE_CHOICES, STAGE_CHAPTER_CHOICES } from './size'
import { WHOLE_MOST_CHAPTERS, type PlanMode } from './stages'

const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`

/**
 * How to plan, and how much (2026-10-19): in stages (the acts first, each with about how many chapters; then each act's
 * chapters and each chapter's scenes when Adam asks, so every answer is short and whole) or all at once (a short story,
 * up to WHOLE_MOST_CHAPTERS chapters, with the same number of scenes in each).
 */
export function PlanSize({
  mode,
  onMode,
  size,
  onSize,
  hasActs,
  where,
  desk
}: {
  mode: PlanMode
  onMode: (m: PlanMode) => void
  size: OutlineSize
  onSize: (patch: Partial<OutlineSize>) => void
  hasActs: boolean
  where: string | null
  desk: boolean
}): React.JSX.Element {
  const staged = mode === 'stages'
  const scenes = size.chapters * size.scenes
  const actOptions = SIZE_CHOICES.acts.map((n) => ({ value: n, label: n === 0 ? (hasActs ? 'No new acts' : 'No acts') : plural(n, 'act') }))
  const chapterOptions = staged
    ? STAGE_CHAPTER_CHOICES.map((n) => ({ value: n, label: plural(n, 'chapter') }))
    : SIZE_CHOICES.chapters.filter((n) => n <= Math.max(WHOLE_MOST_CHAPTERS, size.chapters)).map((n) => ({ value: n, label: plural(n, 'chapter') }))
  const how = staged
    ? size.acts
      ? 'First the acts, each with what happens in it and about how many chapters it needs. Then plan each act’s chapters, and each chapter’s scenes, when you are ready. Every answer is short, so it comes quickly and whole.'
      : 'First the chapters, each with its goal. Then plan each chapter’s scenes when you are ready: as many as each one needs.'
    : `The whole outline in one answer, with the same number of scenes in each chapter: for a short story of up to ${WHOLE_MOST_CHAPTERS} chapters.`
  const sum = staged ? `About ${plural(size.chapters, 'chapter')} in all.` : `About ${plural(scenes, 'scene')}.`
  return (
    <fieldset className={desk ? 'plan-group' : 'mt-5'} data-plan-mode={mode}>
      <legend className={desk ? 'plan-field-l mb-1.5' : 'text-[12px] font-medium text-muted'}>How to plan</legend>
      <Segmented<PlanMode>
        label="How to plan"
        value={mode}
        onChange={onMode}
        options={[
          { value: 'stages', label: 'In stages' },
          { value: 'whole', label: 'All at once' }
        ]}
        className={desk ? 'w-full' : 'mt-1 w-[280px]'}
      />
      <p className={desk ? 'plan-hint' : 'mt-1.5 text-[12px] leading-relaxed text-faint'}>{how}</p>
      <div className={desk ? 'plan-sizes mt-2' : 'mt-2 flex flex-wrap items-center gap-2'}>
        <SizeSelect label="Acts" className={desk ? undefined : 'w-[150px]'} value={size.acts} options={actOptions} onChange={(acts) => onSize({ acts })} />
        <SizeSelect
          label="Chapters"
          className={desk ? undefined : staged ? 'w-[190px]' : 'w-[140px]'}
          value={size.chapters}
          options={chapterOptions}
          onChange={(chapters) => onSize({ chapters })}
        />
        {staged ? null : (
          <SizeSelect
            label="Scenes in each chapter"
            className={desk ? undefined : 'w-[180px]'}
            value={size.scenes}
            options={SIZE_CHOICES.scenes.map((n) => ({ value: n, label: `${plural(n, 'scene')} in each` }))}
            onChange={(scenes) => onSize({ scenes })}
          />
        )}
      </div>
      {desk ? (
        <p className="plan-sizes-sum">
          {sum}
          {where ? <span className="text-faint"> {where}</span> : null}
        </p>
      ) : (
        <p className="mt-1.5 min-h-[18px] text-[12px] text-faint">
          <span className="tabular-nums text-muted">{sum}</span>
          {where ? ` ${where}` : null}
        </p>
      )}
    </fieldset>
  )
}

function SizeSelect({
  label,
  value,
  options,
  onChange,
  className
}: {
  label: string
  value: number
  options: { value: number; label: string }[]
  onChange: (n: number) => void
  className?: string
}): React.JSX.Element {
  const id = useId()
  return (
    <div className={cn('shrink-0', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select
        id={id}
        value={String(value)}
        onChange={(v) => v !== null && onChange(Number(v))}
        options={options.map((o) => ({ value: String(o.value), label: o.label }))}
      />
    </div>
  )
}
