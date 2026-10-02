import { BookOpen, FileText, Folder, MapPin, RotateCcw, ScrollText, Trash2, Users } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { DeletedItem } from '@shared/types'
import { KIND_LABELS } from '@shared/fields'
import { Button, Card, EmptyState, Notice, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { formatBackupDate, inSentence } from './backupText'

// The Trash: scenes, chapters and world entries deleted from the open world, kept for
// 30 days (then purged when the world opens). Each can be brought back with one click.

const ICONS: Record<string, ReactNode> = {
  story: <BookOpen size={15} />,
  chapter: <Folder size={15} />,
  scene: <FileText size={15} />,
  character: <Users size={15} />,
  place: <MapPin size={15} />,
  lore: <ScrollText size={15} />
}

const iconFor = (d: DeletedItem): ReactNode => ICONS[d.kind === 'entry' ? (d.entryKind ?? '') : d.kind] ?? <ScrollText size={15} />

const fallbackTitle = (d: DeletedItem): string =>
  d.kind === 'entry' ? 'Unnamed' : d.kind === 'scene' ? 'Untitled scene' : d.kind === 'chapter' ? 'Untitled chapter' : 'Untitled story'

/** "Scene in Book 1 › Chapter 2", "Chapter in Book 1, with its 3 scenes", "Character". */
function whereItWas(d: DeletedItem): string {
  const story = d.storyTitle || 'Untitled story'
  switch (d.kind) {
    case 'scene':
      return `Scene in ${story} › ${d.chapterTitle || 'Untitled chapter'}`
    case 'chapter':
      return `Chapter in ${story}${d.sceneCount === 0 ? '' : d.sceneCount === 1 ? ', with its scene' : `, with its ${d.sceneCount} scenes`}`
    case 'entry':
      return d.entryKind ? KIND_LABELS[d.entryKind].one : 'World entry'
    default:
      return 'Story'
  }
}

/** Puts the screen right after something is brought back, and offers to open it. */
async function restore(d: DeletedItem): Promise<void> {
  await api.restoreDeleted(d.kind, d.id)
  const app = useApp.getState()
  if (d.kind === 'entry') app.bumpEntries()
  else {
    if (d.kind === 'story') await app.refreshStories()
    app.bumpOutline()
  }
  const title = d.title.trim() || fallbackTitle(d)
  const open =
    d.kind === 'scene' && d.storyId
      ? () => useApp.getState().selectScene(d.id, d.storyId!)
      : d.kind === 'entry' && d.entryKind
        ? () => useApp.getState().navigate({ kind: 'entries', entryKind: d.entryKind!, entryId: d.id })
        : null
  toast(`“${title}” is back.`, { tone: 'success', action: open ? { label: 'Open', run: open } : undefined })
}

export function RecentlyDeleted(): React.JSX.Element {
  const worldId = useApp((s) => s.world?.id ?? null)
  // Deleting or restoring anywhere else (an Undo) bumps these, so the list stays current.
  const outlineRev = useApp((s) => s.outlineRev)
  const entriesRev = useApp((s) => s.entriesRev)
  const [items, setItems] = useState<DeletedItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setItems(await api.listDeleted())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    if (worldId) void load()
  }, [load, worldId, outlineRev, entriesRev])

  if (!worldId) {
    return (
      <Card>
        <EmptyState icon={<Trash2 size={20} />} title="Open a world to see what was deleted from it">
          Deleted scenes, chapters and entries are kept with each world. Pick or create a world first, then come back here.
        </EmptyState>
      </Card>
    )
  }

  if (error) {
    return (
      <Notice
        tone="danger"
        action={
          <Button size="sm" onClick={() => void load()}>
            Try again
          </Button>
        }
      >
        {error}
      </Notice>
    )
  }

  // A moment while the list loads: nothing below the heading to move, so show nothing rather than a flash.
  if (!items) return <div aria-hidden className="h-[120px]" />

  if (items.length === 0) {
    return (
      <Card className="animate-fade-in">
        <EmptyState icon={<Trash2 size={20} />} title="Nothing deleted lately">
          When you delete a scene, chapter, character, place or lore, it waits here for 30 days so you can bring it back.
        </EmptyState>
      </Card>
    )
  }

  const onRestore = async (d: DeletedItem): Promise<void> => {
    setRestoring(d.id)
    try {
      await restore(d)
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    } finally {
      setRestoring(null)
      void load()
    }
  }

  return (
    <Card className="overflow-hidden animate-fade-in">
      <ul aria-label="Recently deleted">
        {items.map((d) => {
          const title = d.title.trim() || fallbackTitle(d)
          return (
            <li key={`${d.kind}:${d.id}`} className="flex h-[56px] items-center gap-3 border-b border-line px-4 last:border-b-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">{iconFor(d)}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-fg">{title}</p>
                <p className="truncate text-[12px] text-muted">
                  {whereItWas(d)}
                  <span className="px-1.5 text-faint">·</span>
                  Deleted {inSentence(formatBackupDate(d.deletedAt))}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw size={13} />}
                loading={restoring === d.id}
                disabled={!!restoring}
                onClick={() => void onRestore(d)}
                aria-label={`Restore “${title}”`}
              >
                Restore
              </Button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
