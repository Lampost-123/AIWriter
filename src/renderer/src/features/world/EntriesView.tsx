// PLACEHOLDER — OWNED BY THE MEMORY WORKER. Replace this file; keep the export name and props.
import type { EntryKind, ID } from '@shared/types'

export function EntriesView({ kind, entryId }: { kind: EntryKind; entryId: ID | null }): React.JSX.Element {
  return <div className="p-8 text-muted">{kind} {entryId}</div>
}
