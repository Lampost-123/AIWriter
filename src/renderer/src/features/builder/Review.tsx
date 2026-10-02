// Review: the whole profile on one page, then Save (which opens the entry's page).
import { Pencil } from 'lucide-react'
import type { BuilderKind, BuilderValues } from '@shared/contracts/builder'
import type { Entry } from '@shared/types'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { PortraitDrop } from '@/features/views/PortraitDrop'
import { Portrait } from '@/features/views/Portrait'
import { markOf, type Step } from './builderLogic'
import { MarkLine } from './parts'

export interface RelationLine {
  id: string
  name: string
  type: string
}

export function Review({
  kind,
  steps,
  values,
  ai,
  entry,
  relations,
  waiting,
  saving,
  onEdit,
  onSave,
  onImage
}: {
  kind: BuilderKind
  steps: Step[]
  values: BuilderValues
  ai: Readonly<Record<string, string>>
  entry: Entry | null
  /** Characters only: who they know, or null while loading. */
  relations: RelationLine[] | null
  /** How many suggestions are still waiting on Keep or Discard. */
  waiting: number
  saving: boolean
  onEdit: (stepId: string) => void
  onSave: () => void
  onImage: (e: Entry) => void
}): React.JSX.Element {
  const name = values.name?.trim() ?? ''
  const summary = values.summary?.trim() ?? ''
  const sections = steps.filter((s) => !s.special)
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        {entry ? (
          <PortraitDrop entry={entry} size={88} onChange={onImage} />
        ) : (
          <Portrait entry={{ name: name || '?', kind, image: null }} size={88} />
        )}
        <div className="min-w-0 flex-1">
          <p className={cn('font-serif text-[26px] leading-tight', name ? 'font-semibold text-fg' : 'text-faint')}>
            {name || 'No name yet'}
          </p>
          {summary ? <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{summary}</p> : null}
        </div>
      </div>

      {sections.map((s) => {
        const shown = s.fields.filter((f) => f.key !== 'name' && f.key !== 'summary' && values[f.key]?.trim())
        return (
          <section key={s.id} aria-label={s.label} className="border-t border-line pt-4">
            <div className="mb-2 flex h-7 items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-fg">{s.label}</h3>
              <Button variant="ghost" size="sm" icon={<Pencil size={12} />} aria-label={`Edit ${s.label}`} onClick={() => onEdit(s.id)}>
                Edit
              </Button>
            </div>
            {shown.length ? (
              <dl className="flex flex-col gap-3">
                {shown.map((f) => (
                  <div key={f.key} className="min-w-0">
                    <dt className="text-[12px] font-medium text-muted">{f.label}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-[13.5px] leading-[1.6] text-fg">{values[f.key]}</dd>
                    {markOf(f.key, values[f.key] ?? '', ai) === 'ai' ? (
                      <dd>
                        <MarkLine mark="ai" />
                      </dd>
                    ) : null}
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-[13px] text-faint">{s.id === 'basics' ? 'Nothing more yet.' : 'Nothing here yet.'}</p>
            )}
          </section>
        )
      })}

      {kind === 'character' ? (
        <section aria-label="Relationships" className="border-t border-line pt-4">
          <div className="mb-2 flex h-7 items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-fg">Relationships</h3>
            <Button
              variant="ghost"
              size="sm"
              icon={<Pencil size={12} />}
              aria-label="Edit Relationships"
              onClick={() => onEdit('relationships')}
            >
              Edit
            </Button>
          </div>
          {relations === null ? (
            <p className="h-5" aria-hidden />
          ) : relations.length ? (
            <ul className="flex flex-col gap-1.5">
              {relations.map((r) => (
                <li key={r.id} className="text-[13.5px] text-fg">
                  <span className="font-medium">{r.name}</span>
                  {r.type.trim() ? <span className="text-muted"> · {r.type.trim()}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-faint">Nobody yet.</p>
          )}
        </section>
      ) : null}

      <div className="flex flex-col items-start gap-2 border-t border-line pt-5">
        {waiting > 0 ? (
          <p className="text-[12.5px] text-muted">
            {waiting === 1 ? 'One suggestion is' : `${waiting} suggestions are`} still waiting for Keep or Discard. Saving leaves{' '}
            {waiting === 1 ? 'it' : 'them'} out.
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <Button variant="primary" size="lg" disabled={!name} loading={saving} onClick={onSave}>
            Save
          </Button>
          <p className="text-[12.5px] text-faint">
            {name ? `Opens ${name}'s page. Everything here is saved already.` : 'Give it a name first, in Basics. Nothing else is needed.'}
          </p>
        </div>
      </div>
    </div>
  )
}
