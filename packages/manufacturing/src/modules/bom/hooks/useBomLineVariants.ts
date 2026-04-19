'use client'

// TODO(perf): one fetch per visible BomLine. Scales poorly on BOMs with
// many lines. See spec b §Future optimizations (deferred) → "Batched
// BomLineVariants fetching" for the suggested direction (plural
// `bomLineIds` filter on the list API, or a bomHeader-scoped variants
// endpoint). Pick up when trigger conditions fire.

import * as React from 'react'
import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type BomLineVariantRow = {
  id: string
  bom_line_id: string
  variant_id: string | null
  variant_condition: unknown
  quantity_override: string | number | null
  product_override_id: string | null
  product_variant_override_id: string | null
  unit_override_id: string | null
  sort_order: number
  notes: string | null
}

const PAGE_SIZE = 100
const STALE_TIME = 30_000

async function fetchVariantsForLine(bomLineId: string): Promise<BomLineVariantRow[]> {
  const params = new URLSearchParams({
    page: '1',
    pageSize: String(PAGE_SIZE),
    bomLineId,
    sortField: 'sortOrder',
    sortDir: 'asc',
  })
  try {
    const data = await readApiResultOrThrow<{ items?: BomLineVariantRow[] }>(
      `/api/bom/bom-line-variant?${params.toString()}`,
      undefined,
      { errorMessage: 'bom line variants fetch failed' },
    )
    return data?.items ?? []
  } catch (err) {
    console.warn(`[bom] useBomLineVariants: fetch failed for ${bomLineId}`, err)
    return []
  }
}

export type BomLineVariantsResult = {
  variantsByLineId: ReadonlyMap<string, BomLineVariantRow[]>
  countsByLineId: ReadonlyMap<string, number>
  loadingLineIds: ReadonlySet<string>
}

/**
 * Batches fetches of BomLineVariants for the given BomLine ids — one React
 * Query per id. Used by the Variants column in §4 tree view to show the
 * `[N]` count badge and the inline overrides section (§6).
 *
 * We fetch variants eagerly for every visible BomLine so the count badge
 * can render on first paint. A future polish (when BOMs grow large) would
 * gate fetching to only lines the user hovers / expands, but the admin-
 * scale cost is negligible today.
 */
export function useBomLineVariants(lineIds: readonly string[]): BomLineVariantsResult {
  const uniqueIds = Array.from(new Set(lineIds.filter((id) => typeof id === 'string' && id.length > 0)))
  uniqueIds.sort()

  const queries = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: ['manufacturing', 'bom', 'line-variants', id] as const,
      queryFn: () => fetchVariantsForLine(id),
      staleTime: STALE_TIME,
    })),
  }) as UseQueryResult<BomLineVariantRow[], Error>[]

  // Stable string fingerprint so downstream useMemo consumers don't
  // invalidate on every render — see useBomLinesByHeader for rationale.
  const uniqueIdsKey = uniqueIds.join('|')
  const queriesFingerprint = queries
    .map((q) => `${q.dataUpdatedAt ?? 0}:${q.isFetching ? 'f' : 's'}`)
    .join('|')

  return React.useMemo(() => {
    const variantsByLineId = new Map<string, BomLineVariantRow[]>()
    const countsByLineId = new Map<string, number>()
    const loadingLineIds = new Set<string>()
    uniqueIds.forEach((id, index) => {
      const q = queries[index]
      if (q.isFetching) loadingLineIds.add(id)
      if (q.data) {
        variantsByLineId.set(id, q.data)
        countsByLineId.set(id, q.data.length)
      }
    })
    return { variantsByLineId, countsByLineId, loadingLineIds } as BomLineVariantsResult
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueIdsKey, queriesFingerprint])
}
