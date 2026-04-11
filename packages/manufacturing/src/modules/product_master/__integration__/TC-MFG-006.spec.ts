import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-MFG-006: Units of Measure master data CRUD
 *
 * Covers spec phase-2 scenario #6: create a new UoM → verify in list → update
 * the name/active flag → delete. Complements the existing UoM-as-fixture
 * pattern used by TC-MFG-001/002/003 which only `ensureTenantUom(code: 'szt')`.
 */
test.describe('TC-MFG-006: Unit of Measure CRUD', () => {
  test('create → list → update → delete', async ({ request }) => {
    let token: string | null = null
    let uomId: string | null = null
    const suffix = Date.now()
    const code = `qa-uom-${suffix}`.slice(0, 20)
    const updatedName = `QA Updated UoM ${suffix}`

    try {
      token = await getAuthToken(request)

      const createResponse = await apiRequest(
        request,
        'POST',
        '/api/product_master/manufacturing/unit-of-measure',
        {
          token,
          data: {
            code,
            name: `QA Unit ${suffix}`,
            uomType: 'piece',
            isActive: true,
          },
        },
      )
      expect(
        createResponse.ok(),
        `Create failed: ${createResponse.status()} ${await createResponse.text().catch(() => '')}`,
      ).toBeTruthy()
      const createBody = (await createResponse.json()) as { id?: string }
      expect(typeof createBody.id === 'string' && createBody.id.length > 0).toBeTruthy()
      uomId = createBody.id as string

      // The UoM list route can blow up on query-index fallback when filtering
      // by `search=` in a fresh tenant (see helpers/fixtures.ts comment), so
      // scan unfiltered results and match on code client-side.
      const listResponse = await apiRequest(
        request,
        'GET',
        '/api/product_master/manufacturing/unit-of-measure?pageSize=100',
        { token },
      )
      expect(listResponse.ok()).toBeTruthy()
      const listBody = (await listResponse.json()) as {
        items?: Array<{ id?: string; code?: string; name?: string; uom_type?: string; is_active?: boolean }>
      }
      const row = (listBody.items ?? []).find((item) => item.id === uomId)
      expect(row, 'Expected created UoM in scoped list').toBeTruthy()
      expect(row?.code).toBe(code)
      expect(row?.uom_type).toBe('piece')
      expect(row?.is_active).toBe(true)

      const updateResponse = await apiRequest(
        request,
        'PUT',
        '/api/product_master/manufacturing/unit-of-measure',
        {
          token,
          data: {
            id: uomId,
            name: updatedName,
            isActive: false,
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
        '/api/product_master/manufacturing/unit-of-measure?pageSize=100',
        { token },
      )
      expect(verifyResponse.ok()).toBeTruthy()
      const verifyBody = (await verifyResponse.json()) as {
        items?: Array<{ id?: string; name?: string; is_active?: boolean }>
      }
      const updatedRow = (verifyBody.items ?? []).find((item) => item.id === uomId)
      expect(updatedRow?.name).toBe(updatedName)
      expect(updatedRow?.is_active).toBe(false)

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/product_master/manufacturing/unit-of-measure?id=${encodeURIComponent(uomId)}`,
        { token },
      )
      expect(
        deleteResponse.ok(),
        `Delete failed: ${deleteResponse.status()}`,
      ).toBeTruthy()
      const deletedId = uomId
      uomId = null

      const postDeleteList = await apiRequest(
        request,
        'GET',
        '/api/product_master/manufacturing/unit-of-measure?pageSize=100',
        { token },
      )
      expect(postDeleteList.ok()).toBeTruthy()
      const postDeleteBody = (await postDeleteList.json()) as {
        items?: Array<{ id?: string }>
      }
      const stillThere = (postDeleteBody.items ?? []).some((item) => item.id === deletedId)
      expect(stillThere).toBe(false)
    } finally {
      if (token && uomId) {
        try {
          await apiRequest(
            request,
            'DELETE',
            `/api/product_master/manufacturing/unit-of-measure?id=${encodeURIComponent(uomId)}`,
            { token },
          )
        } catch {
          // Non-fatal cleanup.
        }
      }
    }
  })
})
