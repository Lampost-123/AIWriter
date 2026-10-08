// The story board as a compact list (Cards | Outline): each chapter with its numeral, label, title and how far along it
// is, then its scenes, each with its ring, title, what happens, "AI idea" while planned from one, whose eyes it is told
// through and its words. A row opens its scene.
import type { CodexCard } from '@shared/contracts/entryViews'
import type { BoardSceneCard } from '@shared/contracts/worldViews'
import type { ID, Outline } from '@shared/types'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { Portrait } from '@/features/views/Portrait'
import { chapterShelf, scenesOf } from '@/features/desk/home/homeLogic'
import { cardSummary } from './BoardCard'

function Ring({ status, ai }: { status: string; ai: boolean }): React.JSX.Element {
  return (
    <svg className={cn('board-ol-ring', ai ? 'is-ai' : `is-${status}`)} width={14} height={14} viewBox="0 0 16 16" aria-hidden>
      {status === 'done' ? (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M5.1 8.2l1.9 1.9 3.9-4" fill="none" stroke="var(--page)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          {status === 'drafted' || status === 'revised' ? <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" /> : null}
        </>
      )}
    </svg>
  )
}

export function BoardOutline({
  outline,
  cards,
  people,
  ai
}: {
  outline: Outline
  cards: Record<ID, BoardSceneCard> | null
  people: Map<ID, CodexCard>
  ai: Set<ID>
}): React.JSX.Element {
  const sceneId = useApp((s) => s.sceneId)
  const shelf = chapterShelf(outline, sceneId)
  return (
    <div className="board-outline-scroll">
      <section className="board-outline" aria-label="Outline of the story">
        {outline.chapters.map((c, i) => {
          const s = shelf[i]
          return (
            <div key={c.id} className="board-ol-chapter">
              <div className="board-ol-chap">
                <span className="board-ol-num">{s.numeral}</span>
                <span className="desk-caps">{s.label}</span>
                <span className={cn('board-ol-ctitle', !s.title && 'is-untitled')}>{s.title || 'Untitled'}</span>
                <span className="board-ol-cmeta tabular-nums">
                  {s.scenes.length ? `${s.done} of ${s.scenes.length} done · ${s.words.toLocaleString('en-GB')} words` : 'No scenes yet'}
                </span>
              </div>
              {scenesOf(outline, c.id).map((scene, n) => {
                const card = cards?.[scene.id] ?? null
                const pov = card?.povId ? people.get(card.povId) : undefined
                const isAi = ai.has(scene.id) && scene.wordCount === 0
                return (
                  <button
                    key={scene.id}
                    type="button"
                    className={cn('board-ol-scene', scene.id === sceneId && 'is-current')}
                    onClick={() => useApp.getState().selectScene(scene.id)}
                  >
                    <span className="board-ol-n tabular-nums">{n + 1}</span>
                    <Ring status={scene.status} ai={isAi} />
                    <span className="board-ol-stitle">{scene.title.trim() || 'Untitled scene'}</span>
                    <span className="board-ol-sum">{cardSummary(card)}</span>
                    {isAi ? <span className="board-ol-tag">AI idea</span> : null}
                    {pov ? (
                      <span title={`Told through ${pov.name}`}>
                        <Portrait entry={pov} size={20} />
                      </span>
                    ) : (
                      <span className="w-5" />
                    )}
                    <span className="board-ol-w tabular-nums">{scene.wordCount ? scene.wordCount.toLocaleString('en-GB') : '–'}</span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </section>
    </div>
  )
}
