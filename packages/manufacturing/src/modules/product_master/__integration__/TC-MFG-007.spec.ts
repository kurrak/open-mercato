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
 * TC-MFG-007: Consolidated product detail load
 *
 * Covers spec phase-3 scenario #7 — the detail-page shell is powered by a
 * single catalog-products call (post-H4 consolidation). This test verifies
 * the endpoint returns every field the detail page needs in one round trip:
 * catalog id/title/sku, manufacturing_extension_id, and the enriched
 * _manufacturing block with configuration_type, procurement_type, base_uom_id,
 * base_uom_code, is_phantom_default, and production_method_count. A broken
 * shape here wipes the detail page, so regression coverage lives in this test.
 */
test.describe('TC-MFG-007: Consolidated product detail load', () => {
  test('catalog-products?id=... returns product + extension + pm count in one shot', async ({ request }) => {
    let token: string | null = null
    let productId: string | null = null
    let extensionId: string | null = null
    let productionMethodId: string | null = null
    const suffix = Date.now()

    try {
      token = await getAuthToken(request)
      const uom = await ensureTenantUom(request, token, { code: 'szt', name: 'Sztuka', uomType: 'piece' })

      productId = await createProductFixture(request, token, {
        title: `QA TC-MFG-007 Product ${suffix}`,
        sku: `QA-TCMFG007-${suffix}`,
      })

      const extension = await createExtensionFixture(request, token, {
        productId,
        baseUomId: uom.id,
        procurementType: 'make',
        configurationType: 'none',
        isPhantomDefault: true,
      })
      extensionId = extension.id

      const response = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/catalog-products?enrolled=true&id=${encodeURIComponent(productId)}&pageSize=1`,
        { token },
      )
      expect(
        response.ok(),
        `catalog-products failed: ${response.status()} ${await response.text().catch(() => '')}`,
      ).toBeTruthy()
      const body = (await response.json()) as {
        items?: Array<{
          id: string
          title?: string
          sku?: string | null
          manufacturing_extension_id?: string | null
          _manufacturing?: {
            configuration_type?: string | null
            procurement_type?: string | null
            base_uom_id?: string | null
            base_uom_code?: string | null
            is_phantom_default?: boolean
            production_method_count?: number
          } | null
        }>
        total?: number
      }
      expect(body.total).toBe(1)
      const row = body.items?.[0]
      expect(row, 'Expected a single row').toBeTruthy()
      expect(row?.id).toBe(productId)
      expect(row?.title).toBe(`QA TC-MFG-007 Product ${suffix}`)
      expect(row?.sku).toBe(`QA-TCMFG007-${suffix}`)
      expect(row?.manufacturing_extension_id).toBe(extension.id)
      expect(row?._manufacturing).toBeTruthy()
      expect(row?._manufacturing?.configuration_type).toBe('none')
      expect(row?._manufacturing?.procurement_type).toBe('make')
      expect(row?._manufacturing?.base_uom_id).toBe(uom.id)
      expect(row?._manufacturing?.base_uom_code).toBe(uom.code)
      expect(row?._manufacturing?.is_phantom_default).toBe(true)
      expect(row?._manufacturing?.production_method_count).toBe(0)

      // Guard the groupBy lookup itself, not just its absence: create a
      // production method for the product and assert the count increments.
      // Prior to H3 this column was permanently 0 because the API didn't
      // compute it — a test that only checks `=== 0` would have passed
      // against the broken implementation.
      const pmResponse = await apiRequest(
        request,
        'POST',
        '/api/product_master/manufacturing/production-method',
        {
          token,
          data: {
            productId,
            name: `QA TC-MFG-007 PM ${suffix}`,
            lifecycleState: 'active',
          },
        },
      )
      expect(
        pmResponse.ok(),
        `Create PM failed: ${pmResponse.status()} ${await pmResponse.text().catch(() => '')}`,
      ).toBeTruthy()
      const pmBody = (await pmResponse.json()) as { id?: string }
      expect(typeof pmBody.id === 'string' && pmBody.id.length > 0).toBeTruthy()
      productionMethodId = pmBody.id as string

      const withPmResponse = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/catalog-products?enrolled=true&id=${encodeURIComponent(productId)}&pageSize=1`,
        { token },
      )
      expect(withPmResponse.ok()).toBeTruthy()
      const withPmBody = (await withPmResponse.json()) as {
        items?: Array<{ _manufacturing?: { production_method_count?: number } | null }>
      }
      expect(withPmBody.items?.[0]?._manufacturing?.production_method_count).toBe(1)

      // Filtering by a product id that belongs to a different (non-enrolled) product
      // must return an empty page, proving the id filter intersects with the
      // enrolled scope rather than ignoring it.
      const unenrolledProductId = await createProductFixture(request, token, {
        title: `QA TC-MFG-007 Unenrolled ${suffix}`,
        sku: `QA-TCMFG007-U-${suffix}`,
      })
      try {
        const emptyResponse = await apiRequest(
          request,
          'GET',
          `/api/product_master/manufacturing/catalog-products?enrolled=true&id=${encodeURIComponent(unenrolledProductId)}&pageSize=1`,
          { token },
        )
        expect(emptyResponse.ok()).toBeTruthy()
        const emptyBody = (await emptyResponse.json()) as { total?: number; items?: unknown[] }
        expect(emptyBody.total ?? 0).toBe(0)
      } finally {
        await deleteCatalogProductIfExists(request, token, unenrolledProductId)
      }
    } finally {
      if (token && productionMethodId) {
        try {
          await apiRequest(
            request,
            'DELETE',
            `/api/product_master/manufacturing/production-method?id=${encodeURIComponent(productionMethodId)}`,
            { token },
          )
        } catch {
          // Non-fatal cleanup.
        }
      }
      await deleteExtensionIfExists(request, token, extensionId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
