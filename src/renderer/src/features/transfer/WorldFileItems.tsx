// The world files in the top bar's world menu (milestone 6, World files and
// export): Export world…, Make a copy and Import a world file….

import * as M from '@radix-ui/react-dropdown-menu'
import { Copy, FileDown, FileUp } from '@/components/ui/icons'
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
