// Ctrl+Enter (Cmd+Enter on a Mac) accepts the open scene. The page's editor and the window both
// pass the shortcut here; the scene header's Accept button acts on it. No imports, so the editor's
// extensions stay free of the app around them.

const listeners = new Set<() => void>()

export function requestAccept(): void {
  listeners.forEach((l) => l())
}

export function onAcceptRequest(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
