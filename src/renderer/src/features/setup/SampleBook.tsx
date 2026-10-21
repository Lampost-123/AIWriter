// The sample world as a small book, its cover in the harbour's colours and the accent Adam picked: on the setup's first
// step ("Not sure yet?") and on the start screen's other ways to start. It tilts a touch when the card holding it is
// hovered (any ancestor with .sample-book-host, or the book itself). Decoration only: what it stands for is said in words
// beside it.

import { cn } from '@/lib/cn'
import './sampleBook.css'

export function SampleBook({ className }: { className?: string }): React.JSX.Element {
  return (
    <div aria-hidden className={cn('sample-book relative h-[118px] w-[86px] shrink-0', className)}>
      <span className="sample-book-pages" />
      <span className="sample-book-cover">
        <span className="sample-book-title">The Keeper’s Light</span>
        <svg viewBox="0 0 60 44" className="sample-book-art">
          <path d="M0 44 L0 34 C14 30 22 31 30 33 C40 35 48 32 60 30 L60 44 Z" fill="currentColor" opacity="0.5" />
          <path d="M38 32 L42 32 L41 16 L39 16 Z" fill="currentColor" />
          <rect x="37.6" y="13" width="4.8" height="3.4" rx="0.8" fill="var(--sx-lamp, #ffe9b8)" />
          <path d="M40 14.6 L4 8 L4 20 Z" fill="var(--sx-lamp, #ffe9b8)" opacity="0.28" />
        </svg>
      </span>
    </div>
  )
}
