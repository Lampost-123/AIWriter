// Portraits (milestone 3): a picture is made small in the window, kept in the world, and shown
// from its aiwrite-image: address; it survives a restart.
import { binder, createWorldFromWelcome, expect, invoke, test } from './helpers'

/** Makes a 1200 x 800 picture in the window, prepares it as the interface does, and gives it to the entry. Returns the picture's size as shown. */
const givePicture = (id: string): string => `(async () => {
  const canvas = new OffscreenCanvas(1200, 800)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#3d5a80'
  ctx.fillRect(0, 0, 1200, 800)
  const file = await canvas.convertToBlob({ type: 'image/png' })
  const bitmap = await createImageBitmap(file)
  const small = new OffscreenCanvas(640, Math.round(800 * 640 / 1200))
  small.getContext('2d').drawImage(bitmap, 0, 0, small.width, small.height)
  const blob = await small.convertToBlob({ type: 'image/webp', quality: 0.86 })
  const res = await window.aiwrite.invoke('setEntryImage', ${JSON.stringify(id)}, { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type })
  if (!res.ok) throw new Error(res.error.message)
  return res.value.image
})()`

const shownSize = (src: string): string => `new Promise((resolve) => {
  const img = new Image()
  img.onload = () => resolve(img.naturalWidth + 'x' + img.naturalHeight)
  img.onerror = () => resolve('failed')
  img.src = ${JSON.stringify(src)}
})`

test('a portrait is kept in the world and shown from its address, after a restart too', async ({ launch }) => {
  const first = await launch()
  await createWorldFromWelcome(first.win, 'Portraits')
  const mara = await invoke(first.win, 'createEntry', 'character', { name: 'Mara' })
  const image = (await first.win.evaluate(givePicture(mara.id))) as string
  expect(image).toMatch(/^aiwrite-image:\/\/entry\//)
  expect(await first.win.evaluate(shownSize(image))).toBe('640x427')
  await first.close()

  const second = await launch({ dataDir: first.dataDir })
  await expect(binder(second.win)).toBeVisible()
  const [again] = await invoke(second.win, 'listEntries', 'character')
  expect(again.image).toBe(image)
  expect(await second.win.evaluate(shownSize(again.image!))).toBe('640x427')
  // Removing it leaves no picture behind.
  expect((await invoke(second.win, 'setEntryImage', mara.id, null)).image).toBeNull()
  expect(await second.win.evaluate(shownSize(again.image!.replace(/\?v=.*$/, '?v=gone')))).toBe('failed')
})
