'use client'

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type RoutingTemplateListItem = { id?: string; is_active?: boolean | null }
type OperationTemplateListItem = { id?: string }

/**
 * Returns `true` when the product has at least one active RoutingTemplate
 * with at least one non-deleted OperationTemplate. Used by the foundation
 * Overview tab's readiness checklist (spec c §Readiness checklist
 * integration) — tightens the previous "any PM links a routing" signal
 * which was a less meaningful proxy.
 *
 * Mirrors the BOM readiness hook: RoutingTemplate list filtered by
 * productId, then an existence-probe OperationTemplate fetch (pageSize=1)
 * on the first active routing that has operations. Stops on first hit.
 */
export function useIsRoutingReady(productId: string | undefined): boolean {
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    if (!productId) {
      setReady(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const routings = await readApiResultOrThrow<{ items?: RoutingTemplateListItem[] }>(
          `/api/routing/routing?productId=${encodeURIComponent(productId)}&pageSize=100`,
          undefined,
          { errorMessage: 'routing readiness check failed (templates)' },
        )
        const activeRoutings = (routings?.items ?? []).filter((r) => r.is_active !== false)
        if (activeRoutings.length === 0) {
          if (!cancelled) setReady(false)
          return
        }

        for (const routing of activeRoutings) {
          if (cancelled) return
          if (typeof routing.id !== 'string') continue
          const ops = await readApiResultOrThrow<{ items?: OperationTemplateListItem[]; total?: number }>(
            `/api/routing/operation?routingTemplateId=${encodeURIComponent(routing.id)}&pageSize=1`,
            undefined,
            { errorMessage: 'routing readiness check failed (operations)' },
          )
          const hasAtLeastOneOp =
            (typeof ops?.total === 'number' && ops.total > 0) ||
            (Array.isArray(ops?.items) && ops.items.length > 0)
          if (hasAtLeastOneOp) {
            if (!cancelled) setReady(true)
            return
          }
        }

        if (!cancelled) setReady(false)
      } catch (err) {
        console.warn('[routing] useIsRoutingReady failed', err)
        if (!cancelled) setReady(false)
      }
    })()

    return () => { cancelled = true }
  }, [productId])

  return ready
}
