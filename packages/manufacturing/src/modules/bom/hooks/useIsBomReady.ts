'use client'

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type BomHeaderListItem = { id?: string; is_active?: boolean | null }
type BomLineListItem = { id?: string }

/**
 * Returns `true` when the product has at least one active BomHeader with at
 * least one non-deleted BomLine. Used by the foundation Overview tab's
 * readiness checklist (see spec b §Readiness checklist integration) —
 * tightens the previous "any PM links a BOM" signal which was a less
 * meaningful proxy.
 *
 * Two sequential fetches: BomHeader list filtered by productId, then
 * BomLine list filtered by the first matching BomHeader's id. The second
 * fetch uses pageSize=1 as an existence probe — we don't need the rows,
 * only the total.
 */
export function useIsBomReady(productId: string | undefined): boolean {
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    if (!productId) {
      setReady(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const headers = await readApiResultOrThrow<{ items?: BomHeaderListItem[] }>(
          `/api/bom/bom?productId=${encodeURIComponent(productId)}&pageSize=100`,
          undefined,
          { errorMessage: 'bom readiness check failed (headers)' },
        )
        const activeHeaders = (headers?.items ?? []).filter((h) => h.is_active !== false)
        if (activeHeaders.length === 0) {
          if (!cancelled) setReady(false)
          return
        }

        // Any active header with at least one non-deleted line → ready.
        // Stop on first hit to keep cold-start cost low for products with
        // many BomHeaders.
        for (const header of activeHeaders) {
          if (cancelled) return
          if (typeof header.id !== 'string') continue
          const lines = await readApiResultOrThrow<{ items?: BomLineListItem[]; total?: number }>(
            `/api/bom/bom-line?bomHeaderId=${encodeURIComponent(header.id)}&pageSize=1`,
            undefined,
            { errorMessage: 'bom readiness check failed (lines)' },
          )
          const hasAtLeastOneLine =
            (typeof lines?.total === 'number' && lines.total > 0) ||
            (Array.isArray(lines?.items) && lines.items.length > 0)
          if (hasAtLeastOneLine) {
            if (!cancelled) setReady(true)
            return
          }
        }

        if (!cancelled) setReady(false)
      } catch (err) {
        console.warn('[bom] useIsBomReady failed', err)
        if (!cancelled) setReady(false)
      }
    })()

    return () => { cancelled = true }
  }, [productId])

  return ready
}
