import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

export type ConfigAttributeFixture = {
  id: string
  key: string
  productId: string
}

export async function createConfigAttributeFixture(
  request: APIRequestContext,
  token: string,
  input: {
    productId: string
    key: string
    label: string
    attributeType?: string
    allowedValues?: unknown
    materialFilterId?: string | null
    isMandatory?: boolean
    displayOrder?: number
    attributeGroup?: string | null
  },
): Promise<ConfigAttributeFixture> {
  const response = await apiRequest(
    request,
    'POST',
    '/api/configurator/manufacturing/config-attribute',
    {
      token,
      data: {
        productId: input.productId,
        key: input.key,
        label: input.label,
        attributeType: input.attributeType ?? 'enum',
        allowedValues: input.allowedValues ?? null,
        materialFilterId: input.materialFilterId ?? null,
        isMandatory: input.isMandatory ?? true,
        displayOrder: input.displayOrder ?? 0,
        attributeGroup: input.attributeGroup ?? null,
        isActive: true,
      },
    },
  )
  expect(
    response.ok(),
    `Failed to create config attribute: ${response.status()} ${await response.text().catch(() => '')}`,
  ).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy()
  return { id: body.id as string, key: input.key, productId: input.productId }
}

export async function deleteConfigAttributeIfExists(
  request: APIRequestContext,
  token: string | null,
  attributeId: string | null,
): Promise<void> {
  if (!token || !attributeId) return
  try {
    await apiRequest(
      request,
      'DELETE',
      `/api/configurator/manufacturing/config-attribute?id=${encodeURIComponent(attributeId)}`,
      { token },
    )
  } catch {
    // Non-fatal during cleanup — a failing delete usually means the record is already gone.
    return
  }
}

export async function listConfigAttributes(
  request: APIRequestContext,
  token: string,
  productId: string,
): Promise<Array<{ id: string; key: string; display_order: number; attribute_type: string }>> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/configurator/manufacturing/config-attribute?productId=${encodeURIComponent(productId)}&pageSize=100&sortField=displayOrder&sortDir=asc`,
    { token },
  )
  expect(response.ok(), `Failed to list config attributes: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as {
    items?: Array<{ id: string; key: string; display_order: number; attribute_type: string }>
  }
  return body.items ?? []
}

export type BomHeaderFixture = { id: string }

export async function createBomHeaderFixture(
  request: APIRequestContext,
  token: string,
  input: { productId: string; name: string },
): Promise<BomHeaderFixture> {
  const response = await apiRequest(request, 'POST', '/api/bom/bom', {
    token,
    data: {
      productId: input.productId,
      name: input.name,
      bomUsage: 'manufacturing',
      isActive: true,
    },
  })
  expect(
    response.ok(),
    `Failed to create BOM header: ${response.status()} ${await response.text().catch(() => '')}`,
  ).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id === 'string').toBeTruthy()
  return { id: body.id as string }
}

export async function deleteBomHeaderIfExists(
  request: APIRequestContext,
  token: string | null,
  bomHeaderId: string | null,
): Promise<void> {
  if (!token || !bomHeaderId) return
  try {
    await apiRequest(
      request,
      'DELETE',
      `/api/bom/bom?id=${encodeURIComponent(bomHeaderId)}`,
      { token },
    )
  } catch {
    // Non-fatal during cleanup — a failing delete usually means the record is already gone.
    return
  }
}

export async function createBomLineFixture(
  request: APIRequestContext,
  token: string,
  input: {
    bomHeaderId: string
    itemProductId: string
    quantity: number
    variantCondition?: Record<string, unknown> | null
  },
): Promise<{ id: string }> {
  const response = await apiRequest(request, 'POST', '/api/bom/bom-line', {
    token,
    data: {
      bomHeaderId: input.bomHeaderId,
      itemProductId: input.itemProductId,
      quantity: input.quantity,
      lineType: 'material',
      variantCondition: input.variantCondition ?? null,
    },
  })
  expect(
    response.ok(),
    `Failed to create BOM line: ${response.status()} ${await response.text().catch(() => '')}`,
  ).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id === 'string').toBeTruthy()
  return { id: body.id as string }
}

export async function deleteBomLineIfExists(
  request: APIRequestContext,
  token: string | null,
  bomLineId: string | null,
): Promise<void> {
  if (!token || !bomLineId) return
  try {
    await apiRequest(
      request,
      'DELETE',
      `/api/bom/bom-line?id=${encodeURIComponent(bomLineId)}`,
      { token },
    )
  } catch {
    // Non-fatal during cleanup — a failing delete usually means the record is already gone.
    return
  }
}
