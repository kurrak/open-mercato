import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  createExtensionFixture,
  deleteExtensionIfExists,
  deleteUomIfExists,
  ensureTenantUom,
} from './helpers/fixtures'

/**
 * TC-MFG-008: Multi-field manufacturing settings save
 *
 * Covers spec phase-3 scenario #8 — the Overview tab's Save button fires a
 * single PUT that must persist procurement_type, configuration_type,
 * base_uom_id, and is_phantom_default together. TC-MFG-001 already exercises
 * one-field updates through the CRUD route; this test verifies the command
 * handler's ManyToOne reassignment path (baseUom rebind via findOne) stays
 * tenant-scoped and actually mutates the DB row.
 */
test.describe('TC-MFG-008: Extension multi-field save', () => {
  test('update procurement/config/baseUom/phantom in one PUT and verify', async ({ request }) => {
    let token: string | null = null
    let productId: string | null = null
    let extensionId: string | null = null
    let secondaryUomId: string | null = null
    const suffix = Date.now()

    try {
      token = await getAuthToken(request)
      const initialUom = await ensureTenantUom(request, token, {
        code: 'szt',
        name: 'Sztuka',
        uomType: 'piece',
      })
      const secondaryUom = await ensureTenantUom(request, token, {
        code: `qa-tcmfg008-${suffix}`.slice(0, 20),
        name: `QA TCMFG-008 Unit ${suffix}`,
        uomType: 'length',
      })
      secondaryUomId = secondaryUom.id

      productId = await createProductFixture(request, token, {
        title: `QA TC-MFG-008 Product ${suffix}`,
        sku: `QA-TCMFG008-${suffix}`,
      })

      const extension = await createExtensionFixture(request, token, {
        productId,
        baseUomId: initialUom.id,
        procurementType: 'make',
        configurationType: 'none',
        isPhantomDefault: false,
      })
      extensionId = extension.id

      const updateResponse = await apiRequest(
        request,
        'PUT',
        '/api/product_master/manufacturing/product-manufacturing-extension',
        {
          token,
          data: {
            id: extension.id,
            procurementType: 'buy_and_make',
            configurationType: 'rule_based',
            baseUomId: secondaryUom.id,
            isPhantomDefault: true,
          },
        },
      )
      expect(
        updateResponse.ok(),
        `Update failed: ${updateResponse.status()} ${await updateResponse.text().catch(() => '')}`,
      ).toBeTruthy()

      const verifyResponse = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/catalog-products?enrolled=true&id=${encodeURIComponent(productId)}&pageSize=1`,
        { token },
      )
      expect(verifyResponse.ok()).toBeTruthy()
      const body = (await verifyResponse.json()) as {
        items?: Array<{
          manufacturing_extension_id?: string | null
          _manufacturing?: {
            procurement_type?: string | null
            configuration_type?: string | null
            base_uom_id?: string | null
            base_uom_code?: string | null
            is_phantom_default?: boolean
          } | null
        }>
      }
      const row = body.items?.[0]
      expect(row?.manufacturing_extension_id).toBe(extension.id)
      expect(row?._manufacturing?.procurement_type).toBe('buy_and_make')
      expect(row?._manufacturing?.configuration_type).toBe('rule_based')
      expect(row?._manufacturing?.base_uom_id).toBe(secondaryUom.id)
      expect(row?._manufacturing?.base_uom_code).toBe(secondaryUom.code)
      expect(row?._manufacturing?.is_phantom_default).toBe(true)
    } finally {
      // Extension first (holds the FK to the UoM via base_uom_id), then the
      // test-scoped UoM created for this run, then the catalog product. The
      // initial `szt` UoM is shared tenant master data and must NOT be
      // deleted here — only the suffix-coded secondary UoM created above.
      await deleteExtensionIfExists(request, token, extensionId)
      await deleteUomIfExists(request, token, secondaryUomId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
