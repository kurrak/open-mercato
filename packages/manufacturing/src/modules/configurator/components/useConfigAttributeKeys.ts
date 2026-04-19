'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
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

type ResolvedScope = {
  keys: string[]
  attributesByKey: ReadonlyMap<string, ConfigAttributeMeta>
}

const EMPTY_SCOPE: ResolvedScope = { keys: [], attributesByKey: new Map() }
const STALE_TIME = 30_000

async function fetchConfigAttributeScope(productId: string): Promise<ResolvedScope> {
  try {
    const data = await readApiResultOrThrow<{ items?: ConfigAttributeListItem[] }>(
      `/api/configurator/manufacturing/config-attribute?productId=${encodeURIComponent(productId)}&pageSize=100&isActive=true`,
      undefined,
      { errorMessage: 'configurator scope fetch failed' },
    )
    const items = data?.items ?? []
    const keys: string[] = []
    const map = new Map<string, ConfigAttributeMeta>()
    for (const item of items) {
      const key = typeof item.key === 'string' ? item.key : null
      if (!key) continue
      keys.push(key)
      map.set(key, {
        key,
        attributeType: typeof item.attribute_type === 'string' ? item.attribute_type : '',
        allowedValues: item.allowed_values ?? null,
        productFilterId: typeof item.product_filter_id === 'string' ? item.product_filter_id : null,
      })
    }
    return { keys, attributesByKey: map }
  } catch (err) {
    console.warn('[configurator] failed to load config attribute keys', err)
    return EMPTY_SCOPE
  }
}

/**
 * Loads ConfigAttribute scope for a product — both the list of keys (used by
 * Graceful-Incompleteness "unknown key" warnings) and the richer per-key
 * metadata needed to drive the VariantConditionEditor's per-type value cell.
 *
 * Used by BOM tab (sub-spec b §3) and Routing tab (sub-spec c). Backed by
 * React Query so multiple component instances with the same `productId`
 * (e.g. every rendered row's VariantConditionBadges) share a single fetch.
 */
export function useConfigAttributeKeys(productId: string | undefined): ConfigAttributeKeysResult {
  const query = useQuery({
    queryKey: ['manufacturing', 'configurator', 'attrs', productId ?? ''],
    queryFn: () => fetchConfigAttributeScope(productId!),
    enabled: !!productId,
    staleTime: STALE_TIME,
  })

  return React.useMemo<ConfigAttributeKeysResult>(() => {
    if (!productId) return { keys: [], attributesByKey: EMPTY_SCOPE.attributesByKey, ready: false }
    const scope = query.data ?? EMPTY_SCOPE
    return {
      keys: scope.keys,
      attributesByKey: scope.attributesByKey,
      ready: query.isSuccess || query.isError,
    }
  }, [productId, query.data, query.isSuccess, query.isError])
}
