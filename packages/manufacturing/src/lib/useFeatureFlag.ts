'use client'

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { hasFeature } from '@open-mercato/shared/security/features'

/**
 * Client-side feature check. POSTs to `/api/auth/feature-check` once on mount
 * (and again if the `feature` arg changes), then resolves `true` when the
 * server says `ok` or the wildcard-aware `hasFeature` matcher accepts the
 * granted set. Returns `false` before the probe completes so callers can safely
 * hide write affordances until the answer lands.
 *
 * Usage:
 *   const canEdit = useFeatureFlag('product_master.edit')
 *   // …
 *   {canEdit ? <Button onClick={save}>Save</Button> : null}
 *
 * Centralises the ~25-line boilerplate that otherwise lived in every backend
 * page that gates write affordances behind an RBAC feature.
 */
export function useFeatureFlag(feature: string): boolean {
  const [granted, setGranted] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const call = await apiCall<{ granted?: string[]; ok?: boolean }>(
          '/api/auth/feature-check',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ features: [feature] }),
          },
        )
        if (cancelled) return
        const grantedList = Array.isArray(call.result?.granted) ? call.result?.granted : []
        setGranted(call.result?.ok === true || hasFeature(grantedList ?? [], feature))
      } catch {
        if (!cancelled) setGranted(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [feature])

  return granted
}
