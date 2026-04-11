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
  findActionLogByResource,
} from './helpers/fixtures'

type ExtensionListResponse = {
  items?: Array<{
    id?: string
    is_phantom_default?: boolean
    procurement_type?: string
  }>
  total?: number
}

/**
 * TC-MFG-003: Product manufacturing extension undo flow
 *
 * Verifies the extension update command is actually undoable end-to-end:
 *  1. Create extension, update a scalar field
 *  2. Fetch the latest action log entry for the resource → it must expose an undoToken
 *  3. POST the undoToken to the undo endpoint
 *  4. Re-read the extension — the mutated field must be reverted to the pre-update value
 */
test.describe('TC-MFG-003: Product manufacturing extension undo flow', () => {
  test('update + undo restores the prior snapshot', async ({ request }) => {
    let token: string | null = null
    let productId: string | null = null
    let extensionId: string | null = null
    const suffix = Date.now()

    try {
      token = await getAuthToken(request)
      const uom = await ensureTenantUom(request, token, { code: 'szt', name: 'Sztuka', uomType: 'piece' })
      productId = await createProductFixture(request, token, {
        title: `QA TC-MFG-003 Product ${suffix}`,
        sku: `QA-TCMFG003-${suffix}`,
      })
      const extension = await createExtensionFixture(request, token, {
        productId,
        baseUomId: uom.id,
        procurementType: 'make',
        configurationType: 'none',
        isPhantomDefault: false,
      })
      extensionId = extension.id

      // Mutate the extension — flip both a boolean and an enum so the snapshot has real content
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
      expect(updateResponse.ok(), `update failed: ${updateResponse.status()}`).toBeTruthy()

      const verifyUpdate = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/product-manufacturing-extension?productId=${encodeURIComponent(productId)}&pageSize=1`,
        { token },
      )
      expect(verifyUpdate.ok()).toBeTruthy()
      const afterUpdate = (await verifyUpdate.json()) as ExtensionListResponse
      expect(afterUpdate.items?.[0]?.is_phantom_default).toBe(true)
      expect(afterUpdate.items?.[0]?.procurement_type).toBe('buy_and_make')

      // Poll the audit log for the update entry — action log writes are enqueued asynchronously
      // by the command subscriber, so the row may not be visible immediately after the mutation
      // returns. This loop waits deterministically for the row to land and is not flake mitigation.
      let log: Awaited<ReturnType<typeof findActionLogByResource>> = null
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        log = await findActionLogByResource(request, token, {
          resourceKind: 'manufacturing.product_manufacturing_extension',
          resourceId: extension.id,
        })
        if (log?.undoToken) break
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      if (!log || !log.undoToken) {
        throw new Error('expected an action log entry with an undo token for the extension update')
      }
      expect(log.executionState).toBe('done')

      const undoResponse = await apiRequest(
        request,
        'POST',
        '/api/audit_logs/audit-logs/actions/undo',
        {
          token,
          data: { undoToken: log.undoToken },
        },
      )
      expect(undoResponse.ok(), `undo failed: ${undoResponse.status()}`).toBeTruthy()

      const verifyUndo = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/product-manufacturing-extension?productId=${encodeURIComponent(productId)}&pageSize=1`,
        { token },
      )
      expect(verifyUndo.ok()).toBeTruthy()
      const afterUndo = (await verifyUndo.json()) as ExtensionListResponse
      expect(afterUndo.items?.[0]?.is_phantom_default).toBe(false)
      expect(afterUndo.items?.[0]?.procurement_type).toBe('make')
    } finally {
      await deleteExtensionIfExists(request, token, extensionId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
