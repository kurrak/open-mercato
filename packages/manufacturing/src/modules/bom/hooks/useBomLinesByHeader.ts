'use client'

import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { BomLineRow } from '../components/BomTreeView'

const PAGE_SIZE = 100
const STALE_TIME = 30_000

async function fetchLinesForHeader(bomHeaderId: string): Promise<BomLineRow[]> {
  const params = new URLSearchParams({
    page: '1',
    pageSize: String(PAGE_SIZE),
    bomHeaderId,
    sortField: 'sortOrder',
    sortDir: 'asc',
  })
  try {
    const data = await readApiResultOrThrow<{ items?: BomLineRow[] }>(
      `/api/bom/bom-line?${params.toString()}`,
      undefined,
      { errorMessage: 'bom child line fetch failed' },
    )
    return data?.items ?? []
  } catch (err) {
    console.warn(`[bom] useBomLinesByHeader: fetch failed for ${bomHeaderId}`, err)
    return []
  }
}

export type BomLinesByHeaderResult = {
  linesByHeader: ReadonlyMap<string, BomLineRow[]>
  loadingHeaderIds: ReadonlySet<string>
}

/**
 * Batches fetches of BomLines for the given child BomHeader ids — one query
 * per id, backed by React Query. Multiple expand clicks queue parallel
 * fetches; identical ids collapse to a single shared request.
 *
 * Used by the recursive tree view (§4): as the user expands `semi_product`
 * rows, their child BomHeader's lines load on demand. Returning a stable
 * Map keyed by bomHeaderId lets the tree's flatten pass look up nested
 * lines without additional state.
 *
 * Returning `loadingHeaderIds` instead of a boolean lets the row
 * rendering show a per-row spinner only for currently-fetching branches,
 * not the whole tree.
 */
export function useBomLinesByHeader(headerIds: readonly string[]): BomLinesByHeaderResult {
  const uniqueIds = Array.from(new Set(headerIds.filter((id) => typeof id === 'string' && id.length > 0)))
  uniqueIds.sort()

  const queries = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: ['manufacturing', 'bom', 'lines-by-header', id] as const,
      queryFn: () => fetchLinesForHeader(id),
      staleTime: STALE_TIME,
    })),
  }) as UseQueryResult<BomLineRow[], Error>[]

  const linesByHeader = new Map<string, BomLineRow[]>()
  const loadingHeaderIds = new Set<string>()
  uniqueIds.forEach((id, index) => {
    const q = queries[index]
    if (q.isFetching) loadingHeaderIds.add(id)
    if (q.data) linesByHeader.set(id, q.data)
  })

  return { linesByHeader, loadingHeaderIds }
}
