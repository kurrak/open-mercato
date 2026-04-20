'use client'

import * as React from 'react'
import { useQueries, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type OperationVariantRow = {
  id: string
  operation_template_id: string
  variant_id: string | null
  variant_condition: unknown
  setup_time_override: string | null
  run_time_override: string | null
  teardown_time_override: string | null
  work_center_override_id: string | null
  piecework_rate_override: string | null
  hourly_rate_override: string | null
  notes: string | null
}

type OperationVariantListItem = {
  id?: string
  operation_template_id?: string | null
  variant_id?: string | null
  variant_condition?: unknown
  setup_time_override?: string | number | null
  run_time_override?: string | number | null
  teardown_time_override?: string | number | null
  work_center_override_id?: string | null
  piecework_rate_override?: string | number | null
  hourly_rate_override?: string | number | null
  notes?: string | null
}

function normalizeNumericString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string' && value.length > 0) return value
  return null
}

export function operationVariantsQueryKey(operationTemplateId: string) {
  return ['manufacturing', 'routing', 'operation-variants', operationTemplateId] as const
}

export function invalidateOperationVariants(queryClient: QueryClient, operationTemplateId: string): void {
  if (!operationTemplateId) return
  queryClient.invalidateQueries({ queryKey: operationVariantsQueryKey(operationTemplateId) })
}

async function fetchVariants(operationTemplateId: string): Promise<OperationVariantRow[]> {
  if (!operationTemplateId) return []
  const data = await readApiResultOrThrow<{ items?: OperationVariantListItem[] }>(
    `/api/routing/operation-variant?operationTemplateId=${encodeURIComponent(operationTemplateId)}&pageSize=100`,
    undefined,
    { errorMessage: 'operation variants fetch failed' },
  )
  return (data?.items ?? [])
    .filter((item): item is { id: string } & OperationVariantListItem => typeof item.id === 'string')
    .map((item) => ({
      id: item.id,
      operation_template_id: typeof item.operation_template_id === 'string' ? item.operation_template_id : operationTemplateId,
      variant_id: typeof item.variant_id === 'string' ? item.variant_id : null,
      variant_condition: item.variant_condition ?? null,
      setup_time_override: normalizeNumericString(item.setup_time_override),
      run_time_override: normalizeNumericString(item.run_time_override),
      teardown_time_override: normalizeNumericString(item.teardown_time_override),
      work_center_override_id: typeof item.work_center_override_id === 'string' ? item.work_center_override_id : null,
      piecework_rate_override: normalizeNumericString(item.piecework_rate_override),
      hourly_rate_override: normalizeNumericString(item.hourly_rate_override),
      notes: typeof item.notes === 'string' ? item.notes : null,
    }))
}

export type OperationVariantsResult = {
  rows: OperationVariantRow[]
  isLoading: boolean
  isError: boolean
  invalidate: () => void
}

/**
 * Loads OperationTemplateVariants for a single operation. Consumed by the
 * variant-overrides dialog — one query per open dialog instance, not a
 * per-row subscription. `invalidate()` refreshes after create / update /
 * delete.
 */
export function useOperationVariants(operationTemplateId: string | null | undefined): OperationVariantsResult {
  const queryClient = useQueryClient()
  const resolvedId = operationTemplateId ?? ''
  const queryKey = React.useMemo(() => operationVariantsQueryKey(resolvedId), [resolvedId])

  const query = useQuery({
    queryKey,
    queryFn: () => fetchVariants(resolvedId),
    enabled: resolvedId.length > 0,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    invalidate,
  }
}

export type OperationVariantCountsResult = {
  countsByOperationId: ReadonlyMap<string, number>
  loadingOperationIds: ReadonlySet<string>
}

/**
 * Batch-fetches OperationTemplateVariant rows for each operation id and
 * returns a count-by-id map. Mirrors BOM's useBomLineVariants pattern —
 * one React Query per id, deduped, suspense-free so the count pill can
 * render progressively. Consumed by the operations table's variants
 * column to show [N] or "None" without an extra per-row subscription.
 */
export function useOperationVariantCounts(operationIds: readonly string[]): OperationVariantCountsResult {
  const uniqueIds = Array.from(
    new Set(operationIds.filter((id) => typeof id === 'string' && id.length > 0)),
  )
  uniqueIds.sort()

  const queries = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: operationVariantsQueryKey(id),
      queryFn: () => fetchVariants(id),
      staleTime: 30_000,
    })),
  }) as UseQueryResult<OperationVariantRow[], Error>[]

  const uniqueIdsKey = uniqueIds.join('|')
  const queriesFingerprint = queries
    .map((q) => `${q.dataUpdatedAt ?? 0}:${q.isFetching ? 'f' : 's'}`)
    .join('|')

  return React.useMemo(() => {
    const countsByOperationId = new Map<string, number>()
    const loadingOperationIds = new Set<string>()
    uniqueIds.forEach((id, index) => {
      const q = queries[index]
      if (q.isFetching) loadingOperationIds.add(id)
      if (q.data) countsByOperationId.set(id, q.data.length)
    })
    return { countsByOperationId, loadingOperationIds } as OperationVariantCountsResult
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueIdsKey, queriesFingerprint])
}
