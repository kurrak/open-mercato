'use client'

import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type UomSummary = {
  id: string
  code: string
  name: string
}

type UomListItem = { id?: string; code?: string | null; name?: string | null }

const EMPTY: ReadonlyMap<string, UomSummary> = new Map()

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

async function fetchUomsByIds(signature: string): Promise<ReadonlyMap<string, UomSummary>> {
  if (!signature) return EMPTY
  const ids = signature.split(',').slice(0, 100)
  try {
    const data = await readApiResultOrThrow<{ items?: UomListItem[] }>(
      `/api/product_master/manufacturing/unit-of-measure?ids=${encodeURIComponent(ids.join(','))}&pageSize=${ids.length}`,
      undefined,
      { errorMessage: 'uom batch fetch failed' },
    )
    const out = new Map<string, UomSummary>()
    for (const item of data?.items ?? []) {
      if (typeof item.id !== 'string') continue
      out.set(item.id, {
        id: item.id,
        code: typeof item.code === 'string' ? item.code : '',
        name: typeof item.name === 'string' ? item.name : '',
      })
    }
    return out
  } catch (err) {
    console.warn('[bom] useUomLookup failed', err)
    return EMPTY
  }
}

/**
 * Batch-resolve UoM UUIDs → { code, name } for BOM tree row display. Backed
 * by React Query so the same UoM set across lines de-dupes to a single
 * request and is cached between renders of the same BomTab instance.
 */
export function useUomLookup(uomIds: readonly string[]): ReadonlyMap<string, UomSummary> {
  const signature = signatureOf(dedupe(uomIds))
  const query = useQuery({
    queryKey: ['manufacturing', 'bom', 'uom-lookup', signature],
    queryFn: () => fetchUomsByIds(signature),
    enabled: signature.length > 0,
    staleTime: 60_000,
  })
  return query.data ?? EMPTY
}
