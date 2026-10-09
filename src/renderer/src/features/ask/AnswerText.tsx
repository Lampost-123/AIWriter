// An answer's words as the panel shows them: cited names as links (with their card), italics in italics, and a
// list's items hanging beside their marks so a list still reads as one in a narrow panel.
import { cn } from '@/lib/cn'
import { answerLines, answerParagraphs, answerParts, type AnswerPart, type LinkTarget } from './citations'
import { Cite } from './CiteChip'

/** A line's words: cited names as links, and italics in italics. */
export function answerWords(parts: AnswerPart[]): React.ReactNode[] {
  return parts.map((part, i) => {
    const words = part.target ? (
      <Cite key={i} target={part.target}>
        {part.text}
      </Cite>
    ) : (
      part.text
    )
    return part.em ? <em key={i}>{words}</em> : words
  })
}

/** One line of an answer's words (a lead, an option's title, a fact): names and italics, no paragraphs. */
export function InlineWords({ text, index }: { text: string; index: Map<string, LinkTarget> }): React.JSX.Element {
  return <>{answerWords(answerParts(text.replace(/\*\*([^*\n]+?)\*\*/g, '$1'), index))}</>
}

/** A paragraph of an answer, a line at a time. */
export function AnswerParagraph({ parts, className }: { parts: AnswerPart[]; className?: string }): React.JSX.Element {
  const lines = answerLines(parts)
  // The numbers of a numbered list share one width, so the items' words line up.
  const digits = Math.max(1, ...lines.map((l) => l.mark?.match(/\d+/)?.[0].length ?? 0))
  return (
    <div className={cn('whitespace-pre-wrap break-words', className)}>
      {lines.map((line, i) => {
        if (!line.mark) return <div key={i}>{answerWords(line.parts)}</div>
        const hang = /\d/.test(line.mark) ? `${0.6 * digits + 0.75}em` : '1em'
        return (
          <div key={i} style={{ paddingLeft: `calc(${hang} + ${1.2 * line.depth}em)`, textIndent: `-${hang}` }}>
            <span className="inline-block" style={{ width: hang, textIndent: 0 }}>
              {line.mark}
            </span>
            {answerWords(line.parts)}
          </div>
        )
      })}
    </div>
  )
}

/** A stretch of an answer's text, as its paragraphs. */
export function AnswerProse({ text, index, gap }: { text: string; index: Map<string, LinkTarget>; gap: string }): React.JSX.Element {
  const paragraphs = answerParagraphs(text, index)
  return (
    <>
      {paragraphs.map((p, i) => (
        <AnswerParagraph key={i} parts={p} className={i > 0 ? gap : undefined} />
      ))}
    </>
  )
}
