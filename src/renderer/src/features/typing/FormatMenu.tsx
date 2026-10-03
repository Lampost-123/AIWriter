// The Format menu on the scene's toolbar (writing by hand): bold, italic, block quote, a scene break and
// paste as plain text, each with its shortcut beside it. Bold, Italic and Block quote are ticked when the
// words at the caret already have them. Picking one puts the caret back in the page.
import * as M from '@radix-ui/react-dropdown-menu'
import { Bold, Check, ClipboardType, Italic, SeparatorHorizontal, TextQuote, Type } from 'lucide-react'
import { useRef, useState } from 'react'
import { shortcutText, type ShortcutId } from '@/lib/shortcuts'
import { ToolButton } from '@/features/editor/ToolButton'
import { editorBridge } from '@/lib/editorBridge'
import { insertSceneBreak, isFormatActive, pasteAsPlainText, toggleBlockQuote, toggleBold, toggleItalic, type FormatMark } from './format'

const ITEM =
  'flex h-8 select-none items-center gap-2.5 rounded-md px-2 text-[13px] text-fg outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50'

export function FormatMenu(): React.JSX.Element {
  const [on, setOn] = useState<Record<FormatMark, boolean>>({ bold: false, italic: false, blockquote: false })
  // Something was picked: it puts the caret back in the page itself, so the menu leaves the keyboard alone.
  const picked = useRef(false)

  const pick = (run: () => unknown) => () => {
    picked.current = true
    void run()
    // TipTap's focus() waits a frame; take the keyboard back now so the next keys typed land in the page.
    const view = editorBridge()?.editor?.view
    if (view && !view.isDestroyed) view.focus()
  }

  const check = (mark: FormatMark, label: string, icon: React.ReactNode, shortcut: ShortcutId, run: () => unknown): React.JSX.Element => (
    <M.CheckboxItem checked={on[mark]} onSelect={pick(run)} className={ITEM}>
      <span className="flex w-4 justify-center text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      <M.ItemIndicator>
        <Check size={14} className="text-accent" />
      </M.ItemIndicator>
      <Keys id={shortcut} />
    </M.CheckboxItem>
  )

  return (
    <M.Root
      modal={false}
      onOpenChange={(open) => {
        if (!open) return
        picked.current = false
        setOn({ bold: isFormatActive('bold'), italic: isFormatActive('italic'), blockquote: isFormatActive('blockquote') })
      }}
    >
      <M.Trigger asChild>
        <ToolButton icon={<Type size={15} />} label="Format" className="data-[state=open]:bg-surface-2 data-[state=open]:text-fg" />
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          onCloseAutoFocus={(e) => {
            if (picked.current) e.preventDefault()
          }}
          className="z-50 min-w-[248px] rounded-lg border border-line bg-surface p-1 font-sans shadow-pop data-[state=open]:animate-pop-in"
        >
          {check('bold', 'Bold', <Bold size={14} />, 'bold', toggleBold)}
          {check('italic', 'Italic', <Italic size={14} />, 'italic', toggleItalic)}
          {check('blockquote', 'Block quote', <TextQuote size={14} />, 'quote', toggleBlockQuote)}
          <M.Separator className="mx-1 my-1 h-px bg-line" />
          <M.Item onSelect={pick(insertSceneBreak)} className={ITEM}>
            <span className="flex w-4 justify-center text-muted">
              <SeparatorHorizontal size={14} />
            </span>
            <span className="flex-1">Scene break</span>
          </M.Item>
          <M.Item onSelect={pick(pasteAsPlainText)} className={ITEM}>
            <span className="flex w-4 justify-center text-muted">
              <ClipboardType size={14} />
            </span>
            <span className="flex-1">Paste as plain text</span>
            <Keys id="pastePlain" />
          </M.Item>
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}

function Keys({ id }: { id: ShortcutId }): React.JSX.Element {
  return <span className="ml-2 text-[12px] tabular-nums text-faint">{shortcutText(id)}</span>
}
