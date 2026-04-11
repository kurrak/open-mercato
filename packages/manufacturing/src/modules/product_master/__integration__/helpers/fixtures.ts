import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

export type ManufacturingExtensionFixture = {
  id: string
  productId: string
  baseUomId: string
}

export type UomFixture = {
  id: string
  code: string
}

async function findUomByCode(
  request: APIRequestContext,
  token: string,
  code: string,
): Promise<{ id: string; code: string } | null> {
  // Intentionally list without a `search=` filter and scan client-side.
  // The list route's buildFilters pushes `search` / `uomType` through the
  // query-index JSONB path, which blows up on ORM fallback in a fresh tenant
  // (SQL references `ei.doc` without joining the entity_indexes table).
  // Listing without filters and matching `code` in JS sidesteps that.
  const listResponse = await apiRequest(
    request,
    'GET',
    '/api/product_master/manufacturing/unit-of-measure?pageSize=100',
    { token },
  )
  if (!listResponse.ok()) return null
  const body = (await listResponse.json()) as { items?: Array<{ id?: string; code?: string }> }
  const match = Array.isArray(body?.items)
    ? body.items.find((item) => item && typeof item.code === 'string' && item.code === code)
    : undefined
  return match?.id ? { id: match.id, code } : null
}

export async function ensureTenantUom(
  request: APIRequestContext,
  token: string,
  options: { code: string; name?: string; uomType?: string },
): Promise<UomFixture> {
  const existing = await findUomByCode(request, token, options.code)
  if (existing) return existing

  const createResponse = await apiRequest(request, 'POST', '/api/product_master/manufacturing/unit-of-measure', {
    token,
    data: {
      code: options.code,
      name: options.name ?? options.code,
      uomType: options.uomType ?? 'piece',
      isActive: true,
    },
  })
  expect(
    createResponse.ok() || createResponse.status() === 409,
    `Failed to ensure UoM fixture: ${createResponse.status()} ${await createResponse.text().catch(() => '')}`,
  ).toBeTruthy()

  const refetched = await findUomByCode(request, token, options.code)
  expect(refetched, `UoM ${options.code} not found after create`).toBeTruthy()
  return refetched as UomFixture
}

export async function createExtensionFixture(
  request: APIRequestContext,
  token: string,
  input: {
    productId: string
    baseUomId: string
    procurementType?: 'make' | 'buy' | 'buy_and_make' | 'service'
    configurationType?: 'none' | 'variant_based' | 'rule_based'
    isPhantomDefault?: boolean
  },
): Promise<ManufacturingExtensionFixture> {
  const response = await apiRequest(
    request,
    'POST',
    '/api/product_master/manufacturing/product-manufacturing-extension',
    {
      token,
      data: {
        productId: input.productId,
        baseUomId: input.baseUomId,
        procurementType: input.procurementType ?? 'make',
        configurationType: input.configurationType ?? 'none',
        isPhantomDefault: input.isPhantomDefault ?? false,
      },
    },
  )
  expect(
    response.ok(),
    `Failed to create extension fixture: ${response.status()} ${await response.text().catch(() => '')}`,
  ).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy()
  return { id: body.id as string, productId: input.productId, baseUomId: input.baseUomId }
}

export async function deleteExtensionIfExists(
  request: APIRequestContext,
  token: string | null,
  extensionId: string | null,
): Promise<void> {
  if (!token || !extensionId) return
  try {
    await apiRequest(
      request,
      'DELETE',
      `/api/product_master/manufacturing/product-manufacturing-extension?id=${encodeURIComponent(extensionId)}`,
      { token },
    )
  } catch {
    // Non-fatal during cleanup — a failing delete usually means the record is already gone
    // from a successful test run; log-and-ignore would just add noise.
    return
  }
}

export async function deleteUomIfExists(
  request: APIRequestContext,
  token: string | null,
  uomId: string | null,
): Promise<void> {
  if (!token || !uomId) return
  try {
    await apiRequest(
      request,
      'DELETE',
      `/api/product_master/manufacturing/unit-of-measure?id=${encodeURIComponent(uomId)}`,
      { token },
    )
  } catch {
    // Non-fatal during cleanup — matches deleteExtensionIfExists semantics.
    return
  }
}

export async function findActionLogByResource(
  request: APIRequestContext,
  token: string,
  params: { resourceKind: string; resourceId: string },
): Promise<{ id: string; undoToken: string | null; executionState: string; snapshotBefore: unknown; snapshotAfter: unknown } | null> {
  const query = new URLSearchParams({
    resourceKind: params.resourceKind,
    resourceId: params.resourceId,
    limit: '10',
  })
  const response = await apiRequest(
    request,
    'GET',
    `/api/audit_logs/audit-logs/actions?${query.toString()}`,
    { token },
  )
  if (!response.ok()) return null
  const body = (await response.json()) as {
    items?: Array<{
      id?: string
      undoToken?: string | null
      executionState?: string
      snapshotBefore?: unknown
      snapshotAfter?: unknown
    }>
  }
  const items = Array.isArray(body?.items) ? body.items : []
  const latest = items[0]
  if (!latest?.id) return null
  return {
    id: latest.id,
    undoToken: latest.undoToken ?? null,
    executionState: latest.executionState ?? 'done',
    snapshotBefore: latest.snapshotBefore,
    snapshotAfter: latest.snapshotAfter,
  }
}
