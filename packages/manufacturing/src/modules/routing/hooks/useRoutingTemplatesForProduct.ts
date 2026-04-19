'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type RoutingTemplateOption = {
  id: string
  name: string
  isActive: boolean
  version: number
}

type RoutingTemplateListItem = {
  id?: string
  name?: string | null
  is_active?: boolean | null
  version?: number | null
}

async function fetchRoutingTemplatesForProduct(productId: string): Promise<RoutingTemplateOption[]> {
  if (!productId) return []
  const data = await readApiResultOrThrow<{ items?: RoutingTemplateListItem[] }>(
    `/api/routing/routing?productId=${encodeURIComponent(productId)}&pageSize=100&sortField=createdAt&sortDir=asc`,
    undefined,
    { errorMessage: 'routing templates fetch failed' },
  )
  return (data?.items ?? [])
    .filter((item): item is { id: string; name?: string | null; is_active?: boolean | null; version?: number | null } =>
      typeof item.id === 'string',
    )
    .map((item) => ({
      id: item.id,
      name: typeof item.name === 'string' && item.name.length > 0 ? item.name : item.id,
      isActive: item.is_active !== false,
      version: typeof item.version === 'number' ? item.version : 1,
    }))
}

export type RoutingTemplatesForProductResult = {
  options: readonly RoutingTemplateOption[]
  isLoading: boolean
  isError: boolean
  invalidate: () => void
}

/**
 * Loads the RoutingTemplates for a given product. Used by the RoutingTab
 * shell to render the routing selector (when the product has more than one
 * routing) and by downstream dialogs that need a template picker. Focus
 * refetch keeps the list fresh as routings are added/removed.
 */
export function useRoutingTemplatesForProduct(productId: string | null | undefined): RoutingTemplatesForProductResult {
  const queryClient = useQueryClient()
  const resolvedProductId = productId ?? ''
  const queryKey = React.useMemo(
    () => ['manufacturing', 'routing', 'templates-for-product', resolvedProductId] as const,
    [resolvedProductId],
  )

  const query = useQuery({
    queryKey,
    queryFn: () => fetchRoutingTemplatesForProduct(resolvedProductId),
    enabled: resolvedProductId.length > 0,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  return {
    options: query.data ?? [],
    // isLoading (not isFetching): true only when no data yet. Tab-level
    // consumers render <LoadingMessage /> on this flag; if it flipped on
    // every focus refetch (staleTime expired) the whole tab would flash a
    // spinner and hide the already-rendered selector/content.
    isLoading: query.isLoading,
    isError: query.isError,
    invalidate,
  }
}
