// The memory's note in the desk's margin (UI overhaul, phase 3): after the memory has read this scene (30 seconds after
// typing stops, on leaving the scene, or on Mark done), one slip beside the paragraph its first fact came from says how
// many facts it updated, with the first few in plain words. A click opens What changed for the scene. It goes by itself
// after 15 seconds, when another scene opens, or with its ×.
import type { ID } from '@shared/types'
import { X } from '@/components/ui/icons'
import { useApp } from '@/lib/store'
import type { MemorySlipData } from '../anchors'
import { dismissSlip } from '../marginStore'

/** The first few facts it names. */
const LINES = 3

export function MemorySlip({ id, data, sceneId }: { id: string; data: MemorySlipData; sceneId: ID }): React.JSX.Element {
  const facts = data.count === 1 ? '1 fact updated' : `${data.count} facts updated`
  return (
    <div className="relative">
      <button
        type="button"
        className="desk-paper k-memory block w-full text-left"
        aria-label={`Memory: ${facts}. Open What changed for this scene`}
        onClick={() => useApp.getState().navigate({ kind: 'memory', sceneId })}
      >
        <span className="s-head">
          <svg className="mem-tick" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          <span className="desk-caps s-kind">Memory · {facts}</span>
        </span>
        <span className="s-facts">
          {data.lines.slice(0, LINES).map((l, i) => (
            <span key={i} className="s-factrow">
              <span className="s-fdot" aria-hidden />
              <span className="min-w-0 truncate">{l}</span>
            </span>
          ))}
        </span>
      </button>
      <button type="button" className="desk-slip-x" aria-label="Put the memory’s note away" title="Put this note away" onClick={() => dismissSlip(sceneId, id)}>
        <X size={12} />
      </button>
    </div>
  )
}
