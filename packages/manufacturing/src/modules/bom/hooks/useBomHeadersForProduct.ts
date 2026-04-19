'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type BomHeaderOptionWithFlags = {
  id: string
  name: string
  bomUsage: string
  isActive: boolean
  isPhantom: boolean
}

type BomHeaderListItem = {
  id?: string
  name?: string | null
  bom_usage?: string | null
  is_active?: boolean | null
  is_phantom?: boolean | null
}

async function fetchBomHeadersForProduct(productId: string): Promise<BomHeaderOptionWithFlags[]> {
  if (!productId) return []
  // Errors propagate — React Query surfaces them.
  const data = await readApiResultOrThrow<{ items?: BomHeaderListItem[] }>(
    `/api/bom/bom?productId=${encodeURIComponent(productId)}&pageSize=100&sortField=createdAt&sortDir=asc`,
    undefined,
    { errorMessage: 'bom headers fetch failed' },
  )
  return (data?.items ?? [])
    .filter((item): item is { id: string; name?: string | null; bom_usage?: string | null; is_active?: boolean | null; is_phantom?: boolean | null } =>
      typeof item.id === 'string',
    )
    .map((item) => ({
      id: item.id,
      name: typeof item.name === 'string' && item.name.length > 0 ? item.name : item.id,
      bomUsage: typeof item.bom_usage === 'string' ? item.bom_usage : 'production',
      isActive: item.is_active !== false,
      isPhantom: item.is_phantom === true,
    }))
}

export type BomHeadersForProductResult = {
  options: readonly BomHeaderOptionWithFlags[]
  isLoading: boolean
  isError: boolean
  invalidate: () => void
}

/**
 * Loads the BomHeaders for a given CatalogProduct. Used by the BomLine
 * dialog's child BOM picker on `semi_product` lines. Focus-refetch keeps
 * the list fresh when BomHeaders are added in other tabs or in-place via
 * the nested "Create BOM" mini-dialog — `invalidate()` is also exposed so
 * the create flow can force-refresh immediately on success.
 */
export function useBomHeadersForProduct(productId: string | null | undefined): BomHeadersForProductResult {
  const queryClient = useQueryClient()
  const resolvedProductId = productId ?? ''
  const queryKey = React.useMemo(
    () => ['manufacturing', 'bom-line-dialog', 'child-bom-headers', resolvedProductId] as const,
    [resolvedProductId],
  )

  const query = useQuery({
    queryKey,
    queryFn: () => fetchBomHeadersForProduct(resolvedProductId),
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
