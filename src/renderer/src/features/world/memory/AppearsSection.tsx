import { memo, useState } from 'react'
import type { Appearance } from '@shared/contracts/entryViews'
import type { EntryKind } from '@shared/types'
import { Button } from '@/components/ui'
import { useApp } from '@/lib/store'
import { requestReveal } from '@/features/editor/reveal'
import { APPEARS_STEP, howText, ownTitle, showMoreText } from '../appearsLogic'
import { QuietError } from './QuietError'
import type { EntryData } from './useEntryData'

/** Opens a scene, at the words that name the entry when there are some. */
function openAt(a: Appearance): void {
  if (a.quote) requestReveal(a.sceneId, a.quote)
  useApp.getState().selectScene(a.sceneId, a.storyId)
}

/**
 * "Appears in": every scene the entry is in, in reading order: by the scene card (point of view,
 * in the scene, where it's set), named in the words (with the words around it), or changed there.
 * Each opens its scene. A busy entry's list comes a page at a time.
 */
export function AppearsSection({ name, kind, data }: { name: string; kind: EntryKind; data: EntryData<Appearance[]> }): React.JSX.Element {
  const [shown, setShown] = useState(APPEARS_STEP)
  if (data.error && !data.data) return <QuietError what="where it appears" message={data.error} onRetry={data.reload} />
  if (!data.data) return <div className="h-5" aria-hidden />
  const list = data.data
  if (!list.length) {
    return (
      <p className="text-[13px] leading-relaxed text-muted">
        {name.trim() || 'It'} isn't in any scene yet. Scenes that name {kind === 'character' ? 'them' : 'it'}, or have{' '}
        {kind === 'character' ? 'them' : 'it'} on the scene card, are listed here.
      </p>
    )
  }
  return (
    <>
      <ol className="-mx-2 flex flex-col">
        {list.slice(0, shown).map((a) => (
          <AppearRow key={a.sceneId} a={a} kind={kind} />
        ))}
      </ol>
      {list.length > shown ? (
        <Button variant="ghost" size="sm" className="-ml-2.5 mt-1" onClick={() => setShown((n) => n + APPEARS_STEP)}>
          {showMoreText(shown, list.length)}
        </Button>
      ) : null}
    </>
  )
}

const AppearRow = memo(function AppearRow({ a, kind }: { a: Appearance; kind: EntryKind }): React.JSX.Element {
  const title = ownTitle(a.title)
  const how = howText(a.how, !!a.quote, kind)
  return (
    <li>
      <button
        type="button"
        title="Open this scene"
        onClick={() => openAt(a)}
        className="group flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-2"
      >
        <span className="flex w-full min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-[13px] font-medium text-fg transition-colors duration-150 group-hover:text-accent">{a.label}</span>
          {title ? <span className="min-w-0 truncate text-[12.5px] text-muted">{title}</span> : null}
          {how ? <span className="ml-auto shrink-0 pl-2 text-[11.5px] text-faint">{how}</span> : null}
        </span>
        {a.quote ? <span className="mt-0.5 line-clamp-2 font-serif text-[13px] italic leading-snug text-muted">“{a.quote}”</span> : null}
      </button>
    </li>
  )
})
