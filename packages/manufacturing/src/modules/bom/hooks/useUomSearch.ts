'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type UomOption = {
  id: string
  code: string
  name: string
  uomType: string | null
}

type UomListItem = {
  id?: string
  code?: string | null
  name?: string | null
  uom_type?: string | null
}

const UOM_CACHE_KEY = ['manufacturing', 'bom-line-dialog', 'uom'] as const

async function fetchUoms(): Promise<UomOption[]> {
  // Errors intentionally propagate — React Query surfaces them to the
  // caller so the UI can render an error hint instead of silently showing
  // an empty combobox (which masked a wrong-endpoint bug during review).
  const data = await readApiResultOrThrow<{ items?: UomListItem[] }>(
    `/api/product_master/manufacturing/unit-of-measure?pageSize=100&isActive=true`,
    undefined,
    { errorMessage: 'uom list fetch failed' },
  )
  return (data?.items ?? [])
    .filter((item): item is { id: string; code?: string | null; name?: string | null; uom_type?: string | null } =>
      typeof item.id === 'string',
    )
    .map((item) => ({
      id: item.id,
      code: typeof item.code === 'string' ? item.code : '',
      name: typeof item.name === 'string' ? item.name : '',
      uomType: typeof item.uom_type === 'string' ? item.uom_type : null,
    }))
}

export type UomSearchResult = {
  options: readonly UomOption[]
  isLoading: boolean
  isError: boolean
  invalidate: () => void
}

/**
 * UoM combobox data source with focus-refetch. UoMs created on the master
 * data page in another tab show up here on tab-return without a reload.
 */
export function useUomSearch(): UomSearchResult {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: UOM_CACHE_KEY,
    queryFn: fetchUoms,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: UOM_CACHE_KEY })
  }, [queryClient])

  return {
    options: query.data ?? [],
    isLoading: query.isFetching,
    isError: query.isError,
    invalidate,
  }
}
