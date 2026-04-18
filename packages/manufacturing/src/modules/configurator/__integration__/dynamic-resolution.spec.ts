import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  createExtensionFixture,
  deleteExtensionIfExists,
  ensureTenantUom,
} from '../../product_master/__integration__/helpers/fixtures'
import {
  createConfigAttributeFixture,
  deleteConfigAttributeIfExists,
  createBomHeaderFixture,
  deleteBomHeaderIfExists,
  createBomLineFixture,
  deleteBomLineIfExists,
  explodeBomAndWait,
} from './helpers/fixtures'

// ---------------------------------------------------------------------------
// Shared setup — rule_based master product for dynamic resolution scenarios
// ---------------------------------------------------------------------------

async function createRuleBasedProduct(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  suffix: string,
): Promise<{ productId: string; extensionId: string; uomId: string }> {
  const uom = await ensureTenantUom(request, token, { code: 'szt', name: 'Sztuka', uomType: 'piece' })
  const productId = await createProductFixture(request, token, {
    title: `QA Dyn-Res ${suffix}`,
    sku: `QA-DYNRES-${suffix}`,
  })
  const extension = await createExtensionFixture(request, token, {
    productId,
    baseUomId: uom.id,
    procurementType: 'make',
    configurationType: 'rule_based',
  })
  return { productId, extensionId: extension.id, uomId: uom.id }
}

// ---------------------------------------------------------------------------
// D-UI-9 / B-UI-14 — 'product' attribute_type → type-directed Step 2 resolution
// ---------------------------------------------------------------------------
//
// Master product has ConfigAttribute(key='legs', attribute_type='product').
// BOM has a dynamic BomLine with product_resolve_key='legs'.
// variantConditions={legs: legProductId} drives explosion Step 2 to look up
// the CatalogProduct by UUID and emit it on the ExplosionLine.

test.describe("D-UI-9 / B-UI-14: 'product' attribute_type → BOM explosion resolves to CatalogProduct", () => {
  test('dynamic BomLine with product_resolve_key resolves to the snapshot product UUID', async ({ request }) => {
    let token: string | null = null
    let masterId: string | null = null
    let extensionId: string | null = null
    let legProductId: string | null = null
    let attributeId: string | null = null
    let bomHeaderId: string | null = null
    let bomLineId: string | null = null
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    try {
      token = await getAuthToken(request)
      const master = await createRuleBasedProduct(request, token, suffix)
      masterId = master.productId
      extensionId = master.extensionId

      // Catalog product that will be resolved at explosion time.
      legProductId = await createProductFixture(request, token, {
        title: `QA Leg ${suffix}`,
        sku: `QA-LEG-${suffix}`,
      })

      const attr = await createConfigAttributeFixture(request, token, {
        productId: masterId,
        key: 'legs',
        label: 'Legs',
        attributeType: 'product',
        isMandatory: true,
        displayOrder: 0,
      })
      attributeId = attr.id

      const bomHeader = await createBomHeaderFixture(request, token, {
        productId: masterId,
        name: `QA BOM ${suffix}`,
      })
      bomHeaderId = bomHeader.id

      const bomLine = await createBomLineFixture(request, token, {
        bomHeaderId: bomHeader.id,
        productResolveKey: 'legs',
        netQuantity: 4,
        uomId: master.uomId,
      })
      bomLineId = bomLine.id

      const result = await explodeBomAndWait(request, token, {
        bomHeaderId: bomHeader.id,
        variantConditions: { legs: legProductId },
      })

      expect(result.lines).toHaveLength(1)
      const line = result.lines[0]
      expect(line.bomLineId).toBe(bomLine.id)
      expect(line.productId).toBe(legProductId)
      // 'product' attribute_type does not carry a variant — null by design.
      expect(line.productVariantId).toBeNull()
      expect(line.quantity).toBe(4)

      // No warnings for a happy-path resolution.
      const lineWarnings = result.warnings.filter((w) => w.bomLineId === bomLine.id)
      expect(lineWarnings).toHaveLength(0)
    } finally {
      await deleteBomLineIfExists(request, token, bomLineId)
      await deleteBomHeaderIfExists(request, token, bomHeaderId)
      await deleteConfigAttributeIfExists(request, token, attributeId)
      await deleteExtensionIfExists(request, token, extensionId)
      await deleteCatalogProductIfExists(request, token, legProductId)
      await deleteCatalogProductIfExists(request, token, masterId)
    }
  })
})

// ---------------------------------------------------------------------------
// D-UI-8 / B-UI-13 — 'product_variant' attribute_type → Step 2 resolves via
// CatalogProductVariant and fills both productId (variant.product.id) AND
// productVariantId on the output.
// ---------------------------------------------------------------------------

