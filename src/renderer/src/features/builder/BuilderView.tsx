// Placeholder from the milestone 3 groundwork; the Builder part replaces this file.
import type { ID } from '@shared/types'
import type { BuilderKind, BuilderStart } from '@shared/contracts/builder'

export function BuilderView(_props: { kind: BuilderKind; entryId: ID | null; start?: BuilderStart }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center text-[13px] text-faint">
      <p>The builder is on its way.</p>
    </div>
  )
}
