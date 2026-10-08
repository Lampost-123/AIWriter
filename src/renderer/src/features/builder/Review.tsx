// Review: the finished entry as its card will show in the world, with Save under it (which opens the entry's page), and
// beside it every step's words in a card of its own, each with its step's icon and an Edit that goes back to it.
import { Pencil } from '@/components/ui/icons'
import type { ReactNode } from 'react'
import type { BuilderKind, BuilderValues } from '@shared/contracts/builder'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { markOf, shownValue, type Step } from './builderLogic'
import { MarkLine } from './parts'
import { stepIcon } from './stepIcons'

export interface RelationLine {
  id: string
  name: string
  type: string
}

function ReviewCard({
  kind,
  id,
  title,
  onEdit,
  children
}: {
  kind: BuilderKind
  id: string
  title: string
  onEdit: () => void
  children: ReactNode
}): React.JSX.Element {
  const Icon = stepIcon(kind, id)
  return (
    <section aria-label={title} className="bld-rv">
      <div className="bld-rv-h">
        <span aria-hidden className="bld-rv-ic">
          <Icon size={16} />
        </span>
        <h3 className="bld-rv-t">{title}</h3>
        <Button variant="ghost" size="sm" icon={<Pencil size={12} />} aria-label={`Edit ${title}`} onClick={onEdit}>
          Edit
        </Button>
      </div>
      {children}
    </section>
  )
}

export function Review({
  kind,
  steps,
  values,
  ai,
  relations,
  waiting,
  saving,
  card,
  onEdit,
  onSave
}: {
  kind: BuilderKind
  steps: Step[]
  values: BuilderValues
  ai: Readonly<Record<string, string>>
  /** Characters only: who they know (and any group or place they are linked to), or null while loading. */
  relations: RelationLine[] | null
  /** How many suggestions are still waiting on Keep or Discard. */
  waiting: number
  saving: boolean
  /** The entry's card, as the world will show it. */
  card: ReactNode
  onEdit: (stepId: string) => void
  onSave: () => void
}): React.JSX.Element {
  const name = values.name?.trim() ?? ''
  const sections = steps.filter((s) => !s.special)
  return (
    <div className="bld-review">
      <div className="bld-review-card">
        <div className="bld-review-sticky">
          {card}
          <div className="bld-review-save">
            {waiting > 0 ? (
              <p className="text-[12.5px] text-muted">
                {waiting === 1 ? 'One suggestion is' : `${waiting} suggestions are`} still waiting for Keep or Discard. Saving leaves{' '}
                {waiting === 1 ? 'it' : 'them'} out.
              </p>
            ) : null}
            <Button variant="primary" size="lg" disabled={!name} loading={saving} onClick={onSave} className="w-full justify-center">
              Save
            </Button>
            <p className="text-[12.5px] text-faint">
              {name ? `Opens ${name}'s page. Everything here is saved already.` : 'Give it a name first, in Basics. Nothing else is needed.'}
            </p>
          </div>
        </div>
      </div>

      <div className="bld-review-list">
        {sections.map((s) => {
          const shown = s.fields.filter((f) => f.key !== 'name' && f.key !== 'summary' && values[f.key]?.trim())
          return (
            <ReviewCard key={s.id} kind={kind} id={s.id} title={s.label} onEdit={() => onEdit(s.id)}>
              {shown.length ? (
                <dl className="bld-rv-dl">
                  {shown.map((f) => (
                    <div key={f.key} className={cn('min-w-0', f.type === 'line' || f.type === 'role' ? 'is-line' : 'is-wide')}>
                      <dt>{f.label}</dt>
                      <dd className="whitespace-pre-wrap break-words">{shownValue(f.key, values[f.key])}</dd>
                      {markOf(f.key, values[f.key] ?? '', ai) === 'ai' ? (
                        <dd>
                          <MarkLine mark="ai" />
                        </dd>
                      ) : null}
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="bld-rv-none">{s.id === 'basics' ? 'Nothing more yet.' : 'Nothing here yet.'}</p>
              )}
            </ReviewCard>
          )
        })}

        {kind === 'character' ? (
          <ReviewCard kind={kind} id="relationships" title="Relationships" onEdit={() => onEdit('relationships')}>
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
              <p className="bld-rv-none">Nobody yet.</p>
            )}
          </ReviewCard>
        ) : null}
      </div>
    </div>
  )
}
