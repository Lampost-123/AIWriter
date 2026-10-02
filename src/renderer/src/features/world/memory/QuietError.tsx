/** A quiet line when part of a page couldn't be loaded, with a way to try again. Never a crash or a red box. */
export function QuietError({ what, message, onRetry }: { what: string; message: string; onRetry: () => void }): React.JSX.Element {
  const text = message.trim()
  return (
    <p role="status" className="animate-fade-in text-[12.5px] leading-relaxed text-muted">
      Couldn't show {what} just now.{text ? ` ${/[.!?]$/.test(text) ? text : `${text}.`}` : ''}{' '}
      <button type="button" onClick={onRetry} className="rounded-sm font-medium text-accent underline-offset-2 hover:underline">
        Try again
      </button>
    </p>
  )
}
