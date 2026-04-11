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
 * TC-MFG-010: Cross-module catalog ↔ manufacturing linkage
 *
 * Covers spec phase-1 scenario #3 — the Overview tab's "Edit in Catalog →"
 * action relies on the same product id round-tripping through both the
 * catalog list endpoint and the manufacturing catalog-products join. If one
 * side ever desynchronises (for example, tenant scoping diverging between
 * modules, or the enricher returning a different id shape), the link becomes
 * a broken-link surprise in the UI. This test holds both ends by id.
 */
test.describe('TC-MFG-010: Cross-module catalog ↔ manufacturing linkage', () => {
  test('same product id resolves through both catalog and manufacturing endpoints', async ({ request }) => {
    let token: string | null = null
    let productId: string | null = null
    let extensionId: string | null = null
    const suffix = Date.now()

    try {
      token = await getAuthToken(request)
      const uom = await ensureTenantUom(request, token, {
        code: 'szt',
        name: 'Sztuka',
        uomType: 'piece',
      })

      productId = await createProductFixture(request, token, {
        title: `QA TC-MFG-010 Product ${suffix}`,
        sku: `QA-TCMFG010-${suffix}`,
      })

      const extension = await createExtensionFixture(request, token, {
        productId,
        baseUomId: uom.id,
        procurementType: 'make',
        configurationType: 'none',
      })
      extensionId = extension.id

      const catalogResponse = await apiRequest(
        request,
        'GET',
        `/api/catalog/products?id=${encodeURIComponent(productId)}&pageSize=1`,
        { token },
      )
      expect(catalogResponse.ok()).toBeTruthy()
      const catalogBody = (await catalogResponse.json()) as {
        items?: Array<{ id?: string; title?: string }>
      }
      const catalogRow = catalogBody.items?.[0]
      expect(catalogRow?.id).toBe(productId)
      expect(catalogRow?.title).toBe(`QA TC-MFG-010 Product ${suffix}`)

      const manufacturingResponse = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/catalog-products?enrolled=true&id=${encodeURIComponent(productId)}&pageSize=1`,
        { token },
      )
      expect(manufacturingResponse.ok()).toBeTruthy()
      const manufacturingBody = (await manufacturingResponse.json()) as {
        items?: Array<{ id?: string; title?: string; manufacturing_extension_id?: string | null }>
      }
      const manufacturingRow = manufacturingBody.items?.[0]
      expect(manufacturingRow?.id).toBe(productId)
      expect(manufacturingRow?.title).toBe(`QA TC-MFG-010 Product ${suffix}`)
      expect(manufacturingRow?.manufacturing_extension_id).toBe(extension.id)
    } finally {
      await deleteExtensionIfExists(request, token, extensionId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
