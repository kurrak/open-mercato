import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-MFG-004: Work Center master data CRUD
 *
 * Covers spec phase-2 scenario #4: create → verify in list → edit → verify
 * updated fields → delete. Exercises the routing.work_center.manage feature
 * and the scoped makeCrudRoute pipeline.
 */
test.describe('TC-MFG-004: Work Center CRUD', () => {
  test('create → list → update → delete through scoped endpoints', async ({ request }) => {
    let token: string | null = null
    let workCenterId: string | null = null
    const suffix = Date.now()
    const code = `QA-WC-${suffix}`
    const updatedCode = `QA-WC-${suffix}-U`

    try {
      token = await getAuthToken(request)

      const createResponse = await apiRequest(request, 'POST', '/api/routing/work-center', {
        token,
        data: {
          name: `QA Work Center ${suffix}`,
          code,
          capacity: 4,
          efficiencyPercent: 85,
          schedulingMode: 'finite',
          isActive: true,
        },
      })
      expect(
        createResponse.ok(),
        `Create failed: ${createResponse.status()} ${await createResponse.text().catch(() => '')}`,
      ).toBeTruthy()
      const createBody = (await createResponse.json()) as { id?: string }
      expect(typeof createBody.id === 'string' && createBody.id.length > 0).toBeTruthy()
      workCenterId = createBody.id as string

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/routing/work-center?ids=${encodeURIComponent(workCenterId)}&pageSize=1`,
        { token },
      )
      expect(listResponse.ok()).toBeTruthy()
      const listBody = (await listResponse.json()) as {
        items?: Array<{
          id?: string
          name?: string
          code?: string
          capacity?: number
          scheduling_mode?: string
          is_active?: boolean
        }>
      }
      const row = listBody.items?.[0]
      expect(row, 'Expected created work center in scoped list').toBeTruthy()
      expect(row?.id).toBe(workCenterId)
      expect(row?.code).toBe(code)
      expect(row?.capacity).toBe(4)
      expect(row?.scheduling_mode).toBe('finite')
      expect(row?.is_active).toBe(true)

      const updateResponse = await apiRequest(request, 'PUT', '/api/routing/work-center', {
        token,
        data: {
          id: workCenterId,
          code: updatedCode,
          capacity: 8,
          efficiencyPercent: 90,
          schedulingMode: 'infinite',
        },
      })
      expect(
        updateResponse.ok(),
        `Update failed: ${updateResponse.status()} ${await updateResponse.text().catch(() => '')}`,
      ).toBeTruthy()

      const verifyResponse = await apiRequest(
        request,
        'GET',
        `/api/routing/work-center?ids=${encodeURIComponent(workCenterId)}&pageSize=1`,
        { token },
      )
      expect(verifyResponse.ok()).toBeTruthy()
      const verifyBody = (await verifyResponse.json()) as {
        items?: Array<{
          code?: string
          capacity?: number
          efficiency_percent?: number
          scheduling_mode?: string
        }>
      }
      const updated = verifyBody.items?.[0]
      expect(updated?.code).toBe(updatedCode)
      expect(updated?.capacity).toBe(8)
      expect(updated?.efficiency_percent).toBe(90)
      expect(updated?.scheduling_mode).toBe('infinite')

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/routing/work-center?id=${encodeURIComponent(workCenterId)}`,
        { token },
      )
      expect(
        deleteResponse.ok(),
        `Delete failed: ${deleteResponse.status()}`,
      ).toBeTruthy()
      workCenterId = null

      const postDeleteList = await apiRequest(
        request,
        'GET',
        `/api/routing/work-center?ids=${encodeURIComponent(createBody.id as string)}&pageSize=1`,
        { token },
      )
      expect(postDeleteList.ok()).toBeTruthy()
      const postDeleteBody = (await postDeleteList.json()) as { items?: unknown[]; total?: number }
      expect(postDeleteBody.total ?? 0).toBe(0)
    } finally {
      if (token && workCenterId) {
        try {
          await apiRequest(
            request,
            'DELETE',
            `/api/routing/work-center?id=${encodeURIComponent(workCenterId)}`,
            { token },
          )
        } catch {
          // Non-fatal cleanup — record may already be deleted by the happy path.
        }
      }
    }
  })
})
