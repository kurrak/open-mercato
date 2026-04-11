import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-MFG-005: Factory Zone master data CRUD
 *
 * Covers spec phase-2 scenario #5: create → verify in list → update → delete.
 * Exercises the routing.factory_zone.manage feature (added 2026-04-11 as the
 * correct guard for this endpoint — see the spec's Migration & Backward
 * Compatibility section).
 */
test.describe('TC-MFG-005: Factory Zone CRUD', () => {
  test('create → list → update → delete through scoped endpoints', async ({ request }) => {
    let token: string | null = null
    let factoryZoneId: string | null = null
    const suffix = Date.now()
    const code = `QA-FZ-${suffix}`
    const updatedName = `QA Factory Zone Updated ${suffix}`

    try {
      token = await getAuthToken(request)

      const createResponse = await apiRequest(request, 'POST', '/api/routing/factory-zone', {
        token,
        data: {
          name: `QA Factory Zone ${suffix}`,
          code,
          isActive: true,
        },
      })
      expect(
        createResponse.ok(),
        `Create failed: ${createResponse.status()} ${await createResponse.text().catch(() => '')}`,
      ).toBeTruthy()
      const createBody = (await createResponse.json()) as { id?: string }
      expect(typeof createBody.id === 'string' && createBody.id.length > 0).toBeTruthy()
      factoryZoneId = createBody.id as string

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/routing/factory-zone?ids=${encodeURIComponent(factoryZoneId)}&pageSize=1`,
        { token },
      )
      expect(listResponse.ok()).toBeTruthy()
      const listBody = (await listResponse.json()) as {
        items?: Array<{ id?: string; code?: string; name?: string; is_active?: boolean }>
      }
      const row = listBody.items?.[0]
      expect(row, 'Expected created factory zone in scoped list').toBeTruthy()
      expect(row?.id).toBe(factoryZoneId)
      expect(row?.code).toBe(code)
      expect(row?.is_active).toBe(true)

      const updateResponse = await apiRequest(request, 'PUT', '/api/routing/factory-zone', {
        token,
        data: {
          id: factoryZoneId,
          name: updatedName,
          isActive: false,
        },
      })
      expect(
        updateResponse.ok(),
        `Update failed: ${updateResponse.status()} ${await updateResponse.text().catch(() => '')}`,
      ).toBeTruthy()

      const verifyResponse = await apiRequest(
        request,
        'GET',
        `/api/routing/factory-zone?ids=${encodeURIComponent(factoryZoneId)}&pageSize=1`,
        { token },
      )
      expect(verifyResponse.ok()).toBeTruthy()
      const verifyBody = (await verifyResponse.json()) as {
        items?: Array<{ name?: string; is_active?: boolean }>
      }
      const updated = verifyBody.items?.[0]
      expect(updated?.name).toBe(updatedName)
      expect(updated?.is_active).toBe(false)

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/routing/factory-zone?id=${encodeURIComponent(factoryZoneId)}`,
        { token },
      )
      expect(
        deleteResponse.ok(),
        `Delete failed: ${deleteResponse.status()}`,
      ).toBeTruthy()
      const deletedId = factoryZoneId
      factoryZoneId = null

      const postDeleteList = await apiRequest(
        request,
        'GET',
        `/api/routing/factory-zone?ids=${encodeURIComponent(deletedId)}&pageSize=1`,
        { token },
      )
      expect(postDeleteList.ok()).toBeTruthy()
      const postDeleteBody = (await postDeleteList.json()) as { items?: unknown[]; total?: number }
      expect(postDeleteBody.total ?? 0).toBe(0)
    } finally {
      if (token && factoryZoneId) {
        try {
          await apiRequest(
            request,
            'DELETE',
            `/api/routing/factory-zone?id=${encodeURIComponent(factoryZoneId)}`,
            { token },
          )
        } catch {
          // Non-fatal cleanup — record may already be deleted by the happy path.
        }
      }
    }
  })
})
