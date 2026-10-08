// Types for worldCode.mjs (plain JS).
export declare const WORLD_CODE: string[]
export declare function worldCodeId(root: string, rev?: string): string
export declare function worldCodeDirty(root: string): boolean
export declare function storyHash(file: string): string
export declare function storyHashes(file: string): string[]
export declare function worldCodeFits(
  root: string,
  saved: { srcTree?: string; worldCode?: string; commit: string; dirty?: boolean },
  here: { srcTree: string; worldCode: string; dirty: boolean }
): { ok: boolean; why: string }
