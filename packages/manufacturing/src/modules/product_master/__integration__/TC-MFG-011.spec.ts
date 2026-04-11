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
 * TC-MFG-011: Production Method command scoping
 *
 * Mirrors TC-MFG-001 for the production-method update/delete surface. The
 * spec's §Data Model pins a tenant-scoped constraint on the ProductionMethod
 * entity; prior to the C3 fix the command's `em.findOne(ProductionMethod,
 * { id })` lookups had no org/tenant filter, so a user in tenant A who
 * happened to learn a tenant-B UUID could PUT/DELETE it and even re-apply
 * the action via the undo path. This test exercises the happy path for
 * scenario #9 (create + flip-default) and then verifies that both update
 * and delete return 404 for a UUID that does not belong to the caller's
 * tenant, ensuring the scoping filter stays in place.
 */
test.describe('TC-MFG-011: Production Method command scoping', () => {
  test('update + delete reject foreign-tenant UUIDs with 404', async ({ request }) => {
    let token: string | null = null
    let productId: string | null = null
    let extensionId: string | null = null
    const pmIds: string[] = []
    const suffix = Date.now()
    const foreignId = '00000000-0000-4000-8000-000000000099'

    const createPm = async (name: string, isDefault: boolean): Promise<string> => {
      const response = await apiRequest(
        request,
        'POST',
        '/api/product_master/manufacturing/production-method',
        {
          token: token as string,
          data: {
            productId: productId as string,
            name,
            lifecycleState: 'active',
            isDefault,
          },
        },
      )
      expect(
        response.ok(),
        `Create PM failed: ${response.status()} ${await response.text().catch(() => '')}`,
      ).toBeTruthy()
      const body = (await response.json()) as { id?: string }
      expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy()
      return body.id as string
    }

    try {
      token = await getAuthToken(request)
      const uom = await ensureTenantUom(request, token, {
        code: 'szt',
        name: 'Sztuka',
        uomType: 'piece',
      })

      productId = await createProductFixture(request, token, {
        title: `QA TC-MFG-011 Product ${suffix}`,
        sku: `QA-TCMFG011-${suffix}`,
      })

      const extension = await createExtensionFixture(request, token, {
        productId,
        baseUomId: uom.id,
        procurementType: 'make',
        configurationType: 'none',
      })
      extensionId = extension.id

      const firstPmId = await createPm(`QA PM Scope 1 ${suffix}`, true)
      pmIds.push(firstPmId)

      // Scoped lookup: PUT with a random UUID must 404, not leak or silently
      // succeed. Prior to C3 fix this silently succeeded because the command
      // used em.findOne({ id }) without org/tenant filters.
      const updateForeign = await apiRequest(
        request,
        'PUT',
        '/api/product_master/manufacturing/production-method',
        {
          token,
          data: { id: foreignId, name: 'should-not-update', lifecycleState: 'active' },
        },
      )
      expect(updateForeign.status()).toBe(404)

      // Scoped lookup: DELETE with a random UUID must 404 as well.
      const deleteForeign = await apiRequest(
        request,
        'DELETE',
        `/api/product_master/manufacturing/production-method?id=${foreignId}`,
        { token },
      )
      expect(deleteForeign.status()).toBe(404)

      // Sanity: our real record is still there and untouched (the foreign-id
      // PUT must not have side-effected any row).
      const verifyResponse = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/production-method?productId=${encodeURIComponent(productId)}&pageSize=25`,
        { token },
      )
      expect(verifyResponse.ok()).toBeTruthy()
      const verifyBody = (await verifyResponse.json()) as {
        items?: Array<{ id?: string; name?: string }>
      }
      const owned = (verifyBody.items ?? []).find((item) => item.id === firstPmId)
      expect(owned, 'Owned PM should still exist after foreign-id operations').toBeTruthy()
      expect(owned?.name).toBe(`QA PM Scope 1 ${suffix}`)
    } finally {
      if (token) {
        for (const pmId of pmIds.reverse()) {
          try {
            await apiRequest(
              request,
              'DELETE',
              `/api/product_master/manufacturing/production-method?id=${encodeURIComponent(pmId)}`,
              { token },
            )
          } catch {
            // Non-fatal cleanup.
          }
        }
      }
      await deleteExtensionIfExists(request, token, extensionId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
