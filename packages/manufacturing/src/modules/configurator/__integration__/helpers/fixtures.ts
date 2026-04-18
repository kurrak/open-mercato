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
    productFilterId?: string | null
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
        productFilterId: input.productFilterId ?? null,
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
