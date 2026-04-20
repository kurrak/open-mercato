'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type WorkCenterOption = {
  id: string
  name: string
  code: string
  isActive: boolean
}

type WorkCenterListItem = {
  id?: string
  name?: string | null
  code?: string | null
  is_active?: boolean | null
}

async function fetchWorkCenters(): Promise<WorkCenterOption[]> {
  const data = await readApiResultOrThrow<{ items?: WorkCenterListItem[] }>(
    '/api/routing/work-center?pageSize=100&isActive=true&sortField=name&sortDir=asc',
    undefined,
    { errorMessage: 'work center list fetch failed' },
  )
  return (data?.items ?? [])
    .filter((item): item is { id: string; name?: string | null; code?: string | null; is_active?: boolean | null } =>
      typeof item.id === 'string',
    )
    .map((item) => ({
      id: item.id,
      name: typeof item.name === 'string' && item.name.length > 0 ? item.name : item.id,
      code: typeof item.code === 'string' ? item.code : '',
      isActive: item.is_active !== false,
    }))
}

const CACHE_KEY = ['manufacturing', 'routing', 'work-center-search'] as const

export type WorkCenterSearchResult = {
  options: readonly WorkCenterOption[]
  isLoading: boolean
  isError: boolean
  invalidate: () => void
}

/**
 * Searchable list of active WorkCenters for the Operation dialog's picker
 * field. Capped at pageSize=100 — matches the realistic authoring scale
 * (larger tenants would want server-side search, deferred). Focus refetch
 * enabled so a WC created in another tab surfaces without manual reload.
 *
 * `invalidate()` forces the search list to refetch — call it right after
 * creating a new WC via the inline quick-create so the new row is
 * pickable without waiting for focus-refetch or staleTime.
 */
export function useWorkCenterSearch(): WorkCenterSearchResult {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: CACHE_KEY,
    queryFn: fetchWorkCenters,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })
  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: CACHE_KEY })
  }, [queryClient])
  return {
    options: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    invalidate,
  }
}
