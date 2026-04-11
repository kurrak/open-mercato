'use client'

import * as React from 'react'

/**
 * Returns an onKeyDown handler that fires `onSubmit` on Cmd/Ctrl+Enter.
 * Attach to `<DialogContent onKeyDown={...}>` per OM convention.
 */
export function useSubmitShortcut(onSubmit: () => void) {
  return React.useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        onSubmit()
      }
    },
    [onSubmit],
  )
}
