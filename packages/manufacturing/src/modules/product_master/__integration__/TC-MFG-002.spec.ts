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

type CatalogPickerRow = {
  id: string
  title: string
  sku: string | null
  manufacturing_extension_id: string | null
  _manufacturing: {
    procurement_type?: string | null
    base_uom_code?: string | null
    production_method_count?: number
  } | null
}

type CatalogPickerResponse = {
  items: CatalogPickerRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * TC-MFG-002: Catalog-products enrolled/unenrolled join
 *
 * Verifies the custom join endpoint that powers the manufacturing products
 * list (enrolled=true) and the product-picker dialog (enrolled=false).
 * The two modes must be exact complements: an enrolled product MUST appear
 * in the enrolled list and MUST NOT appear in the unenrolled list, and vice
 * versa. Also verifies search narrowing honours the join.
 */
test.describe('TC-MFG-002: Catalog products enrolled/unenrolled join', () => {
  test('enrolled=true and enrolled=false return complementary sets', async ({ request }) => {
    let token: string | null = null
    let enrolledProductId: string | null = null
    let unenrolledProductId: string | null = null
    let extensionId: string | null = null
    const suffix = Date.now()
    const enrolledTitle = `QA TC-MFG-002 Enrolled ${suffix}`
    const unenrolledTitle = `QA TC-MFG-002 Unenrolled ${suffix}`

    try {
      token = await getAuthToken(request)
      const uom = await ensureTenantUom(request, token, { code: 'szt', name: 'Sztuka', uomType: 'piece' })

      enrolledProductId = await createProductFixture(request, token, {
        title: enrolledTitle,
        sku: `QA-TCMFG002-E-${suffix}`,
      })
      unenrolledProductId = await createProductFixture(request, token, {
        title: unenrolledTitle,
        sku: `QA-TCMFG002-U-${suffix}`,
      })

      const extension = await createExtensionFixture(request, token, {
        productId: enrolledProductId,
        baseUomId: uom.id,
        procurementType: 'make',
        configurationType: 'none',
      })
      extensionId = extension.id

      // enrolled=true + search by enrolled title should return the enrolled product with its extension id
      const enrolledResponse = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/catalog-products?enrolled=true&search=${encodeURIComponent(enrolledTitle)}&pageSize=25`,
        { token },
      )
      expect(enrolledResponse.ok(), `enrolled list failed: ${enrolledResponse.status()}`).toBeTruthy()
      const enrolledBody = (await enrolledResponse.json()) as CatalogPickerResponse
      const enrolledHit = enrolledBody.items.find((row) => row.id === enrolledProductId)
      expect(enrolledHit, 'enrolled list must contain the enrolled product').toBeTruthy()
      expect(enrolledHit?.manufacturing_extension_id).toBe(extension.id)
      expect(enrolledHit?._manufacturing?.base_uom_code).toBe(uom.code)
      expect(enrolledHit?._manufacturing?.production_method_count).toBe(0)
      const unenrolledLeak = enrolledBody.items.find((row) => row.id === unenrolledProductId)
      expect(unenrolledLeak, 'enrolled list must NOT contain products without extensions').toBeFalsy()

      // enrolled=false + search by enrolled title should return zero results
      const enrolledTitleUnenrolledFilter = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/catalog-products?enrolled=false&search=${encodeURIComponent(enrolledTitle)}&pageSize=25`,
        { token },
      )
      expect(enrolledTitleUnenrolledFilter.ok()).toBeTruthy()
      const noLeakBody = (await enrolledTitleUnenrolledFilter.json()) as CatalogPickerResponse
      const leaked = noLeakBody.items.find((row) => row.id === enrolledProductId)
      expect(leaked, 'enrolled=false must NOT surface products that have an extension').toBeFalsy()

      // enrolled=false + search by unenrolled title should return the unenrolled product with null extension id
      const unenrolledResponse = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/catalog-products?enrolled=false&search=${encodeURIComponent(unenrolledTitle)}&pageSize=25`,
        { token },
      )
      expect(unenrolledResponse.ok()).toBeTruthy()
      const unenrolledBody = (await unenrolledResponse.json()) as CatalogPickerResponse
      const unenrolledHit = unenrolledBody.items.find((row) => row.id === unenrolledProductId)
      expect(unenrolledHit, 'unenrolled list must contain the unenrolled product').toBeTruthy()
      expect(unenrolledHit?.manufacturing_extension_id).toBeNull()
      expect(unenrolledHit?._manufacturing).toBeNull()

      // After deleting the extension, the formerly-enrolled product should move to enrolled=false
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/product_master/manufacturing/product-manufacturing-extension?id=${encodeURIComponent(extension.id)}`,
        { token },
      )
      expect(deleteResponse.ok(), `delete failed: ${deleteResponse.status()}`).toBeTruthy()
      extensionId = null

      const movedResponse = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/catalog-products?enrolled=false&search=${encodeURIComponent(enrolledTitle)}&pageSize=25`,
        { token },
      )
      expect(movedResponse.ok()).toBeTruthy()
      const movedBody = (await movedResponse.json()) as CatalogPickerResponse
      const movedHit = movedBody.items.find((row) => row.id === enrolledProductId)
      expect(movedHit, 'after delete, product must appear in unenrolled list').toBeTruthy()
      expect(movedHit?.manufacturing_extension_id).toBeNull()

      const stillEnrolled = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/catalog-products?enrolled=true&search=${encodeURIComponent(enrolledTitle)}&pageSize=25`,
        { token },
      )
      expect(stillEnrolled.ok()).toBeTruthy()
      const stillBody = (await stillEnrolled.json()) as CatalogPickerResponse
      const stillHit = stillBody.items.find((row) => row.id === enrolledProductId)
      expect(stillHit, 'deleted extension must drop product from enrolled list').toBeFalsy()
    } finally {
      await deleteExtensionIfExists(request, token, extensionId)
      await deleteCatalogProductIfExists(request, token, enrolledProductId)
      await deleteCatalogProductIfExists(request, token, unenrolledProductId)
    }
  })
})
