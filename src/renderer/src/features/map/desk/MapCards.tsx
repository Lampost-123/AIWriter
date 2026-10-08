// The desk's relationship map: the side cards. A character's card lists its ties as of the point shown, each with how
// both of them feel, since when they have been tied (a jump to that scene) and what it last changed to; a tie's card
// shows the two of them, how each feels, and the tie's history along the story, later changes faded.
import type { ID } from '@shared/types'
import type { MapTieEvent, MapTieHistory } from '@shared/contracts/worldViews'
import { ArrowRight, Eye, X } from '@/components/ui/icons'
import { Button } from '@/components/ui'
import { useApp } from '@/lib/store'
import { Medal } from './Medal'
import { MOOD_WORD, roleWords, sinceOf, TIE_KINDS, whereWords, type Side } from './deskMapLogic'
import { shortStop } from './TimeStrip'
import type { DNode, DTie } from './MapStage'

const kindLabel = (k: DTie['kind']): string => TIE_KINDS.find((x) => x.kind === k)?.label ?? ''

const goScene = (sceneId: ID, storyId: ID): void => useApp.getState().selectScene(sceneId, storyId)

/** One side's feelings: "Wren → fiercely protective". */
export function Feel({ side, name, short = false }: { side: Side; name: string; short?: boolean }): React.JSX.Element {
  return (
    <span className="dm-feel">
      <i className="dm-mood" data-mood={side.mood ?? undefined} />
      <b>
        {short ? name.split(/\s+/)[0] : name} →
      </b>
      <span>{side.feels || <em className="dm-feel-none">no feelings noted</em>}</span>
    </span>
  )
}

function Since({ events, atStop, storyId }: { events: MapTieEvent[]; atStop: number; storyId: ID }): React.JSX.Element | null {
  const since = sinceOf(events, atStop)
  if (!since) return null
  const { first, last } = since
  return (
    <span className="dm-since">
      {first.sceneId ? (
        <span>
          Since{' '}
          <button type="button" className="dm-link" onClick={() => goScene(first.sceneId!, storyId)} title={`Go to ${first.where}`}>
            {shortStop(first.where)}
          </button>
        </span>
      ) : (
        <span>Since before the story begins</span>
      )}
      {last !== first && last.sceneId ? (
        <span>
          · changed in{' '}
          <button type="button" className="dm-link" onClick={() => goScene(last.sceneId!, storyId)} title={`Go to ${last.where}`}>
            {shortStop(last.where)}
          </button>
        </span>
      ) : null}
    </span>
  )
}

