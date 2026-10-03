// Folder names a world may never take in the library: Recently deleted (where deleted worlds wait) and the
// hidden folders an import or copy is unpacked into. Used by every place that names a new world folder
// (world.ts, transfer/worldFile.ts, setup/library.ts, restoring a deleted world). Imports nothing heavy.
import { DELETED_WORLDS_FOLDER } from '@shared/contracts/library'

/** True for a name a world folder directly inside the library must never have. */
export const isReservedName = (name: string): boolean =>
  name.toLowerCase() === DELETED_WORLDS_FOLDER.toLowerCase() || name.startsWith('.aiwrite-')
