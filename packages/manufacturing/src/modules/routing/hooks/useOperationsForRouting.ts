'use client'

import * as React from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export function operationsByTemplateQueryKey(routingTemplateId: string) {
  return ['manufacturing', 'routing', 'operations-by-template', routingTemplateId] as const
}

/**
 * Cache-invalidation helper — call from components that trigger a write
 * but don't consume the operations list (e.g. RoutingTab). Lets those
 * components avoid mounting a `useOperationsForRouting` subscription
 * purely to grab its `invalidate`.
 */
export function invalidateOperationsForRouting(queryClient: QueryClient, routingTemplateId: string): void {
  if (!routingTemplateId) return
  queryClient.invalidateQueries({ queryKey: operationsByTemplateQueryKey(routingTemplateId) })
}

export type OperationRow = {
  id: string
  routing_template_id: string
  work_center_id: string | null
  sequence: number
  name: string
  setup_time_minutes: string | null
  run_time_minutes: string | null
  teardown_time_minutes: string | null
  queue_time_minutes: string | null
  wait_time_minutes: string | null
  move_time_minutes: string | null
  payment_type: 'hourly' | 'piecework' | 'base_plus_piecework'
  piecework_rate: string | null
  hourly_rate: string | null
  is_subcontracted: boolean
  allow_splitting: boolean
  max_splits: number | null
  setup_group: string | null
  instructions: string | null
  notes: string | null
}

type OperationListItem = {
  id?: string
  routing_template_id?: string | null
  work_center_id?: string | null
  sequence?: number | null
  name?: string | null
  setup_time_minutes?: string | number | null
  run_time_minutes?: string | number | null
  teardown_time_minutes?: string | number | null
  queue_time_minutes?: string | number | null
  wait_time_minutes?: string | number | null
  move_time_minutes?: string | number | null
  payment_type?: string | null
  piecework_rate?: string | number | null
  hourly_rate?: string | number | null
  is_subcontracted?: boolean | null
  allow_splitting?: boolean | null
  max_splits?: number | null
  setup_group?: string | null
  instructions?: string | null
  notes?: string | null
}

const PAYMENT_TYPES = ['hourly', 'piecework', 'base_plus_piecework'] as const
type PaymentType = (typeof PAYMENT_TYPES)[number]

function normalizePaymentType(value: unknown): PaymentType {
  return typeof value === 'string' && (PAYMENT_TYPES as readonly string[]).includes(value)
    ? (value as PaymentType)
    : 'hourly'
}

function normalizeNumericString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string' && value.length > 0) return value
  return null
}

async function fetchOperations(routingTemplateId: string): Promise<OperationRow[]> {
  if (!routingTemplateId) return []
  const data = await readApiResultOrThrow<{ items?: OperationListItem[] }>(
    `/api/routing/operation?routingTemplateId=${encodeURIComponent(routingTemplateId)}&pageSize=100&sortField=sequence&sortDir=asc`,
    undefined,
    { errorMessage: 'operation list fetch failed' },
  )
  return (data?.items ?? [])
    .filter((item): item is { id: string } & OperationListItem => typeof item.id === 'string')
    .map((item) => ({
      id: item.id,
      routing_template_id: typeof item.routing_template_id === 'string' ? item.routing_template_id : routingTemplateId,
      work_center_id: typeof item.work_center_id === 'string' ? item.work_center_id : null,
      sequence: typeof item.sequence === 'number' ? item.sequence : 0,
      name: typeof item.name === 'string' ? item.name : item.id,
      setup_time_minutes: normalizeNumericString(item.setup_time_minutes),
      run_time_minutes: normalizeNumericString(item.run_time_minutes),
      teardown_time_minutes: normalizeNumericString(item.teardown_time_minutes),
      queue_time_minutes: normalizeNumericString(item.queue_time_minutes),
      wait_time_minutes: normalizeNumericString(item.wait_time_minutes),
      move_time_minutes: normalizeNumericString(item.move_time_minutes),
      payment_type: normalizePaymentType(item.payment_type),
      piecework_rate: normalizeNumericString(item.piecework_rate),
      hourly_rate: normalizeNumericString(item.hourly_rate),
      is_subcontracted: item.is_subcontracted === true,
      allow_splitting: item.allow_splitting === true,
      max_splits: typeof item.max_splits === 'number' ? item.max_splits : null,
      setup_group: typeof item.setup_group === 'string' ? item.setup_group : null,
      instructions: typeof item.instructions === 'string' ? item.instructions : null,
      notes: typeof item.notes === 'string' ? item.notes : null,
    }))
}

export type OperationsForRoutingResult = {
  rows: OperationRow[]
  isLoading: boolean
  isError: boolean
  invalidate: () => void
}

/**
 * Loads the OperationTemplates for a given RoutingTemplate. Used by the
 * Operations DataTable under the routing tab. `invalidate()` exposes a
 * refresh hook for the Add/Edit/Delete/Reorder mutations.
 *
 * Returns `isLoading` (query.isLoading, not isFetching) so background
 * refetches don't flash the spinner over already-rendered rows.
 */
export function useOperationsForRouting(routingTemplateId: string | null | undefined): OperationsForRoutingResult {
  const queryClient = useQueryClient()
  const resolvedId = routingTemplateId ?? ''
  const queryKey = React.useMemo(() => operationsByTemplateQueryKey(resolvedId), [resolvedId])

  const query = useQuery({
    queryKey,
    queryFn: () => fetchOperations(resolvedId),
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
