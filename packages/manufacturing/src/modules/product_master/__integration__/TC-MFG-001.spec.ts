import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  createExtensionFixture,
  deleteExtensionIfExists,
  ensureTenantUom,
} from './helpers/fixtures'

/**
 * TC-MFG-001: Manufacturing extension CRUD is org/tenant-scoped
 *
 * Validates the fix for the cross-tenant lookup vulnerability — update/delete
 * handlers must reject IDs they do not own by returning 404, not silently
 * succeed or return a foreign tenant's data. Also exercises the happy path
 * through the standard makeCrudRoute pipeline.
 */
test.describe('TC-MFG-001: Product manufacturing extension scoped CRUD', () => {
  test('create → fetch → update → delete via scoped endpoints', async ({ request }) => {
    let token: string | null = null
    let productId: string | null = null
    let extensionId: string | null = null
    const suffix = Date.now()

    try {
      token = await getAuthToken(request)
      const uom = await ensureTenantUom(request, token, { code: 'szt', name: 'Sztuka', uomType: 'piece' })
      productId = await createProductFixture(request, token, {
        title: `QA TC-MFG-001 Product ${suffix}`,
        sku: `QA-TCMFG001-${suffix}`,
      })

      const extension = await createExtensionFixture(request, token, {
        productId,
        baseUomId: uom.id,
        procurementType: 'make',
        configurationType: 'none',
        isPhantomDefault: false,
      })
      extensionId = extension.id

      // Happy path: list by productId
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/product-manufacturing-extension?productId=${encodeURIComponent(productId)}&pageSize=10`,
        { token },
      )
      expect(listResponse.ok(), `List failed: ${listResponse.status()}`).toBeTruthy()
      const listBody = (await listResponse.json()) as {
        items?: Array<{ id?: string; product_id?: string; is_phantom_default?: boolean }>
        total?: number
      }
      expect(listBody.total).toBeGreaterThanOrEqual(1)
      const matched = (listBody.items ?? []).find((item) => item.id === extension.id)
      expect(matched, 'Expected created extension in scoped list').toBeTruthy()
      expect(matched?.product_id).toBe(productId)
      expect(matched?.is_phantom_default).toBe(false)

      // Happy path: update flips a scalar field
      const updateResponse = await apiRequest(
        request,
        'PUT',
        '/api/product_master/manufacturing/product-manufacturing-extension',
        {
          token,
          data: {
            id: extension.id,
            isPhantomDefault: true,
            procurementType: 'buy_and_make',
          },
        },
      )
      expect(updateResponse.ok(), `Update failed: ${updateResponse.status()}`).toBeTruthy()

      const verifyUpdate = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/product-manufacturing-extension?productId=${encodeURIComponent(productId)}&pageSize=1`,
        { token },
      )
      expect(verifyUpdate.ok()).toBeTruthy()
      const verifyBody = (await verifyUpdate.json()) as {
        items?: Array<{ is_phantom_default?: boolean; procurement_type?: string }>
      }
      expect(verifyBody.items?.[0]?.is_phantom_default).toBe(true)
      expect(verifyBody.items?.[0]?.procurement_type).toBe('buy_and_make')

      // Scoped lookup: update with a random UUID must not leak behind a 200/500 —
      // the command must return 404 because the lookup filters by org+tenant.
      const foreignId = '00000000-0000-4000-8000-000000000001'
      const updateForeign = await apiRequest(
        request,
        'PUT',
        '/api/product_master/manufacturing/product-manufacturing-extension',
        {
          token,
          data: { id: foreignId, isPhantomDefault: false },
        },
      )
      expect(updateForeign.status()).toBe(404)

      const deleteForeign = await apiRequest(
        request,
        'DELETE',
        `/api/product_master/manufacturing/product-manufacturing-extension?id=${foreignId}`,
        { token },
      )
      expect(deleteForeign.status()).toBe(404)

      // Unauthenticated requests must be rejected
      const anonResponse = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/product-manufacturing-extension?productId=${encodeURIComponent(productId)}`,
        { token: 'definitely-not-a-valid-token' },
      )
      expect(anonResponse.status()).toBe(401)

      // Happy path: delete succeeds on the real id we own
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/product_master/manufacturing/product-manufacturing-extension?id=${encodeURIComponent(extension.id)}`,
        { token },
      )
      expect(deleteResponse.ok(), `Delete failed: ${deleteResponse.status()}`).toBeTruthy()
      extensionId = null

      const postDeleteList = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/product-manufacturing-extension?productId=${encodeURIComponent(productId)}&pageSize=1`,
        { token },
      )
      expect(postDeleteList.ok()).toBeTruthy()
      const postDeleteBody = (await postDeleteList.json()) as { items?: unknown[]; total?: number }
      expect(postDeleteBody.total ?? 0).toBe(0)
    } finally {
      await deleteExtensionIfExists(request, token, extensionId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
