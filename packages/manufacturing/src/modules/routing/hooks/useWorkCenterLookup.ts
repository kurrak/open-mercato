'use client'

import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type WorkCenterRecord = {
  id: string
  name: string
  code: string
}

type WorkCenterListItem = {
  id?: string
  name?: string | null
  code?: string | null
}

const EMPTY: ReadonlyMap<string, WorkCenterRecord> = new Map()
const MAX_IDS_PER_REQUEST = 100
const STALE_TIME = 30_000

function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function signatureOf(ids: readonly string[]): string {
  if (ids.length === 0) return ''
  return [...ids].sort().join(',')
}

async function fetchWorkCenters(signature: string): Promise<ReadonlyMap<string, WorkCenterRecord>> {
  if (!signature) return EMPTY
  const idList = signature.split(',').slice(0, MAX_IDS_PER_REQUEST)
  try {
    const data = await readApiResultOrThrow<{ items?: WorkCenterListItem[] }>(
      `/api/routing/work-center?ids=${encodeURIComponent(idList.join(','))}&pageSize=${idList.length}`,
      undefined,
      { errorMessage: 'work center lookup failed' },
    )
    const out = new Map<string, WorkCenterRecord>()
    for (const item of data?.items ?? []) {
      if (typeof item.id === 'string') {
        out.set(item.id, {
          id: item.id,
          name: typeof item.name === 'string' && item.name.length > 0 ? item.name : item.id,
          code: typeof item.code === 'string' ? item.code : '',
        })
      }
    }
    return out
  } catch (err) {
    console.warn('[routing] useWorkCenterLookup: fetch failed', err)
    return EMPTY
  }
}

/**
 * Batch-resolve WorkCenter UUIDs → { name, code }. Used by
 * OperationsTable to render the work-center badge per row when the id
 * might not be in the current search-set cache (e.g. a soft-deleted or
 * inactive WC still referenced by an operation).
 */
export function useWorkCenterLookup(
  workCenterIds: readonly string[],
): ReadonlyMap<string, WorkCenterRecord> {
  const signature = signatureOf(dedupe(workCenterIds))
  const query = useQuery({
    queryKey: ['manufacturing', 'routing', 'work-center-lookup', signature],
    queryFn: () => fetchWorkCenters(signature),
    enabled: signature.length > 0,
    staleTime: STALE_TIME,
  })
  return query.data ?? EMPTY
}
