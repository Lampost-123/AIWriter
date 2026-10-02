// Ctrl+Enter (Cmd+Enter on a Mac) marks the open scene done. The page's editor and the window both
// pass the shortcut here; the scene header's Mark done button acts on it. No imports, so the
// editor's extensions stay free of the app around them.

const listeners = new Set<() => void>()

export function requestMarkDone(): void {
  listeners.forEach((l) => l())
}

export function onMarkDoneRequest(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
