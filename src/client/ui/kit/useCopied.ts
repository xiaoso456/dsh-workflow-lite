/**
 * dsh-workflow-lite — 「已复制」的那一下：复制成功后亮一会儿就回到「复制」；复制的东西换了也马上回去。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/useCopied
 */

import { useEffect, useState } from 'react'

/** 「已复制」亮多久。 */
export const COPIED_MS = 1400

/** 回 `[亮着没有, 复制完告诉它成没成]`；`text` 是复制的东西。 */
export function useCopied(text: string): [boolean, (ok: boolean) => void] {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    setCopied(false)
  }, [text])
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])
  return [copied, setCopied]
}
