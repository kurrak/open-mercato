'use client'

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

// Narrow view of a ConfigAttribute that the BOM-side VariantConditionEditor
// needs to drive its per-type value cell: `attributeType` picks the renderer
// (enum → multi-select from allowed_values; product → category-scoped
// combobox over CatalogProducts; etc.); `allowedValues` feeds enum /
// numeric_range renderers; `productFilterId` scopes product / product_variant
// lookups to the same catalog category the Configurator tab used at design
// time.
export type ConfigAttributeMeta = {
  key: string
  attributeType: string
  allowedValues: unknown
  productFilterId: string | null
}

type ConfigAttributeKeysResult = {
  keys: string[]
  attributesByKey: ReadonlyMap<string, ConfigAttributeMeta>
  ready: boolean
}

type ConfigAttributeListItem = {
  key?: string
  attribute_type?: string | null
  allowed_values?: unknown
  product_filter_id?: string | null
}

const EMPTY_MAP: ReadonlyMap<string, ConfigAttributeMeta> = new Map()

/**
 * Loads ConfigAttribute scope for a product — both the list of keys (used by
 * Graceful-Incompleteness "unknown key" warnings) and the richer per-key
 * metadata needed to drive the VariantConditionEditor's per-type value cell.
 *
 * Used by BOM tab (sub-spec b §3) and Routing tab (sub-spec c).
 */
export function useConfigAttributeKeys(productId: string | undefined): ConfigAttributeKeysResult {
  const [state, setState] = React.useState<{ keys: string[]; attributesByKey: ReadonlyMap<string, ConfigAttributeMeta>; ready: boolean }>(
    { keys: [], attributesByKey: EMPTY_MAP, ready: false },
  )

  React.useEffect(() => {
    if (!productId) {
      setState({ keys: [], attributesByKey: EMPTY_MAP, ready: false })
      return
    }
    let cancelled = false
    readApiResultOrThrow<{ items?: ConfigAttributeListItem[] }>(
      `/api/configurator/manufacturing/config-attribute?productId=${encodeURIComponent(productId)}&pageSize=100&isActive=true`,
      undefined,
      { errorMessage: '' },
    )
      .then((data) => {
        if (cancelled) return
        const items = data?.items ?? []
        const nextKeys: string[] = []
        const nextMap = new Map<string, ConfigAttributeMeta>()
        for (const item of items) {
          const key = typeof item.key === 'string' ? item.key : null
          if (!key) continue
          nextKeys.push(key)
          nextMap.set(key, {
            key,
            attributeType: typeof item.attribute_type === 'string' ? item.attribute_type : '',
            allowedValues: item.allowed_values ?? null,
            productFilterId: typeof item.product_filter_id === 'string' ? item.product_filter_id : null,
          })
        }
        setState({ keys: nextKeys, attributesByKey: nextMap, ready: true })
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[configurator] failed to load config attribute keys', err)
        setState({ keys: [], attributesByKey: EMPTY_MAP, ready: true })
      })
    return () => { cancelled = true }
  }, [productId])

  return state
}
