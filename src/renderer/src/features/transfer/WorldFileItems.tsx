// The world files in the top bar's world menu and on the Welcome screen (milestone 6, World files and
// export): Export world…, Make a copy and Import a world file….

import * as M from '@radix-ui/react-dropdown-menu'
import { Copy, FileDown, FileUp, MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import type { ID } from '@shared/types'
import { Button } from '@/components/ui'
import { copyWorld, exportWorld, importWorld } from './worldFiles'

/** The world menu's items (TopBar.tsx), styled as its other items. "Export" and "Make a copy" only with a world open. */
export function WorldFileItems({ itemClass, hasWorld }: { itemClass: string; hasWorld: boolean }): React.JSX.Element {
  return (
    <>
      {hasWorld ? (
        <>
          <M.Item onSelect={() => void exportWorld()} className={itemClass}>
            <FileDown size={14} className="text-muted" /> Export world…
          </M.Item>
          <M.Item onSelect={() => void copyWorld()} className={itemClass}>
            <Copy size={14} className="text-muted" /> Make a copy
          </M.Item>
        </>
      ) : null}
      <M.Item onSelect={() => void importWorld()} className={itemClass}>
        <FileUp size={14} className="text-muted" /> Import a world file…
      </M.Item>
    </>
  )
}

const rowItem = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] text-fg outline-none data-[highlighted]:bg-surface-2'

/** On the Welcome screen, beside each world in the list: Export world… and Make a copy (then the list reloads). */
export function WelcomeWorldMenu({ worldId, name, onCopied }: { worldId: ID; name: string; onCopied: () => void }): React.JSX.Element {
  return (
    <M.Root modal={false}>
      <M.Trigger
        aria-label={`More for ${name}`}
        title="Export or copy this world"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint opacity-0 outline-none transition-opacity duration-150 hover:bg-surface-2 hover:text-fg focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/40 group-hover/world:opacity-100 data-[state=open]:bg-surface-2 data-[state=open]:opacity-100"
      >
        <MoreHorizontal size={15} />
      </M.Trigger>
      <M.Portal>
        <M.Content align="end" sideOffset={4} className="z-50 min-w-[200px] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in">
          <M.Item onSelect={() => void exportWorld(worldId)} className={rowItem}>
            <FileDown size={14} className="text-muted" /> Export world…
          </M.Item>
          <M.Item onSelect={() => void copyWorld(worldId).then((made) => made && onCopied())} className={rowItem}>
            <Copy size={14} className="text-muted" /> Make a copy
          </M.Item>
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}

/** On the Welcome screen, under the list of worlds: bring in a world exported on another computer. */
export function ImportWorldButton(): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={<FileUp size={14} />}
      loading={busy}
      title="Open a world exported from AI Write (an .aiwrite file), here or on another computer"
      onClick={() => {
        setBusy(true)
        void importWorld().finally(() => setBusy(false))
      }}
    >
      Import a world file…
    </Button>
  )
}
