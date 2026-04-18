'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

// Minimal view of a CatalogProduct / CatalogProductVariant that the BOM-side
// VariantConditionBadges need to render "key: displayName" pills when the key
// is a product / product_variant type. We only need the id + a human label;
// everything else stays on the catalog side.
export type CatalogProductSummary = {
  id: string
  title: string
}

export type CatalogProductVariantSummary = {
  id: string
  name: string
  productId: string
}

export type CatalogLookupResult = {
  productsById: ReadonlyMap<string, CatalogProductSummary>
  variantsById: ReadonlyMap<string, CatalogProductVariantSummary>
  loading: boolean
  error: Error | null
}

const EMPTY_PRODUCTS: ReadonlyMap<string, CatalogProductSummary> = new Map()
const EMPTY_VARIANTS: ReadonlyMap<string, CatalogProductVariantSummary> = new Map()

type ProductListItem = { id?: string; title?: string | null }
type VariantListItem = { id?: string; name?: string | null; product_id?: string | null }

// Catalog list endpoints enforce `pageSize.max = 100` server-side (zod).
// If a single render references more than 100 UUIDs we'd need to chunk;
// for now we clamp and log, which keeps the request valid at a practical
// upper bound well above any realistic BomLine UUID count.
const MAX_IDS_PER_REQUEST = 100

function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

// Stable, order-independent key for React Query cache. Identical UUID sets
// across multiple component instances produce the same key, so React Query
// de-dupes the underlying request and shares the cached result.
function signatureOf(ids: readonly string[]): string {
  if (ids.length === 0) return ''
  const sorted = [...ids].sort()
  return sorted.join(',')
}

async function fetchProductsByIds(signature: string): Promise<ReadonlyMap<string, CatalogProductSummary>> {
  if (!signature) return EMPTY_PRODUCTS
  const idList = signature.split(',')
  if (idList.length > MAX_IDS_PER_REQUEST) {
    console.warn(
      `[bom] useCatalogLookup: ${idList.length} product IDs exceeds pageSize cap (${MAX_IDS_PER_REQUEST}); clamping — chunking is Phase D work`,
    )
  }
  const ids = idList.slice(0, MAX_IDS_PER_REQUEST)
  try {
    const data = await readApiResultOrThrow<{ items?: ProductListItem[] }>(
      `/api/catalog/products?ids=${encodeURIComponent(ids.join(','))}&pageSize=${ids.length}`,
      undefined,
      { errorMessage: 'catalog product batch fetch failed' },
    )
    const out = new Map<string, CatalogProductSummary>()
    for (const item of data?.items ?? []) {
      if (typeof item.id !== 'string') continue
      out.set(item.id, {
        id: item.id,
        title: typeof item.title === 'string' && item.title.length > 0 ? item.title : item.id,
      })
    }
    return out
  } catch (err) {
    console.warn('[bom] useCatalogLookup: product batch fetch failed', err)
    return EMPTY_PRODUCTS
  }
}

async function fetchVariantsByIds(signature: string): Promise<ReadonlyMap<string, CatalogProductVariantSummary>> {
  if (!signature) return EMPTY_VARIANTS
  const idList = signature.split(',')
  if (idList.length > MAX_IDS_PER_REQUEST) {
    console.warn(
      `[bom] useCatalogLookup: ${idList.length} variant IDs exceeds pageSize cap (${MAX_IDS_PER_REQUEST}); clamping`,
    )
  }
  const ids = idList.slice(0, MAX_IDS_PER_REQUEST)
  try {
    const data = await readApiResultOrThrow<{ items?: VariantListItem[] }>(
      `/api/catalog/variants?ids=${encodeURIComponent(ids.join(','))}&pageSize=${ids.length}`,
      undefined,
      { errorMessage: 'catalog variant batch fetch failed' },
    )
    const out = new Map<string, CatalogProductVariantSummary>()
    for (const item of data?.items ?? []) {
      if (typeof item.id !== 'string') continue
      out.set(item.id, {
        id: item.id,
        name: typeof item.name === 'string' && item.name.length > 0 ? item.name : item.id,
        productId: typeof item.product_id === 'string' ? item.product_id : '',
      })
    }
    return out
  } catch (err) {
    console.warn('[bom] useCatalogLookup: variant batch fetch failed', err)
    return EMPTY_VARIANTS
  }
}

/**
 * Batches catalog UUID → display-name lookups for rendered BOM badges. Takes
 * the union of UUIDs referenced across all `VariantConditionBadges` /
 * `VariantConditionEditor` instances and issues at most two requests:
 *
 *   GET /api/catalog/products?ids=uuid1,uuid2,...
 *   GET /api/catalog/variants?ids=uuid1,uuid2,...
 *
 * Backed by React Query so identical UUID sets across components de-dupe
 * automatically (N BOM rows rendering the same variant share one fetch).
 * Missing IDs fall through silently — callers render the UUID with a
 * warning tooltip.
 */
export function useCatalogLookup(
  productIds: readonly string[],
  variantIds: readonly string[],
): CatalogLookupResult {
  const productSig = signatureOf(dedupe(productIds))
  const variantSig = signatureOf(dedupe(variantIds))

  const productsQuery = useQuery({
    queryKey: ['manufacturing', 'bom', 'catalog-lookup', 'products', productSig],
    queryFn: () => fetchProductsByIds(productSig),
    enabled: productSig.length > 0,
    staleTime: 30_000,
  })

  const variantsQuery = useQuery({
    queryKey: ['manufacturing', 'bom', 'catalog-lookup', 'variants', variantSig],
    queryFn: () => fetchVariantsByIds(variantSig),
    enabled: variantSig.length > 0,
    staleTime: 30_000,
  })

  return React.useMemo(
    () => ({
      productsById: productsQuery.data ?? EMPTY_PRODUCTS,
      variantsById: variantsQuery.data ?? EMPTY_VARIANTS,
      loading: productsQuery.isFetching || variantsQuery.isFetching,
      error: (productsQuery.error as Error | null) ?? (variantsQuery.error as Error | null) ?? null,
    }),
    [
      productsQuery.data,
      productsQuery.isFetching,
      productsQuery.error,
      variantsQuery.data,
      variantsQuery.isFetching,
      variantsQuery.error,
    ],
  )
}
