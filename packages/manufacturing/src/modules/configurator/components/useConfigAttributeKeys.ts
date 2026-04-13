'use client'

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type ConfigAttributeKeysResult = {
  keys: string[]
  ready: boolean
}

/**
 * Loads ConfigAttribute keys for a product. Used by BOM tab (sub-spec b) and
 * Routing tab (sub-spec c) to validate variant_condition keys at edit time
 * and display "unknown key" warnings.
 */
export function useConfigAttributeKeys(productId: string | undefined): ConfigAttributeKeysResult {
  const [keys, setKeys] = React.useState<string[]>([])
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    if (!productId) {
      setKeys([])
      setReady(false)
      return
    }
    let cancelled = false
    readApiResultOrThrow<{ items?: Array<{ key: string }> }>(
      `/api/configurator/manufacturing/config-attribute?productId=${encodeURIComponent(productId)}&pageSize=100&isActive=true`,
      undefined,
      { errorMessage: '' },
    )
      .then((data) => {
        if (cancelled) return
        setKeys((data?.items ?? []).map((item) => item.key))
        setReady(true)
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[configurator] failed to load config attribute keys', err)
        setKeys([])
        setReady(true)
      })
    return () => { cancelled = true }
  }, [productId])

  return { keys, ready }
}
