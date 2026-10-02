import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type Modifier } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { GripVertical, Plus, X } from 'lucide-react'
import { forwardRef, memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useFitHeight } from '@/features/world/parts/AutoTextarea'
import { beatsToStore, mergeWithPrevious, moveBeat, newBeatId, pasteLines, removeBeat, splitBeat, toBeats, type Beat, type BeatEdit } from './beats'

const lockToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 })

/**
 * The scene's beats as an ordered list. Enter starts the next beat, Backspace on
 * an empty beat removes it, Alt+Up / Alt+Down or the handle reorder, and pasting
 * a list makes one beat per line.
 */
export const BeatsEditor = memo(function BeatsEditor({
  initial,
  onChange,
  id,
  'aria-describedby': describedBy
}: {
  initial: string[]
  onChange: (beats: string[]) => void
  id?: string
  'aria-describedby'?: string
}): React.JSX.Element {
  const [beats, setBeats] = useState(() => toBeats(initial))
  const beatsRef = useRef(beats)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const inputs = useRef(new Map<string, HTMLTextAreaElement>())
  const pendingFocus = useRef<BeatEdit['focus'] | null>(null)

  const apply = useCallback((next: Beat[], focus?: BeatEdit['focus']) => {
    beatsRef.current = next
    setBeats(next)
    onChangeRef.current(next.map((b) => b.text))
    if (focus) pendingFocus.current = focus
  }, [])

  // Move the cursor after Enter, Backspace, paste or a move, once the rows exist.
  useLayoutEffect(() => {
    const f = pendingFocus.current
    if (!f) return
    pendingFocus.current = null
    const b = beats[f.index]
    const el = b ? inputs.current.get(b.id) : undefined
    if (el) {
      el.focus()
      el.setSelectionRange(f.caret, f.caret)
    }
  }, [beats])

  const focusAt = (index: number, caret: 'start' | 'end'): void => {
    const b = beatsRef.current[index]
    const el = b ? inputs.current.get(b.id) : undefined
    if (!el) return
    el.focus()
    const at = caret === 'start' ? 0 : el.value.length
    el.setSelectionRange(at, at)
  }

  const onText = useCallback((index: number, text: string) => {
    const cur = beatsRef.current
    apply(cur.map((b, i) => (i === index ? { ...b, text: text.replace(/\r?\n/g, ' ') } : b)))
  }, [apply])

  const onKey = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const cur = beatsRef.current
      const el = e.currentTarget
      const { selectionStart: s, selectionEnd: end, value } = el
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        const r = splitBeat(cur, index, s, end)
        apply(r.beats, r.focus)
      } else if (e.key === 'Backspace' && !value && cur.length > 1) {
        e.preventDefault()
        const r = removeBeat(cur, index)
        apply(r.beats, r.focus)
      } else if (e.key === 'Backspace' && s === 0 && end === 0 && index > 0) {
        e.preventDefault()
        const r = mergeWithPrevious(cur, index)
        if (r) apply(r.beats, r.focus)
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        const to = e.key === 'ArrowUp' ? index - 1 : index + 1
        const next = moveBeat(cur, index, to)
        if (next !== cur) apply(next, { index: to, caret: s })
      } else if (e.key === 'ArrowUp' && s === 0 && end === 0 && index > 0) {
        e.preventDefault()
        focusAt(index - 1, 'end')
      } else if (e.key === 'ArrowDown' && s === value.length && end === value.length && index < cur.length - 1) {
        e.preventDefault()
        focusAt(index + 1, 'end')
      }
    },
    [apply]
  )

  const onPaste = useCallback(
    (index: number, e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget
      const r = pasteLines(beatsRef.current, index, el.selectionStart, el.selectionEnd, e.clipboardData.getData('text'))
      if (!r) return
      e.preventDefault()
      apply(r.beats, r.focus)
    },
    [apply]
  )

  const onRemove = useCallback((index: number) => {
    const r = removeBeat(beatsRef.current, index)
    apply(r.beats, r.focus)
  }, [apply])

  const register = useCallback((beatId: string, el: HTMLTextAreaElement | null) => {
    if (el) inputs.current.set(beatId, el)
    else inputs.current.delete(beatId)
  }, [])

  const addBeat = (): void => {
    const cur = beatsRef.current
    // Reuse a trailing empty beat rather than stacking blank rows.
    if (!cur[cur.length - 1].text.trim()) return focusAt(cur.length - 1, 'end')
    apply([...cur, { id: newBeatId(), text: '' }], { index: cur.length, caret: 0 })
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return
    const cur = beatsRef.current
    const from = cur.findIndex((b) => b.id === active.id)
    const to = cur.findIndex((b) => b.id === over.id)
    apply(moveBeat(cur, from, to))
  }

  const count = beatsToStore(beats).length

  return (
    <div className="flex flex-col gap-1">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[lockToVerticalAxis]}
        onDragEnd={onDragEnd}
        accessibility={{ screenReaderInstructions: { draggable: 'To move a beat, press Space, then the arrow keys, then Space again to drop it.' } }}
      >
        <SortableContext items={beats.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col rounded-md border border-line bg-page py-1 transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 hover:border-line-strong">
            {beats.map((b, i) => (
              <BeatRow
                key={b.id}
                beat={b}
                index={i}
                inputId={i === 0 ? id : undefined}
                describedBy={i === 0 ? describedBy : undefined}
                single={beats.length === 1}
                onText={onText}
                onKey={onKey}
                onPaste={onPaste}
                onRemove={onRemove}
                register={register}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addBeat}
          className="-ml-1 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12.5px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <Plus size={13} /> Add a beat
        </button>
        {count > 8 ? <span className="text-[12px] text-faint">{count} beats: a lot for one scene</span> : null}
      </div>
    </div>
  )
})

