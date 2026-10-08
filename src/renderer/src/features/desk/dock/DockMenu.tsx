// The AI dock's "⋯" menu (the desk, UI overhaul phase 3): the other ways to write (amber, the AI's own colour) and the
// rest of what the panels' scene toolbar has, so nothing is lost on the desk. Ways to write: Rewrite the scene, Fresh
// take, Draft three (variants side by side), Beat by beat, Draft options. The scene: Mark done (or Reopen), its status,
// the scene panel, Ask the world, its history, Listen and speakers (with read aloud on), and Format (bold, italic,
// block quote, a scene break, paste as plain text). Each runs exactly what the toolbar's button runs.
import * as M from '@radix-ui/react-dropdown-menu'
import {
  Bold,
  Check,
  ChevronRight,
  ClipboardType,
  Columns3,
  Headphones,
  History,
  Italic,
  ListOrdered,
  MessageSquareQuote,
  MessagesSquare,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  SeparatorHorizontal,
  Shuffle,
  SlidersHorizontal,
  TextQuote,
  Type
} from '@/components/ui/icons'
import { useRef, useState, type ReactNode } from 'react'
import type { ID, SceneStatus } from '@shared/types'
import { cn } from '@/lib/cn'
import { editorBridge } from '@/lib/editorBridge'
import { shortcutText, type ShortcutId } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { closeAsk, openAsk } from '@/features/ask/open'
import { startBeatByBeat } from '@/features/beats/start'
import { STATUS_LABELS, STATUSES, StatusDot } from '@/features/binder/StatusDot'
import { changeStatus, markSceneDone, reopenScene } from '@/features/editor/markDone'
import type { Generate } from '@/features/generate/useGenerate'
import { openHistory } from '@/features/history/open'
import { toggleListen, useReading } from '@/features/readAloud/control'
import { setShowSpeakers } from '@/features/readAloud/SpeakersButton'
import { insertSceneBreak, isFormatActive, pasteAsPlainText, toggleBlockQuote, toggleBold, toggleItalic } from '@/features/typing/format'
import { openVariants } from '@/features/variants/open'
import { isWriting, setOf, useVariants } from '@/features/variants/store'

const ITEM =
  'desk-menu-item flex h-[34px] select-none items-center gap-2.5 rounded-[9px] px-2.5 text-[13px] text-fg outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50'
const CONTENT =
  'desk-menu z-50 min-w-[232px] rounded-[14px] p-1.5 font-sans data-[state=open]:animate-pop-in'

function Keys({ id }: { id: ShortcutId }): React.JSX.Element {
  return <span className="ml-auto pl-3 text-[11.5px] tabular-nums text-faint">{shortcutText(id)}</span>
}

/** A menu row: its icon (amber for the AI's own ways to write), its name, and its keys. */
function Row({ icon, ai, children, keys }: { icon: ReactNode; ai?: boolean; children: ReactNode; keys?: ShortcutId }): React.JSX.Element {
  return (
    <>
      <span className={cn('flex w-4 shrink-0 justify-center', ai ? 'text-ai' : 'text-muted')} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {keys ? <Keys id={keys} /> : null}
    </>
  )
}

