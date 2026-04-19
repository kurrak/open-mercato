'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type OperationTemplateOption = {
  id: string
  name: string
  routingTemplateId: string | null
}

type OperationListItem = {
  id?: string
  name?: string | null
  routing_template_id?: string | null
}

// For the initial implementation we list ALL Operations in the tenant
// (pageSize 100 covers realistic authoring scale and respects the
// server-side listSchema cap). Scoping to operations belonging to the
// product's PM-linked RoutingTemplate(s) is a polish pass once the
// routing-tab UI lands — the API already supports filtering by
// routingTemplateId; the blocker is that routings aren't yet managed
// through the UI for most products.
//
// Errors propagate; React Query surfaces them.
async function fetchOperationTemplates(): Promise<OperationTemplateOption[]> {
  const data = await readApiResultOrThrow<{ items?: OperationListItem[] }>(
    `/api/routing/operation?pageSize=100&sortField=name&sortDir=asc`,
    undefined,
    { errorMessage: 'operation templates fetch failed' },
  )
  return (data?.items ?? [])
    .filter((item): item is { id: string; name?: string | null; routing_template_id?: string | null } =>
      typeof item.id === 'string',
    )
    .map((item) => ({
      id: item.id,
      name: typeof item.name === 'string' && item.name.length > 0 ? item.name : item.id,
      routingTemplateId: typeof item.routing_template_id === 'string' ? item.routing_template_id : null,
    }))
}

const CACHE_KEY = ['manufacturing', 'bom-line-dialog', 'operation-templates'] as const

export type OperationTemplatesForProductResult = {
  options: readonly OperationTemplateOption[]
  isLoading: boolean
  isError: boolean
  invalidate: () => void
}

/**
 * OperationTemplate combobox data source for BomLine dialog's Operation
 * linker. Focus-refetch enabled so operations added on a (future) routing
 * tab in a separate tab appear here on return. In-place create of
 * OperationTemplates is deferred until the routing-tab UI lands — see
 * BomLineDialog.tsx for the disabled `[+]` button placeholder.
 *
 * Future signature: once the routing tab ships, this hook will scope the
 * query to operations belonging to the product's PM-linked
 * `routingTemplateId`s — tracked in spec b §5 and in the "Deferred from
 * C3" note in the Moldo Phase C plan. Current call sites already pass
 * `productId`; the plumbing lives in `BomLineDialog.tsx` ready to light
 * up when the hook uses it.
 */
export function useOperationTemplatesForProduct(productId: string): OperationTemplatesForProductResult {
  // TODO: scope by PM-linked routingTemplateId once the routing tab UI ships.
  // Keeping `productId` in the signature so call sites don't churn.
  void productId
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: CACHE_KEY,
    queryFn: fetchOperationTemplates,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: CACHE_KEY })
  }, [queryClient])

  return {
    options: query.data ?? [],
    isLoading: query.isFetching,
    isError: query.isError,
    invalidate,
  }
}