const BeatRow = memo(function BeatRow({
  beat,
  index,
  inputId,
  describedBy,
  single,
  onText,
  onKey,
  onPaste,
  onRemove,
  register
}: {
  beat: Beat
  index: number
  inputId?: string
  describedBy?: string
  single: boolean
  onText: (index: number, text: string) => void
  onKey: (index: number, e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste: (index: number, e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  onRemove: (index: number) => void
  register: (id: string, el: HTMLTextAreaElement | null) => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: beat.id })
  const setInput = useCallback((el: HTMLTextAreaElement | null) => register(beat.id, el), [register, beat.id])
  return (
    <li
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition }}
      className={cn('group relative flex items-start gap-0.5 pl-0.5 pr-1', isDragging && 'z-10 rounded-md bg-surface shadow-pop')}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Move beat ${index + 1}`}
        title="Drag to reorder (or Alt+Up and Alt+Down while typing)"
        className={cn(
          'mt-[5px] flex h-5 w-4 shrink-0 cursor-grab items-center justify-center rounded text-faint opacity-0 transition-opacity hover:text-muted focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing',
          single && 'invisible'
        )}
      >
        <GripVertical size={13} />
      </button>
      <span aria-hidden className="mt-[6px] w-4 shrink-0 select-none text-right text-[12px] tabular-nums text-faint">
        {index + 1}.
      </span>
      <BeatText
        ref={setInput}
        id={inputId}
        aria-describedby={describedBy}
        aria-label={inputId ? undefined : `Beat ${index + 1}`}
        value={beat.text}
        placeholder={index === 0 ? 'What happens first?' : 'And then?'}
        onChange={(e) => onText(index, e.target.value)}
        onKeyDown={(e) => onKey(index, e)}
        onPaste={(e) => onPaste(index, e)}
      />
      {!single ? (
        <button
          type="button"
          aria-label={`Remove beat ${index + 1}`}
          title="Remove beat"
          onClick={() => onRemove(index)}
          className="mt-[5px] flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <X size={12} />
        </button>
      ) : null}
    </li>
  )
})

/** A one-line text box that wraps and grows as it fills, without a border of its own. */
const BeatText = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }>(function BeatText(
  { value, ...rest },
  ref
) {
  const inner = useRef<HTMLTextAreaElement | null>(null)
  useFitHeight(inner, value, 1, 40)
  return (
    <textarea
      ref={(el) => {
        inner.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) ref.current = el
      }}
      rows={1}
      value={value}
      spellCheck
      className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent px-1.5 py-[5px] text-[13.5px] leading-[1.45] text-fg placeholder:text-faint focus:outline-none"
      {...rest}
    />
  )
})
