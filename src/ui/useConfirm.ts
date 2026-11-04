import { useCallback, useEffect, useState } from 'react'

/** How long a destructive button stays armed after its first click. */
export const CONFIRM_WINDOW_MS = 4000

/**
 * Two-step confirmation for destructive buttons, without a blocking modal: the
 * first click arms the button (so it can say what will happen), a second click
 * within a few seconds runs the action, and otherwise it quietly disarms.
 *
 * `key` scopes the armed state, so arming "demolish" on one building does not
 * carry over when the inspector switches to another.
 */
export function useConfirm(key: string, action: () => void) {
  const [armedKey, setArmedKey] = useState<string | null>(null)
  const armed = armedKey === key

  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmedKey(null), CONFIRM_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [armed])

  const trigger = useCallback(() => {
    if (armed) {
      setArmedKey(null)
      action()
    } else {
      setArmedKey(key)
    }
  }, [armed, action, key])

  const cancel = useCallback(() => setArmedKey(null), [])

  return { armed, trigger, cancel }
}
