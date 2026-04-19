'use client'

import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type RoutingTemplateListItem = { id?: string; name?: string | null }

const EMPTY: ReadonlyMap<string, string> = new Map()
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

async function fetchRoutingNames(signature: string): Promise<ReadonlyMap<string, string>> {
  if (!signature) return EMPTY
  const idList = signature.split(',')
  if (idList.length > MAX_IDS_PER_REQUEST) {
    console.warn(
      `[routing] useRoutingTemplateNamesByIds: ${idList.length} ids exceeds pageSize cap (${MAX_IDS_PER_REQUEST}); clamping`,
    )
  }
  const ids = idList.slice(0, MAX_IDS_PER_REQUEST)
  try {
    const data = await readApiResultOrThrow<{ items?: RoutingTemplateListItem[] }>(
      `/api/routing/routing?ids=${encodeURIComponent(ids.join(','))}&pageSize=${ids.length}`,
      undefined,
      { errorMessage: 'routing template names batch fetch failed' },
    )
    const out = new Map<string, string>()
    for (const item of data?.items ?? []) {
      if (typeof item.id === 'string' && typeof item.name === 'string') {
        out.set(item.id, item.name)
      }
    }
    return out
  } catch (err) {
    console.warn('[routing] useRoutingTemplateNamesByIds: fetch failed', err)
    return EMPTY
  }
}

/**
 * Batch-resolve RoutingTemplate UUIDs → name. Backed by React Query so
 * identical id sets across components share a single fetch. Used by the
 * Overview tab's production-method cards to label each PM with the name of
 * the specific RoutingTemplate it links to (spec c §Readiness checklist
 * integration). Missing ids drop silently — consumers render a fallback.
 */
export function useRoutingTemplateNamesByIds(
  routingTemplateIds: readonly string[],
): ReadonlyMap<string, string> {
  const signature = signatureOf(dedupe(routingTemplateIds))
  const query = useQuery({
    queryKey: ['manufacturing', 'routing', 'template-names-by-id', signature],
    queryFn: () => fetchRoutingNames(signature),
    enabled: signature.length > 0,
    staleTime: STALE_TIME,
  })
  return query.data ?? EMPTY
}