export function DockMenu({ sceneId, status, g, disabled }: { sceneId: ID; status: SceneStatus; g: Generate; disabled?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  /** What was picked puts the keyboard somewhere itself (the page, a panel): the menu leaves it alone as it closes. */
  const placed = useRef(false)
  const [marks, setMarks] = useState({ bold: false, italic: false, blockquote: false })
  const readAloud = useApp((s) => !!s.settings?.speech.readAloud)
  const speakers = useApp((s) => !!s.settings?.speech.showSpeakers)
  const asking = useApp((s) => s.askOpen && s.view.kind === 'write' && !!s.settings?.layout.inspectorOpen)
  const reading = useReading((s) => s.reading && s.sceneId === sceneId)
  const variantsWriting = useVariants((s) => isWriting(setOf(s, sceneId)))
  const done = status === 'done'

  /** Runs `fn` once the menu has closed; with `page`, the keyboard goes back into the page. */
  const pick = (fn: () => unknown, o: { page?: boolean; placed?: boolean } = {}) => () => {
    placed.current = !!(o.page || o.placed)
    void fn()
    if (o.page) {
      // TipTap's focus() waits a frame; take the keyboard back now so the next keys typed land in the page.
      const view = editorBridge()?.editor?.view
      if (view && !view.isDestroyed) view.focus()
    }
  }
  const byKey = useRef(false)

  return (
    <M.Root
      modal={false}
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) return
        placed.current = false
        setMarks({ bold: isFormatActive('bold'), italic: isFormatActive('italic'), blockquote: isFormatActive('blockquote') })
      }}
    >
      <M.Trigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label="More ways to write"
          title="More ways to write, and the scene’s tools"
          onKeyDown={(e) => {
            byKey.current = e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown'
          }}
          onPointerDown={() => {
            byKey.current = false
          }}
          className="desk-dock-more grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted outline-none"
        >
          <MoreHorizontal size={18} />
        </button>
      </M.Trigger>
      <M.Portal>
        <M.Content
          side="top"
          align="end"
          sideOffset={10}
          collisionPadding={12}
          onCloseAutoFocus={(e) => {
            if (placed.current) e.preventDefault()
          }}
          className={CONTENT}
        >
          <M.Label className="desk-caps px-2.5 pb-1 pt-1.5">Ways to write</M.Label>
          <M.Item className={ITEM} onSelect={pick(() => g.generate('replace', byKey.current), { placed: true })}>
            <Row icon={<RefreshCw size={15} />} ai>
              Rewrite the scene
            </Row>
          </M.Item>
          <M.Item className={ITEM} onSelect={pick(() => g.generate('fresh', byKey.current), { placed: true })}>
            <Row icon={<Shuffle size={15} />} ai>
              Fresh take
            </Row>
          </M.Item>
          <M.Item className={ITEM} onSelect={pick(() => openVariants(sceneId), { placed: true })}>
            <Row icon={<Columns3 size={15} />} ai>
              {variantsWriting ? 'Draft three (being written)' : 'Draft three'}
            </Row>
          </M.Item>
          <M.Item className={ITEM} onSelect={pick(() => startBeatByBeat(sceneId, { byKey: byKey.current }), { placed: true })}>
            <Row icon={<ListOrdered size={15} />} ai>
              Beat by beat
            </Row>
          </M.Item>
          <M.Item
            className={ITEM}
            onSelect={pick(
              () => {
                g.loadCard(true)
                g.checkText()
                g.setPopover('options')
              },
              { placed: true }
            )}
          >
            <Row icon={<SlidersHorizontal size={15} />} ai>
              Draft options…
            </Row>
          </M.Item>

          <M.Separator className="mx-1.5 my-1 h-px bg-line" />
          <M.Label className="desk-caps px-2.5 pb-1 pt-1.5">This scene</M.Label>
          <M.Item className={ITEM} onSelect={pick(() => (done ? reopenScene(sceneId) : markSceneDone(sceneId)))}>
            <Row icon={done ? <RotateCcw size={14} /> : <Check size={15} />} keys={done ? undefined : 'markDone'}>
              {done ? 'Reopen the scene' : 'Mark done'}
            </Row>
          </M.Item>
          <M.Sub>
            <M.SubTrigger className={ITEM}>
              <span className="flex w-4 shrink-0 justify-center" aria-hidden>
                <StatusDot status={status} />
              </span>
              <span className="min-w-0 flex-1 truncate">Status: {STATUS_LABELS[status]}</span>
              <ChevronRight size={14} className="ml-auto text-faint" aria-hidden />
            </M.SubTrigger>
            <M.Portal>
              <M.SubContent sideOffset={6} collisionPadding={12} className={cn(CONTENT, 'min-w-[168px]')}>
                {STATUSES.map((s) => (
                  <M.Item key={s} className={ITEM} onSelect={pick(() => s !== status && changeStatus(sceneId, status, s))}>
                    <span className="flex w-4 justify-center">
                      <StatusDot status={s} />
                    </span>
                    <span className="flex-1">{STATUS_LABELS[s]}</span>
                    {s === status ? <Check size={14} className="text-accent" /> : null}
                  </M.Item>
                ))}
              </M.SubContent>
            </M.Portal>
          </M.Sub>
          <M.CheckboxItem className={ITEM} checked={asking} onSelect={pick(() => (asking ? closeAsk() : openAsk()), { placed: !asking })}>
            <Row icon={<MessagesSquare size={15} />}>Ask the world</Row>
          </M.CheckboxItem>
          <M.Item className={ITEM} onSelect={pick(() => openHistory(sceneId), { placed: true })}>
            <Row icon={<History size={15} />}>Scene history</Row>
          </M.Item>
          {readAloud ? (
            <M.Item className={ITEM} onSelect={pick(() => toggleListen(), { page: true })}>
              <Row icon={<Headphones size={15} />} keys="listen">
                {reading ? 'Pause or carry on reading' : 'Listen from the cursor'}
              </Row>
            </M.Item>
          ) : null}
          {readAloud || speakers ? (
            <M.CheckboxItem className={ITEM} checked={speakers} onSelect={pick(() => setShowSpeakers(!speakers))}>
              <Row icon={<MessageSquareQuote size={15} />}>Speakers and tone</Row>
            </M.CheckboxItem>
          ) : null}
          <M.Sub>
            <M.SubTrigger className={ITEM}>
              <Row icon={<Type size={15} />}>Format</Row>
              <ChevronRight size={14} className="ml-auto text-faint" aria-hidden />
            </M.SubTrigger>
            <M.Portal>
              <M.SubContent sideOffset={6} collisionPadding={12} className={cn(CONTENT, 'min-w-[248px]')}>
                <M.CheckboxItem className={ITEM} checked={marks.bold} onSelect={pick(toggleBold, { page: true })}>
                  <Row icon={<Bold size={14} />} keys="bold">
                    Bold
                  </Row>
                </M.CheckboxItem>
                <M.CheckboxItem className={ITEM} checked={marks.italic} onSelect={pick(toggleItalic, { page: true })}>
                  <Row icon={<Italic size={14} />} keys="italic">
                    Italic
                  </Row>
                </M.CheckboxItem>
                <M.CheckboxItem className={ITEM} checked={marks.blockquote} onSelect={pick(toggleBlockQuote, { page: true })}>
                  <Row icon={<TextQuote size={14} />} keys="quote">
                    Block quote
                  </Row>
                </M.CheckboxItem>
                <M.Separator className="mx-1.5 my-1 h-px bg-line" />
                <M.Item className={ITEM} onSelect={pick(insertSceneBreak, { page: true })}>
                  <Row icon={<SeparatorHorizontal size={14} />}>Scene break</Row>
                </M.Item>
                <M.Item className={ITEM} onSelect={pick(pasteAsPlainText, { page: true })}>
                  <Row icon={<ClipboardType size={14} />} keys="pastePlain">
                    Paste as plain text
                  </Row>
                </M.Item>
              </M.SubContent>
            </M.Portal>
          </M.Sub>
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}
