// Bold and Italic at the start of the bar over selected words (writing by hand). Each shows pressed in when the
// selected words already have it, and pressing it again takes it off. The words stay selected.
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { Bold, Italic } from 'lucide-react'
import { cn } from '@/lib/cn'
import { withShortcut } from '@/lib/shortcuts'

export function MarkButtons({ editor }: { editor: Editor }): React.JSX.Element {
  const on = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({ bold: !!ed?.isActive('bold'), italic: !!ed?.isActive('italic') })
  })
  return (
    <>
      <MarkButton label="Bold" title={withShortcut('Bold', 'bold')} pressed={on.bold} onClick={() => editor.chain().toggleBold().run()}>
        <Bold size={14} strokeWidth={2.5} />
      </MarkButton>
      <MarkButton label="Italic" title={withShortcut('Italic', 'italic')} pressed={on.italic} onClick={() => editor.chain().toggleItalic().run()}>
        <Italic size={14} />
      </MarkButton>
    </>
  )
}

function MarkButton({
  label,
  title,
  pressed,
  onClick,
  children
}: {
  label: string
  title: string
  pressed: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg',
        pressed && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent'
      )}
    >
      {children}
    </button>
  )
}
