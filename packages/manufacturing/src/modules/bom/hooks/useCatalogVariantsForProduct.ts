'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type CatalogVariantOption = {
  id: string
  name: string
  sku: string | null
  productId: string
}

type VariantListItem = { id?: string; name?: string | null; sku?: string | null; product_id?: string | null }

async function fetchVariantsForProduct(productId: string): Promise<CatalogVariantOption[]> {
  if (!productId) return []
  // Errors propagate — React Query surfaces them.
  const data = await readApiResultOrThrow<{ items?: VariantListItem[] }>(
    `/api/catalog/variants?productId=${encodeURIComponent(productId)}&pageSize=100`,
    undefined,
    { errorMessage: 'catalog variants fetch failed' },
  )
  return (data?.items ?? [])
    .filter((item): item is { id: string; name?: string | null; sku?: string | null; product_id?: string | null } => typeof item.id === 'string')
    .map((item) => ({
      id: item.id,
      name: typeof item.name === 'string' && item.name.length > 0 ? item.name : item.id,
      sku: typeof item.sku === 'string' ? item.sku : null,
      productId: typeof item.product_id === 'string' ? item.product_id : productId,
    }))
}

export type CatalogVariantsForProductResult = {
  options: readonly CatalogVariantOption[]
  isLoading: boolean
  isError: boolean
  invalidate: () => void
}

/**
 * Loads the variants of a given CatalogProduct for the BomLine dialog's
 * optional ProductVariant picker. Focus-refetch enabled so variants added
 * in a separate tab (catalog product edit page) appear here on return.
 */
export function useCatalogVariantsForProduct(productId: string | null | undefined): CatalogVariantsForProductResult {
  const queryClient = useQueryClient()
  const resolvedProductId = productId ?? ''
  const queryKey = React.useMemo(
    () => ['manufacturing', 'bom-line-dialog', 'variants', resolvedProductId] as const,
    [resolvedProductId],
  )

  const query = useQuery({
    queryKey,
    queryFn: () => fetchVariantsForProduct(resolvedProductId),
    enabled: resolvedProductId.length > 0,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  return {
    options: query.data ?? [],
    isLoading: query.isFetching,
    isError: query.isError,
    invalidate,
  }
}