export function NodeCard({
  node,
  ties,
  nodes,
  motifs,
  povId,
  history,
  atStop,
  asOf,
  storyId,
  closing,
  onClose,
  onTie
}: {
  node: DNode
  ties: DTie[]
  nodes: Map<ID, DNode>
  motifs: Map<ID, string>
  povId: ID | null
  history: Map<string, MapTieHistory>
  atStop: number
  asOf: string
  storyId: ID
  closing: boolean
  onClose: () => void
  onTie: (key: string) => void
}): React.JSX.Element {
  const mine = ties.filter((t) => t.a === node.id || t.b === node.id)
  const role = roleWords(node.role)
  return (
    <aside className="dm-float dm-card" data-map-card="character" data-closing={closing || undefined} aria-label={`${node.name}’s ties`}>
      <div className="dm-card-head">
        <Medal id={node.id} name={node.name} image={node.image} motif={motifs.get(node.id) ?? null} size={60} />
        <div className="min-w-0">
          <span className="dm-card-n">{node.name}</span>
          <span className="dm-card-r">
            {role ? <span className="dm-role">{role}</span> : <span className="dm-role">Character</span>}
            {povId === node.id ? (
              <span className="dm-role" data-pov>
                <Eye size={11} /> Point of view here
              </span>
            ) : null}
          </span>
        </div>
        <button type="button" className="dm-icon-btn dm-card-x" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="dm-card-body">
        {node.summary ? <p className="dm-card-sum">{node.summary}</p> : null}
        <div className="dm-card-cap">
          <span className="dm-caps">Ties as of {shortStop(asOf)}</span>
          <span>{mine.length === 1 ? '1 tie' : `${mine.length} ties`}</span>
        </div>
        <ul className="dm-ties">
          {mine.map((t) => {
            const otherId = t.a === node.id ? t.b : t.a
            const other = nodes.get(otherId)
            if (!other) return null
            const [me, them] = t.a === node.id ? t.sides : [t.sides[1], t.sides[0]]
            return (
              <li key={t.key} data-kind={t.kind} data-map-card-tie>
                <Medal id={other.id} name={other.name} image={other.image} motif={motifs.get(other.id) ?? null} size={34} />
                <div className="dm-t-b">
                  <div className="dm-t-top">
                    <button type="button" className="dm-t-n" onClick={() => onTie(t.key)} title="Show this tie’s history">
                      {other.name}
                    </button>
                    <span className="dm-chip" title={kindLabel(t.kind)}>
                      <i />
                      {t.words || kindLabel(t.kind)}
                    </span>
                  </div>
                  <div className="dm-t-feels">
                    <Feel side={me} name={node.name} short />
                    <Feel side={them} name={other.name} short />
                  </div>
                  <Since events={history.get(t.key)?.events ?? []} atStop={atStop} storyId={storyId} />
                </div>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="dm-card-foot">
        <Button
          variant="primary"
          icon={<ArrowRight size={15} />}
          onClick={() => useApp.getState().navigate({ kind: 'entries', entryKind: 'character', entryId: node.id })}
        >
          Open page
        </Button>
      </div>
    </aside>
  )
}

export function TieCard({
  tie,
  nodes,
  motifs,
  history,
  atStop,
  storyId,
  closing,
  onClose,
  onNode
}: {
  tie: DTie
  nodes: Map<ID, DNode>
  motifs: Map<ID, string>
  history: MapTieHistory | undefined
  atStop: number
  storyId: ID
  closing: boolean
  onClose: () => void
  onNode: (id: ID) => void
}): React.JSX.Element | null {
  const a = nodes.get(tie.a)
  const b = nodes.get(tie.b)
  if (!a || !b) return null
  const temp = tie.temp
  const events = history?.events ?? []
  // The history from the pair's own sides: the card's a and b are the tie's.
  const flip = history ? history.aId !== tie.a : false
  return (
    <aside
      className="dm-float dm-card"
      data-map-card="tie"
      data-kind={tie.kind}
      data-closing={closing || undefined}
      aria-label={`${a.name} and ${b.name}`}
    >
      <div className="dm-pair">
        <button type="button" onClick={() => onNode(a.id)} title={`Show ${a.name}’s ties`}>
          <Medal id={a.id} name={a.name} image={a.image} motif={motifs.get(a.id) ?? null} size={56} />
        </button>
        <span className="dm-pair-line" data-kind={tie.kind} />
        <button type="button" onClick={() => onNode(b.id)} title={`Show ${b.name}’s ties`}>
          <Medal id={b.id} name={b.name} image={b.image} motif={motifs.get(b.id) ?? null} size={56} />
        </button>
        <button type="button" className="dm-icon-btn dm-card-x" aria-label="Close" onClick={onClose} style={{ marginLeft: 8 }}>
          <X size={16} />
        </button>
      </div>
      <div className="dm-pair-names">
        <span>{a.name}</span>
        <span>{b.name}</span>
      </div>
      <div className="dm-pair-kind">
        <span className="dm-chip">
          <i />
          {tie.words ? `${tie.words} · ${kindLabel(tie.kind)}` : kindLabel(tie.kind)}
        </span>
      </div>
      <div className="dm-card-body">
        <p className="dm-temp">
          {temp === 'warm'
            ? 'Warm on both sides'
            : temp === 'tense'
              ? 'Tense between them'
              : temp === 'lopsided'
                ? 'Lopsided: one warm, one wary'
                : temp === 'mixed'
                  ? 'Mixed feelings'
                  : 'No feelings noted yet'}
        </p>
        <div className="dm-sides">
          {tie.sides.map((s) => (
            <div key={s.from} className="dm-side">
              <span className="dm-side-who">
                <i className="dm-mood" data-mood={s.mood ?? undefined} />
                {nodes.get(s.from)?.name} feels{s.mood ? ` · ${MOOD_WORD[s.mood]}` : ''}
              </span>
              <p>{s.feels || <span className="dm-feel-none">Nothing noted.</span>}</p>
            </div>
          ))}
        </div>
        {events.length ? (
          <>
            <div className="dm-card-cap">
              <span className="dm-caps">History</span>
              <span>{events.length === 1 ? '1 change' : `${events.length} changes`}</span>
            </div>
            <ol className="dm-hist" data-map-history>
              {events.map((e, i) => {
                const later = e.stop > atStop
                const now = !later && (i === events.length - 1 || events[i + 1].stop > atStop)
                const [af, bf] = flip ? [e.bFeels, e.aFeels] : [e.aFeels, e.bFeels]
                return (
                  <li key={i} data-later={later || undefined} data-now={now || undefined}>
                    <div className="dm-hist-where">
                      {e.sceneId ? (
                        <button type="button" className="dm-link" onClick={() => goScene(e.sceneId!, storyId)}>
                          {shortStop(e.where)}
                        </button>
                      ) : (
                        <span>{whereWords(e)}</span>
                      )}
                      {later ? <span className="dm-tag">Later</span> : now ? <span className="dm-tag">Now</span> : null}
                      {e.ended ? <span className="dm-tag">Ended</span> : null}
                    </div>
                    <div className="dm-hist-type">{e.ended ? `No longer ${e.type || 'tied'}` : e.type || 'Tied'}</div>
                    {!e.ended && (af || bf) ? (
                      <div className="dm-hist-feels">
                        {af ? (
                          <div>
                            {a.name.split(/\s+/)[0]}: {af}
                          </div>
                        ) : null}
                        {bf ? (
                          <div>
                            {b.name.split(/\s+/)[0]}: {bf}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ol>
          </>
        ) : null}
      </div>
      <div className="dm-card-foot">
        <Button onClick={() => useApp.getState().navigate({ kind: 'entries', entryKind: 'character', entryId: a.id })}>
          {a.name.split(/\s+/)[0]}’s page
        </Button>
        <Button onClick={() => useApp.getState().navigate({ kind: 'entries', entryKind: 'character', entryId: b.id })}>
          {b.name.split(/\s+/)[0]}’s page
        </Button>
      </div>
    </aside>
  )
}
