// A small PNG writer for the screenshots, so they stay small without any image tool to install: the picture as
// 8-bit RGB (no alpha), or with `colours` set, reduced to a palette of that many colours (median cut over the
// picture's own colours, then each pixel to its nearest), with each row's best filter and zlib at its strongest.
import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** Each row filtered with whichever of the five filters gives the smallest sum (the usual heuristic). */
function filterRows(raw: Buffer, width: number, height: number, bpp: number): Buffer {
  const stride = width * bpp
  const out = Buffer.alloc((stride + 1) * height)
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride))
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride)
    const prev = y ? raw.subarray((y - 1) * stride, y * stride) : null
    let best = 0
    let bestSum = Infinity
    // A palette picture's rows go unfiltered (filters mean nothing between palette numbers).
    for (let f = 0; f < (bpp === 1 ? 1 : 5); f++) {
      const c = cand[f]
      let sum = 0
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0
        const b = prev ? prev[i] : 0
        const cc = prev && i >= bpp ? prev[i - bpp] : 0
        let v: number
        if (f === 0) v = row[i]
        else if (f === 1) v = row[i] - a
        else if (f === 2) v = row[i] - b
        else if (f === 3) v = row[i] - ((a + b) >> 1)
        else {
          const p = a + b - cc
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - cc)
          v = row[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc)
        }
        v &= 0xff
        c[i] = v
        sum += v < 128 ? v : 256 - v
        if (sum >= bestSum) break
      }
      if (sum < bestSum) {
        bestSum = sum
        best = f
      }
    }
    // Recompute the winner in full (the loop above may have stopped early for it on a tie).
    const o = y * (stride + 1)
    out[o] = best
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0
      const b = prev ? prev[i] : 0
      const cc = prev && i >= bpp ? prev[i - bpp] : 0
      let v: number
      if (best === 0) v = row[i]
      else if (best === 1) v = row[i] - a
      else if (best === 2) v = row[i] - b
      else if (best === 3) v = row[i] - ((a + b) >> 1)
      else {
        const p = a + b - cc
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - cc)
        v = row[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc)
      }
      out[o + 1 + i] = v & 0xff
    }
  }
  return out
}

/** Median cut over the picture's colours (weighted by how often each appears), to `n` colours. */
function palette(rgb: Buffer, n: number): { colours: number[][]; index: Uint8Array } {
  const counts = new Map<number, number>()
  for (let i = 0; i < rgb.length; i += 3) {
    const k = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2]
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const all = [...counts].map(([k, n]) => ({ c: [(k >> 16) & 255, (k >> 8) & 255, k & 255], w: Math.sqrt(n), k }))
  type Box = typeof all
  // Each box's spread is weighted by the square root of its pixels, so the rare edge colours of text still get room.
  const score = (b: Box): { axis: number; spread: number } => {
    let best = { axis: 0, spread: -1 }
    for (let ax = 0; ax < 3; ax++) {
      let lo = 255
      let hi = 0
      for (const p of b) {
        if (p.c[ax] < lo) lo = p.c[ax]
        if (p.c[ax] > hi) hi = p.c[ax]
      }
      if (hi - lo > best.spread) best = { axis: ax, spread: hi - lo }
    }
    const weight = Math.sqrt(b.reduce((s, p) => s + p.w, 0))
    return { axis: best.axis, spread: best.spread * weight }
  }
  let boxes: Box[] = [all]
  while (boxes.length < n) {
    let pick = -1
    let pickScore = { axis: 0, spread: 0 }
    boxes.forEach((b, i) => {
      if (b.length < 2) return
      const s = score(b)
      if (s.spread > pickScore.spread) {
        pick = i
        pickScore = s
      }
    })
    if (pick < 0) break
    const b = boxes[pick].sort((x, y) => x.c[pickScore.axis] - y.c[pickScore.axis])
    const total = b.reduce((s, p) => s + p.w, 0)
    let acc = 0
    let cut = 1
    for (; cut < b.length - 1; cut++) {
      acc += b[cut - 1].w
      if (acc >= total / 2) break
    }
    boxes = [...boxes.slice(0, pick), b.slice(0, cut), b.slice(cut), ...boxes.slice(pick + 1)]
  }
  const colours = boxes.map((b) => {
    const t = b.reduce((s, p) => s + p.w, 0)
    return [0, 1, 2].map((ax) => Math.round(b.reduce((s, p) => s + p.c[ax] * p.w, 0) / t))
  })
  const near = new Map<number, number>()
  for (const p of all) {
    let best = 0
    let bd = Infinity
    for (let i = 0; i < colours.length; i++) {
      const q = colours[i]
      const d = 2 * (p.c[0] - q[0]) ** 2 + 4 * (p.c[1] - q[1]) ** 2 + 3 * (p.c[2] - q[2]) ** 2
      if (d < bd) {
        bd = d
        best = i
      }
    }
    near.set(p.k, best)
  }
  const index = new Uint8Array(rgb.length / 3)
  for (let i = 0, j = 0; i < rgb.length; i += 3, j++) index[j] = near.get((rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2])!
  return { colours, index }
}

/** Encodes a BGRA bitmap (as Electron's nativeImage.toBitmap gives it on Windows) as a PNG. */
export function encodePng(bgra: Buffer, width: number, height: number, opts: { colours?: number } = {}): Buffer {
  const rgb = Buffer.alloc(width * height * 3)
  for (let i = 0, j = 0; i < bgra.length; i += 4, j += 3) {
    rgb[j] = bgra[i + 2]
    rgb[j + 1] = bgra[i + 1]
    rgb[j + 2] = bgra[i]
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (opts.colours) {
    const { colours, index } = palette(rgb, opts.colours)
    ihdr[9] = 3
    const plte = Buffer.from(colours.flat())
    const data = filterRows(Buffer.from(index), width, height, 1)
    return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', deflateSync(data, { level: 9, memLevel: 9 })), chunk('IEND', Buffer.alloc(0))])
  }
  ihdr[9] = 2
  const data = filterRows(rgb, width, height, 3)
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(data, { level: 9, memLevel: 9 })), chunk('IEND', Buffer.alloc(0))])
}
