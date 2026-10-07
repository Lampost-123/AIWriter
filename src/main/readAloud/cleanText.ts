// Adapted from mcreader-v2, src/lib/speech/cleanText.ts (reading aloud's own text-to-speech code; Adam's
// rule, 2 October 2026).

/**
 * Makes text sound right when spoken: strips the punctuation a reader sees but a listener should not hear. A
 * speech engine will happily say "asterisk" for a `*`, which is exactly the thing this exists to prevent.
 */
export function cleanForSpeech(text: string): string {
  return calmPunctuation(
    text
      // Characters a page carries that a voice stumbles on: accents in two pieces, invisible joiners and soft hyphens
      // (inside a word they split it), odd spaces, and the ligatures of text copied from a PDF.
      .normalize('NFC')
      .replace(/[­​-‍⁠﻿]/g, '')
      .replace(/[  -   　]/g, ' ')
      .replace(/[ﬀ-ﬆ]/g, (c) => c.normalize('NFKC'))
      // Fenced and inline code: keep the words, drop the fences.
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      // Links: keep the label, drop the target and the image syntax.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // Headings, blockquotes and list bullets.
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s{0,3}[-*+]\s+/gm, '')
      // Emphasis: **bold**, *italic*, _italic_ (keep the words, drop the markers).
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|\W)[*_]([^*_]+)[*_](?=\W|$)/g, '$1$2')
      // A line that is nothing but rules (--- or ___) is a scene break: silent.
      .replace(/^\s*[-—–_~]{3,}\s*$/gm, '')
      // Whatever punctuation is left over: a lone *, a * * * scene break, a ~~word~~.
      .replace(/[*_~]/g, '')
      // Tidy the gaps the removals leave: runs of spaces, and lines left blank.
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n(?:[ \t]*\n)+/g, '\n\n')
      .trim()
  )
}

/**
 * Punctuation the voice can't read as written: Breeze turned ". . .", "????" and "!?!?" into gibberish. Spaced or long
 * runs of dots become one ellipsis, runs of ? and ! one mark (or "?!"), a clip doesn't open on dots, and a clip with no
 * words at all ("...", "?!") says nothing rather than something made up.
 */
export function calmPunctuation(text: string): string {
  const out = text
    .replace(/\.(?:\s+\.)+|\.{4,}/g, '…')
    .replace(/[?!]{2,}/g, (run) => (run.includes('?') && run.includes('!') ? '?!' : run[0]!))
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/^([\s"“”'‘’(]*)(?:\.{2,}|…)\s*/, '$1')
    .replace(/\s+([,.;:?!…])/g, '$1')
    .trim()
  return /[\p{L}\p{N}]/u.test(out) ? out : ''
}
