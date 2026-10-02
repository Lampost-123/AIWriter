// Makes a picture Adam drops in small enough to keep in the world (a portrait): at most 640 pixels
// on its longer side, as WebP. Done here, where the browser can read any picture format.

/** The longest side of a stored portrait, in pixels. */
export const PORTRAIT_SIZE = 640

/** A picture as AppApi.setEntryImage takes it. */
export interface PreparedImage {
  bytes: Uint8Array
  type: string
}

/** Reads a picture and returns it made small; throws a plain-words error when it isn't one. */
export async function preparePortrait(file: Blob, max = PORTRAIT_SIZE): Promise<PreparedImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('That file isn’t a picture AI Write can show. Try a PNG, JPEG or WebP image.')
  }
  try {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('That picture couldn’t be read. Try another one.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 })
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type || 'image/webp' }
  } finally {
    bitmap.close()
  }
}

/** The first picture among dropped or pasted files, if any. */
export function firstPicture(files: FileList | File[] | null | undefined): File | null {
  return Array.from(files ?? []).find((f) => f.type.startsWith('image/')) ?? null
}
