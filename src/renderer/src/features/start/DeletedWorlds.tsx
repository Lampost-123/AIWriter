// Deleting a whole world from the start screen: a confirmation that names the world and what it holds, and the
// start screen's Recently deleted section (each deleted world with when it goes for good, Restore, and Empty now
// with a second confirmation).

import { Globe2, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { DeletedWorld, LibraryWorld } from '@shared/contracts/library'
import { Button, Card, Dialog } from '@/components/ui'
import { useApp } from '@/lib/store'
import { deleteWorldFromStart, emptyDeletedWorlds, restoreWorldFromStart } from './startActions'
import { DELETED_DAYS_TEXT, deletedLine, holdsText } from './startLogic'

/** "Delete this world?": names it and what it holds, with a red Delete world. */
export function DeleteWorldDialog({ world, onClose }: { world: LibraryWorld | null; onClose: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  // Kept while the dialog closes, so its words don't change as it fades.
  const [shown, setShown] = useState<LibraryWorld | null>(world)
  if (world && world !== shown) setShown(world)
  const isOpen = useApp((s) => !!shown && s.world?.id === shown.id)
  const w = world ?? shown
  return (
    <Dialog
      open={!!world}
      onOpenChange={(o) => {
        if (!o && !busy) onClose()
      }}
      title="Delete this world?"
      description={w ? `${w.name}: ${holdsText(w.stories.length, w.words)}.` : ''}
      footer={
        <>
          <Button variant="ghost" data-autofocus disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={busy ? undefined : <Trash2 size={14} />}
            loading={busy}
            onClick={() => {
              if (!w) return
              setBusy(true)
              void deleteWorldFromStart(w).then((done) => {
                setBusy(false)
                if (done) onClose()
              })
            }}
          >
            Delete world
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-fg">
        Everything in it goes to Recently deleted, at the foot of the start screen, where you can restore it for {DELETED_DAYS_TEXT}. After
        that it’s gone for good.
        {isOpen ? ' It’s open now, so it closes first, and everything in it is saved.' : ''}
      </p>
    </Dialog>
  )
}

/** The start screen's Recently deleted: deleted worlds, newest first, each with Restore; Empty now for all. */
export function RecentlyDeletedWorlds({ deleted, style }: { deleted: DeletedWorld[]; style?: React.CSSProperties }): React.JSX.Element | null {
  const [restoring, setRestoring] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [emptying, setEmptying] = useState(false)
  if (!deleted.length) return null
  return (
    <section aria-labelledby="start-deleted" className="start-rise mt-10" style={style}>
      <div className="mb-2 flex items-end justify-between gap-4">
        <div>
          <h2 id="start-deleted" className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">
            Recently deleted
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted">Deleted worlds wait here for {DELETED_DAYS_TEXT}, then go for good.</p>
        </div>
        <Button size="sm" variant="danger" onClick={() => setConfirm(true)} disabled={emptying}>
          Empty now
        </Button>
      </div>
      <Card className="overflow-hidden">
        <ul aria-label="Recently deleted worlds">
          {deleted.map((d) => (
            <li key={d.trashId} className="flex h-[56px] items-center gap-3 border-b border-line px-4 last:border-b-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
                <Globe2 size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-fg">{d.name}</p>
                <p className="truncate text-[12px] text-muted">{deletedLine(d)}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw size={13} />}
                loading={restoring === d.trashId}
                disabled={!!restoring || emptying}
                aria-label={`Restore “${d.name}”`}
                onClick={() => {
                  setRestoring(d.trashId)
                  void restoreWorldFromStart(d).finally(() => setRestoring(null))
                }}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Dialog
        open={confirm}
        onOpenChange={(o) => !emptying && setConfirm(o)}
        title="Empty Recently deleted?"
        description={
          deleted.length === 1
            ? `“${deleted[0].name}” will be removed for good. This can’t be undone.`
            : `These ${deleted.length} worlds will be removed for good. This can’t be undone.`
        }
        footer={
          <>
            <Button variant="ghost" data-autofocus disabled={emptying} onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={emptying ? undefined : <Trash2 size={14} />}
              loading={emptying}
                onClick={() => {
                setEmptying(true)
                void emptyDeletedWorlds(deleted.length).finally(() => {
                  setEmptying(false)
                  setConfirm(false)
                })
              }}
            >
              Empty now
            </Button>
          </>
        }
      >
        {deleted.length > 1 ? (
          <ul className="list-disc pl-5 text-[13px] leading-relaxed text-fg">
            {deleted.map((d) => (
              <li key={d.trashId}>{d.name}</li>
            ))}
          </ul>
        ) : null}
      </Dialog>
    </section>
  )
}
