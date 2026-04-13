'use client'

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

/**
 * Returns true when the product is rule_based and has at least one ConfigAttribute.
 * Used by the foundation Overview tab readiness checklist.
 */
export function useIsConfiguratorReady(
  productId: string | undefined,
  configurationType: string | undefined,
): boolean {
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    if (!productId || configurationType !== 'rule_based') {
      setReady(false)
      return
    }
    let cancelled = false
    readApiResultOrThrow<{ total?: number }>(
      `/api/configurator/manufacturing/config-attribute?productId=${encodeURIComponent(productId)}&pageSize=1&isActive=true`,
      undefined,
      { errorMessage: '' },
    )
      .then((data) => {
        if (cancelled) return
        setReady((data?.total ?? 0) > 0)
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[configurator] failed to check configurator readiness', err)
        setReady(false)
      })
    return () => { cancelled = true }
  }, [productId, configurationType])

  return ready
}
