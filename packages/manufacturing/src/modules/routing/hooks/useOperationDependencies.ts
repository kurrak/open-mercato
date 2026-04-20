'use client'

import * as React from 'react'
import { useQueries, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type OperationDependencyRow = {
  id: string
  predecessor_operation_id: string
  successor_operation_id: string
  dependency_type: 'finish_to_start' | 'start_to_start' | 'finish_to_finish'
  link_strength: 'required' | 'optional'
  overlap_quantity: number | null
  overlap_time_minutes: string | null
}

type OperationDependencyListItem = {
  id?: string
  predecessor_operation_id?: string | null
  successor_operation_id?: string | null
  dependency_type?: string | null
  link_strength?: string | null
  overlap_quantity?: number | null
  overlap_time_minutes?: string | number | null
}

const DEPENDENCY_TYPES = ['finish_to_start', 'start_to_start', 'finish_to_finish'] as const
const LINK_STRENGTHS = ['required', 'optional'] as const

function normalizeDependencyType(value: unknown): OperationDependencyRow['dependency_type'] {
  return typeof value === 'string' && (DEPENDENCY_TYPES as readonly string[]).includes(value)
    ? (value as OperationDependencyRow['dependency_type'])
    : 'finish_to_start'
}

function normalizeLinkStrength(value: unknown): OperationDependencyRow['link_strength'] {
  return typeof value === 'string' && (LINK_STRENGTHS as readonly string[]).includes(value)
    ? (value as OperationDependencyRow['link_strength'])
    : 'required'
}

function normalizeNumericString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string' && value.length > 0) return value
  return null
}

export function dependenciesByPredecessorQueryKey(predecessorOperationId: string) {
  return ['manufacturing', 'routing', 'dependencies-by-predecessor', predecessorOperationId] as const
}

export function invalidateDependenciesForRouting(
  queryClient: QueryClient,
  operationIds: readonly string[],
): void {
  for (const id of operationIds) {
    if (typeof id === 'string' && id.length > 0) {
      queryClient.invalidateQueries({ queryKey: dependenciesByPredecessorQueryKey(id) })
    }
  }
}

async function fetchDependenciesForPredecessor(predecessorOperationId: string): Promise<OperationDependencyRow[]> {
  if (!predecessorOperationId) return []
  const data = await readApiResultOrThrow<{ items?: OperationDependencyListItem[] }>(
    `/api/routing/operation-dependency?predecessorOperationId=${encodeURIComponent(predecessorOperationId)}&pageSize=100`,
    undefined,
    { errorMessage: 'operation dependency fetch failed' },
  )
  return (data?.items ?? [])
    .filter((item): item is { id: string } & OperationDependencyListItem => typeof item.id === 'string')
    .map((item) => ({
      id: item.id,
      predecessor_operation_id:
        typeof item.predecessor_operation_id === 'string' ? item.predecessor_operation_id : predecessorOperationId,
      successor_operation_id: typeof item.successor_operation_id === 'string' ? item.successor_operation_id : '',
      dependency_type: normalizeDependencyType(item.dependency_type),
      link_strength: normalizeLinkStrength(item.link_strength),
      overlap_quantity: typeof item.overlap_quantity === 'number' ? item.overlap_quantity : null,
      overlap_time_minutes: normalizeNumericString(item.overlap_time_minutes),
    }))
}

export type OperationDependenciesResult = {
  rows: OperationDependencyRow[]
  isLoading: boolean
  isError: boolean
  invalidate: () => void
}

/**
 * Fetch every OperationDependency in the routing by querying per
 * operation as predecessor (each dep has exactly one predecessor, so
 * combining covers every edge without duplication). Mirrors the
 * BOM useBomLineVariants fan-out pattern — one query per op, deduped
 * by key. Returns all edges flat.
 *
 * The server route has no routingTemplateId filter today, so this fan-
 * out is the simplest way to scope without a round-trip per dep. If
 * routings grow past ~50 ops, fold the loop into a server-side filter.
 */
export function useOperationDependencies(operationIds: readonly string[]): OperationDependenciesResult {
  const queryClient = useQueryClient()
  const uniqueIds = React.useMemo(() => {
    const out = Array.from(new Set(operationIds.filter((id) => typeof id === 'string' && id.length > 0)))
    out.sort()
    return out
  }, [operationIds])

  const queries = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: dependenciesByPredecessorQueryKey(id),
      queryFn: () => fetchDependenciesForPredecessor(id),
      staleTime: 30_000,
    })),
  }) as UseQueryResult<OperationDependencyRow[], Error>[]

  const uniqueIdsKey = uniqueIds.join('|')
  const queriesFingerprint = queries
    .map((q) => `${q.dataUpdatedAt ?? 0}:${q.isFetching ? 'f' : 's'}:${q.isError ? 'e' : 'o'}`)
    .join('|')

  const result = React.useMemo(() => {
    const rows: OperationDependencyRow[] = []
    let isLoading = false
    let isError = false
    uniqueIds.forEach((id, index) => {
      const q = queries[index]
      if (q.isLoading) isLoading = true
      if (q.isError) isError = true
      if (q.data) rows.push(...q.data)
    })
    return { rows, isLoading, isError }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueIdsKey, queriesFingerprint])

  const invalidate = React.useCallback(() => {
    invalidateDependenciesForRouting(queryClient, uniqueIds)
  }, [queryClient, uniqueIds])

  return {
    rows: result.rows,
    isLoading: result.isLoading,
    isError: result.isError,
    invalidate,
  }
}
