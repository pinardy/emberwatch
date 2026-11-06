import type { HTMLAttributes } from 'react'

/**
 * A thin progress bar, filled to `value` (0–1, clamped). Spans, so it can sit
 * inside buttons; extra attributes (a role, an aria-label) go on the track.
 */
export function Bar({
  value,
  className,
  ...rest
}: { value: number } & HTMLAttributes<HTMLSpanElement>) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <span className={className ? `bar ${className}` : 'bar'} {...rest}>
      <span className="bar-fill" style={{ width: `${pct}%` }} />
    </span>
  )
}
