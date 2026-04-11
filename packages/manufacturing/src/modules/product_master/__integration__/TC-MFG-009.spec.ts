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
 * TC-MFG-009: Production Method CRUD + set-as-default
 *
 * Covers spec phase-3 scenario #9 — create two production methods for the
 * same manufacturing product, verify both appear on the overview tab's PM
 * list, flip the second one to default, and confirm the first loses its
 * default flag (the command enforces single-default-per-product via the
 * `manufacturing_pm_org_product_default_idx` index).
 */
test.describe('TC-MFG-009: Production method create + set default', () => {
  test('create two PMs → list → set default → verify flip', async ({ request }) => {
    let token: string | null = null
    let productId: string | null = null
    let extensionId: string | null = null
    const pmIds: string[] = []
    const suffix = Date.now()

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
        title: `QA TC-MFG-009 Product ${suffix}`,
        sku: `QA-TCMFG009-${suffix}`,
      })

      const extension = await createExtensionFixture(request, token, {
        productId,
        baseUomId: uom.id,
        procurementType: 'make',
        configurationType: 'none',
      })
      extensionId = extension.id

      const firstPmId = await createPm(`QA PM Primary ${suffix}`, true)
      pmIds.push(firstPmId)
      const secondPmId = await createPm(`QA PM Secondary ${suffix}`, false)
      pmIds.push(secondPmId)

      // Both PMs should be listed for the product, first one as default.
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/production-method?productId=${encodeURIComponent(productId)}&pageSize=25`,
        { token },
      )
      expect(listResponse.ok()).toBeTruthy()
      const listBody = (await listResponse.json()) as {
        items?: Array<{ id?: string; name?: string; is_default?: boolean; lifecycle_state?: string }>
      }
      const items = listBody.items ?? []
      expect(items.length).toBeGreaterThanOrEqual(2)
      const firstBefore = items.find((item) => item.id === firstPmId)
      const secondBefore = items.find((item) => item.id === secondPmId)
      expect(firstBefore?.is_default).toBe(true)
      expect(secondBefore?.is_default).toBe(false)
      expect(firstBefore?.lifecycle_state).toBe('active')

      // Flip the default flag to the second PM.
      const setDefaultResponse = await apiRequest(
        request,
        'PUT',
        '/api/product_master/manufacturing/production-method',
        {
          token,
          data: { id: secondPmId, isDefault: true },
        },
      )
      expect(
        setDefaultResponse.ok(),
        `Set default failed: ${setDefaultResponse.status()} ${await setDefaultResponse
          .text()
          .catch(() => '')}`,
      ).toBeTruthy()

      const verifyResponse = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/production-method?productId=${encodeURIComponent(productId)}&pageSize=25`,
        { token },
      )
      expect(verifyResponse.ok()).toBeTruthy()
      const verifyBody = (await verifyResponse.json()) as {
        items?: Array<{ id?: string; is_default?: boolean }>
      }
      const verifyItems = verifyBody.items ?? []
      const firstAfter = verifyItems.find((item) => item.id === firstPmId)
      const secondAfter = verifyItems.find((item) => item.id === secondPmId)
      expect(
        secondAfter?.is_default,
        'Secondary PM should be marked default after flip',
      ).toBe(true)
      expect(
        firstAfter?.is_default,
        'Primary PM should lose default flag when secondary is promoted',
      ).toBe(false)
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