test.describe("D-UI-8 / B-UI-13: 'product_variant' attribute_type → explosion fills (productId, productVariantId) pair", () => {
  test('dynamic BomLine resolves variant UUID to parent product + variant pair on the output', async ({ request }) => {
    let token: string | null = null
    let masterId: string | null = null
    let extensionId: string | null = null
    let collectionProductId: string | null = null
    let variantId: string | null = null
    let attributeId: string | null = null
    let bomHeaderId: string | null = null
    let bomLineId: string | null = null
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    try {
      token = await getAuthToken(request)
      const master = await createRuleBasedProduct(request, token, suffix)
      masterId = master.productId
      extensionId = master.extensionId

      // "Collection" product with a specific variant (the fabric colour, etc.)
      collectionProductId = await createProductFixture(request, token, {
        title: `QA Fabric Collection ${suffix}`,
        sku: `QA-FABRIC-${suffix}`,
      })
      variantId = await createVariantFixture(request, token, {
        productId: collectionProductId,
        name: 'Soro 61',
        sku: `QA-FABRIC-SORO61-${suffix}`,
      })

      const attr = await createConfigAttributeFixture(request, token, {
        productId: masterId,
        key: 'fabric',
        label: 'Fabric',
        attributeType: 'product_variant',
        isMandatory: true,
        displayOrder: 0,
      })
      attributeId = attr.id

      const bomHeader = await createBomHeaderFixture(request, token, {
        productId: masterId,
        name: `QA BOM ${suffix}`,
      })
      bomHeaderId = bomHeader.id

      const bomLine = await createBomLineFixture(request, token, {
        bomHeaderId: bomHeader.id,
        productResolveKey: 'fabric',
        netQuantity: 6,
        uomId: master.uomId,
      })
      bomLineId = bomLine.id

      const result = await explodeBomAndWait(request, token, {
        bomHeaderId: bomHeader.id,
        variantConditions: { fabric: variantId },
      })

      expect(result.lines).toHaveLength(1)
      const line = result.lines[0]
      expect(line.bomLineId).toBe(bomLine.id)
      // Spec b Step 2 'product_variant' branch: productId is derived from
      // variant.product_id (the collection), NOT the snapshot value.
      expect(line.productId).toBe(collectionProductId)
      expect(line.productVariantId).toBe(variantId)
      expect(line.quantity).toBe(6)

      const lineWarnings = result.warnings.filter((w) => w.bomLineId === bomLine.id)
      expect(lineWarnings).toHaveLength(0)
    } finally {
      await deleteBomLineIfExists(request, token, bomLineId)
      await deleteBomHeaderIfExists(request, token, bomHeaderId)
      await deleteConfigAttributeIfExists(request, token, attributeId)
      await deleteExtensionIfExists(request, token, extensionId)
      // Variants are cascade-deleted with the parent product.
      await deleteCatalogProductIfExists(request, token, collectionProductId)
      await deleteCatalogProductIfExists(request, token, masterId)
    }
  })
})

// ---------------------------------------------------------------------------
// D-UI-10 — soft-error path: unresolved → emit productId: null with structured
// per-line warning (spec b B5 contract). variantConditions omits the resolve
// key; Step 2 emits a warning; B5 emit-on-null keeps the row in the result so
// the UI can surface it muted.
// ---------------------------------------------------------------------------

test.describe('D-UI-10: unresolved dynamic BomLine → null productId + keyed warning (B5 soft-error)', () => {
  test('missing resolve-key value → line emitted with null productId + keyed warning', async ({ request }) => {
    let token: string | null = null
    let masterId: string | null = null
    let extensionId: string | null = null
    let attributeId: string | null = null
    let bomHeaderId: string | null = null
    let bomLineId: string | null = null
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    try {
      token = await getAuthToken(request)
      const master = await createRuleBasedProduct(request, token, suffix)
      masterId = master.productId
      extensionId = master.extensionId

      const attr = await createConfigAttributeFixture(request, token, {
        productId: masterId,
        key: 'fabric',
        label: 'Fabric',
        attributeType: 'product_variant',
        isMandatory: true,
        displayOrder: 0,
      })
      attributeId = attr.id

      const bomHeader = await createBomHeaderFixture(request, token, {
        productId: masterId,
        name: `QA BOM ${suffix}`,
      })
      bomHeaderId = bomHeader.id

      const bomLine = await createBomLineFixture(request, token, {
        bomHeaderId: bomHeader.id,
        productResolveKey: 'fabric',
        netQuantity: 1,
        uomId: master.uomId,
      })
      bomLineId = bomLine.id

      // Intentionally omit 'fabric' from variantConditions — Step 2 can't
      // resolve; B5 keeps the row with productId null + keyed warning.
      const result = await explodeBomAndWait(request, token, {
        bomHeaderId: bomHeader.id,
        variantConditions: {},
      })

      expect(result.lines).toHaveLength(1)
      const line = result.lines[0]
      expect(line.bomLineId).toBe(bomLine.id)
      expect(line.productId).toBeNull()
      expect(line.productVariantId).toBeNull()

      // Structured warnings: per-line entries carry bomLineId. B5 emits
      // exactly 2 warnings on this line — the Step 2 failure reason and
      // the downstream-contract note — anchored with toBe(2) so if a third
      // warning leaks in (e.g. a future refactor double-appends), the test
      // fails rather than silently tolerating drift.
      const lineWarnings = result.warnings.filter((w) => w.bomLineId === bomLine.id)
      expect(lineWarnings).toHaveLength(2)
      expect(lineWarnings.some((w) => w.message.includes("resolve key 'fabric' missing from variantConditions"))).toBe(
        true,
      )
      expect(
        lineWarnings.some((w) => w.message.includes('emitted with null product_id')),
      ).toBe(true)
    } finally {
      await deleteBomLineIfExists(request, token, bomLineId)
      await deleteBomHeaderIfExists(request, token, bomHeaderId)
      await deleteConfigAttributeIfExists(request, token, attributeId)
      await deleteExtensionIfExists(request, token, extensionId)
      await deleteCatalogProductIfExists(request, token, masterId)
    }
  })
})
