// An entry shown beside the page (Ctrl+click on a name, its hover card, or the Cast tab), in place of
// the scene panel's tabs: compact and read-mostly, as of the open scene. Its portrait, one-liner, how
// it stands, its relationships and how it speaks; "Open the full page" goes to its page, and Back
// returns to the tab Adam was on. Everything comes from the scene's names, so it shows at once.
import { ArrowLeft, ArrowUpRight, SearchX } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import type { ID } from '@shared/types'
import { Button, EmptyState, Notice } from '@/components/ui'
import { useApp } from '@/lib/store'
import { Portrait } from '@/features/views/Portrait'
import { useSceneNames } from '@/features/editor/names/sceneNames'
import { displayName, kindWord, relationRows } from './entryView'
import { ListLoading, StateList, VoiceList } from './parts'

export function PeekPanel({
  sceneId,
  entryId,
  backLabel,
  onBack
}: {
  sceneId: ID
  entryId: ID
  /** The tab Back returns to ("Cast"). */
  backLabel: string
  onBack: () => void
}): React.JSX.Element {
  const { data, fresh, error, retry } = useSceneNames(sceneId)
  const navigate = useApp((s) => s.navigate)
  const peekEntry = useApp((s) => s.peekEntry)
  const backRef = useRef<HTMLButtonElement>(null)
  const entry = data?.entries.find((e) => e.id === entryId)
  const relations = useMemo(() => {
    if (!data || !entry) return []
    const names = new Map(data.entries.map((e) => [e.id, displayName(e)]))
    return relationRows(data.relationships, { id: entry.id, name: entry.name }, (id) => names.get(id) ?? null)
  }, [data, entry])

  // Shown from the panel itself (a Cast card, now hidden): the keyboard carries on from here.
  // From the page (Ctrl+click), the caret stays in the page.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const active = document.activeElement
    const host = rootRef.current?.parentElement
    if (!active || active === document.body || host?.contains(active)) backRef.current?.focus({ preventScroll: true })
  }, [entryId])

  const header = (
    <div className="flex h-12 shrink-0 items-center border-b border-line px-2">
      <Button ref={backRef} variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={onBack}>
        Back to {backLabel}
      </Button>
    </div>
  )

  let body: React.ReactNode
  if (!entry) {
    if (data && fresh) {
      body = (
        <EmptyState
          icon={<SearchX size={20} />}
          title="Not in your world any more"
          actions={
            <Button size="sm" onClick={onBack}>
              Back to {backLabel}
            </Button>
          }
        >
          It was deleted. For 30 days it can be brought back from Settings, under Recently deleted.
        </EmptyState>
      )
    } else if (error && !data) {
      body = (
        <div className="p-4">
          <Notice
            tone="danger"
            action={
              <Button size="sm" onClick={retry}>
                Try again
              </Button>
            }
          >
            Couldn’t read this from the memory. {error}
          </Notice>
        </div>
      )
    } else body = <ListLoading rows={1} />
  } else {
    const name = displayName(entry)
    body = (
      <div className="px-4 pb-6 pt-4">
        <div className="flex items-center gap-3">
          <Portrait entry={entry} size={52} />
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-semibold leading-6 text-fg">{name}</h2>
            <p className="truncate text-[12px] leading-4 text-faint">{kindWord(entry.kind)}</p>
            {/* Which scene it is as of, whole even in a narrow panel (a long story title wraps). */}
            <p className="text-[12px] leading-4 text-faint">As of {data?.label ?? 'this scene'}</p>
          </div>
        </div>
        {entry.summary ? <p className="mt-3 text-[13px] leading-relaxed text-muted">{entry.summary}</p> : null}
        <Button
          size="sm"
          className="mt-3"
          icon={<ArrowUpRight size={14} />}
          onClick={() => navigate({ kind: 'entries', entryKind: entry.kind, entryId: entry.id })}
        >
          Open the full page
        </Button>

        <PeekSection title="As of this scene">
          <StateList entry={entry} />
        </PeekSection>

        <PeekSection title="Relationships">
          {relations.length ? (
            <ul className="-mx-2 flex flex-col">
              {relations.map((r) => (
                <li key={r.otherId}>
                  <button
                    type="button"
                    onClick={() => peekEntry(r.otherId)}
                    className="w-full rounded-md px-2 py-1 text-left transition-colors duration-150 hover:bg-surface-2"
                  >
                    <span className="block text-[12.5px] leading-[19px] text-fg">
                      {r.text}
                      {r.where ? <span className="text-faint"> · {r.where}</span> : null}
                    </span>
                    {r.detail ? <span className="block text-[12px] leading-[18px] text-muted">{r.detail}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] leading-[19px] text-faint">No relationships yet.</p>
          )}
        </PeekSection>

        {entry.kind === 'character' ? (
          <PeekSection title="Voice">
            {entry.voice ? (
              <VoiceList voice={entry.voice} samples={3} />
            ) : (
              <p className="text-[12.5px] leading-[19px] text-faint">No voice notes yet.</p>
            )}
          </PeekSection>
        ) : null}
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label={entry ? displayName(entry) : 'Beside the page'}
      className="flex h-full min-h-0 flex-col animate-fade-in"
      onKeyDown={(e) => {
        // Esc goes back to the tab (and never also stops a draft that's being written).
        if (e.key !== 'Escape' || e.defaultPrevented) return
        e.preventDefault()
        onBack()
      }}
    >
      {header}
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </div>
  )
}

function PeekSection({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section aria-label={title} className="mt-5">
      <h3 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">{title}</h3>
      {children}
    </section>
  )
}
