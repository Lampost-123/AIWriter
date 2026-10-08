// The desk's command bar (top bar, right): looks like a search field, opens the command palette (as Ctrl+K does), where
// anything can be found, run, or asked of the world ("Ask the world: …"). Pressing it leaves the caret where it was, so
// closing the palette goes back there. In a small window, or while an update is offered beside it, it narrows to its
// magnifier and its word.
import { Search } from '@/components/ui/icons'
import { isMac } from '@/lib/api'
import { shortcutKeys } from '@/lib/shortcuts'
import { openPalette } from '@/features/palette/paletteStore'

export function CommandBar(): React.JSX.Element {
  const keys = shortcutKeys('search')
  return (
    <button
      type="button"
      aria-label={`Search or ask anything (${keys.join('+')})`}
      aria-keyshortcuts={isMac() ? 'Meta+K' : 'Control+K'}
      title={`Search or ask anything (${keys.join('+')})`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={openPalette}
      className="desk-cmd @container flex h-8 w-full min-w-9 shrink items-center gap-2 rounded-[10px] pl-[11px] pr-1.5 text-[13px] whitespace-nowrap outline-none"
    >
      <Search size={15} className="shrink-0" aria-hidden />
      {/* Whole words or none: "Search or ask anything", then "Search", then the magnifier alone. */}
      <span className="hidden text-left @min-[224px]:inline">Search or ask anything</span>
      <span className="hidden text-left @min-[80px]:inline @min-[224px]:hidden">Search</span>
      <span className="ml-auto flex shrink-0 gap-[3px] @max-[140px]:hidden" aria-hidden>
        {keys.map((k) => (
          <kbd key={k} className="desk-kbd">
            {k}
          </kbd>
        ))}
      </span>
    </button>
  )
}
