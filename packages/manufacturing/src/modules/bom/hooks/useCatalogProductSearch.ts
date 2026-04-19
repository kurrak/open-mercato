'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type CatalogProductOption = {
  id: string
  title: string
  sku: string | null
}

type ProductListItem = { id?: string; title?: string | null; sku?: string | null }

const PRODUCTS_CACHE_KEY = ['manufacturing', 'bom-line-dialog', 'products'] as const

async function fetchCatalogProducts(): Promise<CatalogProductOption[]> {
  // Errors propagate — React Query surfaces them to the UI.
  const data = await readApiResultOrThrow<{ items?: ProductListItem[] }>(
    `/api/catalog/products?pageSize=100`,
    undefined,
    { errorMessage: 'catalog products fetch failed' },
  )
  return (data?.items ?? [])
    .filter((item): item is { id: string; title?: string | null; sku?: string | null } => typeof item.id === 'string')
    .map((item) => ({
      id: item.id,
      title: typeof item.title === 'string' && item.title.length > 0 ? item.title : item.id,
      sku: typeof item.sku === 'string' ? item.sku : null,
    }))
}

export type CatalogProductSearchResult = {
  options: readonly CatalogProductOption[]
  isLoading: boolean
  isError: boolean
  invalidate: () => void
}

/**
 * Loads catalog products for the BomLine dialog's Product combobox. Focus-
 * refetch enabled so a product created in a separate tab appears here on
 * return without a page reload. 30s staleTime keeps refetches from firing
 * on every minor focus blur/re-focus.
 */
export function useCatalogProductSearch(): CatalogProductSearchResult {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: PRODUCTS_CACHE_KEY,
    queryFn: fetchCatalogProducts,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: PRODUCTS_CACHE_KEY })
  }, [queryClient])

  return {
    options: query.data ?? [],
    isLoading: query.isFetching,
    isError: query.isError,
    invalidate,
  }
}
