// "Worth a look" (World Memory Overhaul B3): the memory check list at the top of What changed. Everything the memory
// isn't sure about, under plain headings: facts whose words Adam edited since, the AI's guesses, summaries being
// updated, his own facts the story no longer says, other names the story calls his characters by, and plot threads
// left waiting (long story memory fix 10). Each row: Show me (the words in the scene), Keep (it's his; for a name, Add
// name), Fix (open the page to edit it; Open for a plot thread), Remove (with Undo; for a name, Ignore; for a plot
// thread, Mark as dropped), and for a plot thread Pay off later (a later chapter to pay it off by); Keep all for a group
// (Add all). Nothing here has to be done: the memory settles most of it by itself as Adam writes. The AI's guesses start
// folded and don't count in the badge.
import * as M from '@radix-ui/react-dropdown-menu'
import { ChevronDown, ChevronRight, CircleCheck, Eye, Hourglass, PenLine, Plus, X } from '@/components/ui/icons'
import { useState } from 'react'
import type { Entry, ID, MemoryCheckItem, MemoryCheckUndo } from '@shared/types'
import { Badge, Button, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { announceDelete } from '@/lib/undoDelete'
import {
  checkCountLabel,
  checkWhat,
  countedChecks,
  dropChecks,
  foldedGroup,
  groupChecks,
  guessesOpen,
  ignoreTitle,
  keepLabel,
  keptToast,
  offeredName,
  rememberGuessesOpen,
  removeLabel,
  removedToast,
  showsWords,
  type CheckGroup
} from './checkLogic'
import { openScene, showWords } from './openScene'
import { payByToast } from '@/features/threads/planWords'

/** Rows shown in a group before "Show all". */
const FIRST_ROWS = 5

const linkClass = 'rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40'

export function CheckQueue({
  items,
  entries,
  onChange,
  onReload,
  bare = false
}: {
  items: MemoryCheckItem[]
  entries: Map<ID, Entry>
  /** The list as it now is (rows go as soon as Adam keeps or removes them). */
  onChange: (next: MemoryCheckItem[]) => void
  /** Reads the list again (after an Undo, or when something failed). */
  onReload: () => void
  /** Without its "Worth a look" heading, inside a section of its own (a scene's Issues list › Memory). */
  bare?: boolean
}): React.JSX.Element | null {
  const navigate = useApp((s) => s.navigate)
  const groups = groupChecks(items)
  const counted = countedChecks(items)
  if (!items.length) return null

  const undoWith = (undo: MemoryCheckUndo): Promise<void> =>
    api
      .undoMemoryCheck(undo)
      .then(onReload)
      .catch((e: unknown) => void toast(`That couldn't be undone. ${plainReason(e)}`, { tone: 'danger' }))

  const keep = async (rows: MemoryCheckItem[]): Promise<void> => {
    onChange(
      dropChecks(
        items,
        rows.map((r) => r.key)
      )
    )
    try {
      const undo = await api.keepMemoryChecks(rows.map((r) => r.fact))
      toast(keptToast(rows), { action: { label: 'Undo', run: () => void undoWith(undo) } })
    } catch (e) {
      onReload()
      toast(`${rows.every((r) => r.group === 'alias') ? 'That name couldn’t be added.' : "That couldn't be kept."} ${plainReason(e)}`, {
        tone: 'danger'
      })
    }
  }

  const remove = async (row: MemoryCheckItem): Promise<void> => {
    onChange(dropChecks(items, [row.key]))
    try {
      const undo = await api.removeMemoryCheck(row.fact)
      // Ignoring a name, or dropping a plot thread, deletes nothing: a plain toast with Undo.
      if (row.group === 'alias' || row.group === 'promise') toast(removedToast(row), { action: { label: 'Undo', run: () => void undoWith(undo) } })
      else announceDelete({ message: removedToast(row), noun: ['fact', 'facts'], undo: () => undoWith(undo) })
    } catch (e) {
      onReload()
      toast(`That couldn't be removed. ${plainReason(e)}`, { tone: 'danger' })
    }
  }

  // Pay off later (long story memory fix 10): the plot thread gets a later chapter to be paid off by.
  const later = async (row: MemoryCheckItem, chapter: { id: ID; label: string }): Promise<void> => {
    if (row.fact.kind !== 'promise') return
    onChange(dropChecks(items, [row.key]))
    try {
      const undo = await api.planThread(row.fact.threadId, { payBy: chapter.id })
      toast(payByToast(row.entryName, chapter.label.split(' · ')[0]), { action: { label: 'Undo', run: () => void undoWith(undo) } })
    } catch (e) {
      onReload()
      toast(`That couldn't be changed. ${plainReason(e)}`, { tone: 'danger' })
    }
  }

  const show = (row: MemoryCheckItem): void => {
    if (!row.sceneId) return
    if (row.quote.trim() || row.paragraphId) showWords(row.sceneId, row.quote, row.paragraphId)
    else void openScene(row.sceneId)
  }

  const fix = (row: MemoryCheckItem): void => {
    if (row.group === 'summary' && row.sceneId) {
      // A scene's summary is edited on its scene card.
      const app = useApp.getState()
      app.setInspectorTab('card')
      if (app.settings && !app.settings.layout.inspectorOpen) void app.updateSettings({ layout: { inspectorOpen: true } })
      void openScene(row.sceneId)
      return
    }
    const entry = row.entryId ? entries.get(row.entryId) : undefined
    if (entry) navigate({ kind: 'entries', entryKind: entry.kind, entryId: entry.id })
  }

  if (bare) {
    return (
      <div className="flex flex-col gap-4 animate-fade-in" data-memory-checks>
        {groups.map((g) => (
          <Group
            key={g.id}
            group={g}
            canOpen={(row) => (row.group === 'summary' ? !!row.sceneId : !!row.entryId && entries.has(row.entryId))}
            onShow={show}
            onKeep={(rows) => void keep(rows)}
            onFix={fix}
            onRemove={(row) => void remove(row)}
            onLater={(row, chapter) => void later(row, chapter)}
          />
        ))}
      </div>
    )
  }

  return (
    <section aria-labelledby="memory-checks" className="animate-fade-in">
      <div className="flex items-baseline gap-2">
        <h2 id="memory-checks" className="text-[15px] font-semibold text-fg">
          Worth a look
        </h2>
        {/* The AI's guesses don't count here: with only guesses, no number shows. */}
        {counted ? (
          <Badge tone="ai" className="tabular-nums">
            <span className="sr-only">{checkCountLabel(counted)}: </span>
            {counted}
          </Badge>
        ) : null}
      </div>
      <p className="mt-0.5 text-[13px] text-muted">What the memory isn’t sure about. Nothing here needs doing: look when you like.</p>
      <div className="mt-3 flex flex-col gap-5">
        {groups.map((g) => (
          <Group
            key={g.id}
            group={g}
            canOpen={(row) => (row.group === 'summary' ? !!row.sceneId : !!row.entryId && entries.has(row.entryId))}
            onShow={show}
            onKeep={(rows) => void keep(rows)}
            onFix={fix}
            onRemove={(row) => void remove(row)}
            onLater={(row, chapter) => void later(row, chapter)}
          />
        ))}
      </div>
    </section>
  )
}

type Later = (row: MemoryCheckItem, chapter: { id: ID; label: string }) => void

function Group({
  group,
  canOpen,
  onShow,
  onKeep,
  onFix,
  onRemove,
  onLater
}: {
  group: CheckGroup
  canOpen: (row: MemoryCheckItem) => boolean
  onShow: (row: MemoryCheckItem) => void
  onKeep: (rows: MemoryCheckItem[]) => void
  onFix: (row: MemoryCheckItem) => void
  onRemove: (row: MemoryCheckItem) => void
  onLater: Later
}): React.JSX.Element {
  const [all, setAll] = useState(false)
  // The AI's guesses start folded: only the heading and how many (remembered on this computer once opened).
  const folds = foldedGroup(group.id)
  const [open, setOpen] = useState(() => !folds || guessesOpen())
  const toggle = (): void => {
    setOpen(!open)
    rememberGuessesOpen(!open)
  }
  const shown = all ? group.items : group.items.slice(0, FIRST_ROWS)
  const more = group.items.length - shown.length
  const listId = `checks-${group.id}-list`
  const title = <span className="text-[12px] font-semibold uppercase tracking-wide text-faint">{group.title}</span>
  const count = <span className="text-[11.5px] tabular-nums text-faint">{group.items.length}</span>
  return (
    <div role="group" aria-labelledby={`checks-${group.id}`}>
      <div className="mb-1 flex items-center gap-2">
        {folds ? (
          <h3 id={`checks-${group.id}`}>
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              title={open ? 'Fold these away' : 'Show the AI’s guesses'}
              className="-ml-1 flex h-7 items-center gap-2 rounded px-1 outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <ChevronRight
                size={13}
                className={cn('shrink-0 text-faint transition-transform duration-150', open && 'rotate-90')}
                aria-hidden
              />
              {title}
              {count}
            </button>
          </h3>
        ) : (
          <>
            <h3 id={`checks-${group.id}`}>{title}</h3>
            {count}
          </>
        )}
        <div className="flex-1" />
        {open && group.items.length > 1 ? (
          <Button
            variant="ghost"
            size="sm"
            className="-mr-1.5 px-2"
            onClick={() => onKeep(group.items)}
            title={group.id === 'alias' ? 'Add every one of these names' : 'Keep every one of these as it is'}
          >
            {group.id === 'alias' ? 'Add all' : 'Keep all'}
          </Button>
        ) : null}
      </div>
      {open ? (
        <div id={listId}>
          <p className="mb-2 text-[12.5px] leading-snug text-muted">{group.help}</p>
          <ul className="overflow-hidden rounded-xl border border-line bg-surface">
            {shown.map((row) => (
              <Row key={row.key} row={row} canOpen={canOpen(row)} onShow={onShow} onKeep={onKeep} onFix={onFix} onRemove={onRemove} onLater={onLater} />
            ))}
          </ul>
          {more > 0 ? (
            <button type="button" className={cn(linkClass, 'mt-1.5 text-[12.5px] font-medium text-accent')} onClick={() => setAll(true)}>
              Show all {group.items.length}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Row({
  row,
  canOpen,
  onShow,
  onKeep,
  onFix,
  onRemove,
  onLater
}: {
  row: MemoryCheckItem
  canOpen: boolean
  onShow: (row: MemoryCheckItem) => void
  onKeep: (rows: MemoryCheckItem[]) => void
  onFix: (row: MemoryCheckItem) => void
  onRemove: (row: MemoryCheckItem) => void
  onLater: Later
}): React.JSX.Element {
  const promise = row.group === 'promise'
  const name = row.entryName.trim()
  const what = checkWhat(row)
  const label = name ? `${name}, ${what}` : what
  return (
    <li className="border-t border-line px-4 py-3 first:border-t-0">
      <p className="text-[13.5px] leading-snug text-fg">
        {row.group === 'summary' ? (
          <span className="font-semibold">{row.where || 'A scene'}</span>
        ) : name ? (
          <span className="font-semibold">{name}</span>
        ) : null}
        <span className="text-muted">: </span>
        {what}
      </p>
      {row.quote.trim() && row.group !== 'guess' ? (
        <p className="mt-1 border-l-2 border-line pl-2.5 font-serif text-[13px] leading-relaxed text-muted">
          “{row.quote.trim()}”{row.where ? <span className="ml-1.5 font-sans text-[12px] text-faint">{row.where}</span> : null}
        </p>
      ) : row.group === 'guess' && row.where ? (
        <p className="mt-0.5 text-[12px] text-faint">Found in {row.where}</p>
      ) : promise ? (
        <p className="mt-0.5 text-[12px] text-faint">{row.where ? `Last touched in ${row.where}` : 'Not touched in a scene yet'}</p>
      ) : null}
      <div className="-ml-2 mt-1.5 flex flex-wrap items-center gap-0.5">
        {showsWords(row) ? (
          <Button
            variant="ghost"
            size="sm"
            className="px-2"
            icon={<Eye size={13} />}
            onClick={() => onShow(row)}
            aria-label={`Show me: ${label}`}
            title={
              row.group === 'guess'
                ? 'Show where this is in your story'
                : row.group === 'summary' || promise
                  ? 'Open this scene'
                  : 'Show these words in the scene'
            }
          >
            Show me
          </Button>
        ) : null}
        {promise && row.later?.length ? <PayOffLater row={row} label={label} onLater={onLater} /> : null}
        <Button
          variant="ghost"
          size="sm"
          className="px-2"
          icon={row.group === 'alias' ? <Plus size={13} /> : <CircleCheck size={13} />}
          onClick={() => onKeep([row])}
          aria-label={`${keepLabel(row)}: ${label}`}
          title={
            row.group === 'summary'
              ? 'This summary still fits the scene'
              : row.group === 'note'
                ? 'Keep it as you wrote it'
                : row.group === 'alias'
                  ? `The AI will know ${name || 'them'} by “${offeredName(row)}” in every scene`
                  : promise
                    ? row.fact.kind === 'promise' && row.fact.why === 'paid-before'
                      ? 'Keep it paid off here. You won’t be asked about it again.'
                      : 'Leave it open as it is. You won’t be asked about it again for now.'
                    : 'Keep it as it is. It becomes yours and stops depending on the words.'
          }
        >
          {keepLabel(row)}
        </Button>
        {canOpen ? (
          <Button
            variant="ghost"
            size="sm"
            className="px-2"
            icon={<PenLine size={13} />}
            onClick={() => onFix(row)}
            aria-label={`${promise ? 'Open' : 'Fix'}: ${label}`}
            title={
              row.group === 'summary' ? 'Edit this summary on the scene card' : promise ? 'Open this plot thread' : `Open ${name || 'the page'} to edit it`
            }
          >
            {promise ? 'Open' : 'Fix'}
          </Button>
        ) : null}
        {row.canRemove ? (
          <Button
            variant="ghost"
            size="sm"
            className="px-2"
            icon={<X size={13} />}
            onClick={() => onRemove(row)}
            aria-label={`${removeLabel(row)}: ${label}`}
            title={
              row.group === 'alias'
                ? ignoreTitle(row)
                : promise
                  ? 'The story won’t pay this off: the AI stops bringing it up (you can undo it)'
                  : 'Take this out of the memory (you can undo it)'
            }
          >
            {removeLabel(row)}
          </Button>
        ) : null}
      </div>
    </li>
  )
}

/** "Pay off later" on a plot thread left waiting: the chapters it can be paid off by, the next first (fix 10). */
function PayOffLater({ row, label, onLater }: { row: MemoryCheckItem; label: string; onLater: Later }): React.JSX.Element {
  return (
    <M.Root modal={false}>
      <M.Trigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="px-2"
          icon={<Hourglass size={13} />}
          aria-label={`Pay off later: ${label}`}
          title="Choose a later chapter to pay it off by. The AI is told when it is due."
        >
          Pay off later
          <ChevronDown size={12} className="text-faint" aria-hidden />
        </Button>
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-h-[min(320px,var(--radix-dropdown-menu-content-available-height))] min-w-[220px] max-w-[320px] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
        >
          <M.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Pay it off by the end of</M.Label>
          {(row.later ?? []).map((c) => (
            <M.Item
              key={c.id}
              onSelect={() => onLater(row, c)}
              className="flex h-8 items-center rounded-md px-2 text-[13.5px] text-fg outline-none data-[highlighted]:bg-surface-2"
            >
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
            </M.Item>
          ))}
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}
