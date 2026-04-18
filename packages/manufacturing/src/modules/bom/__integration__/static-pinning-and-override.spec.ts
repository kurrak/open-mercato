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
} from '../../configurator/__integration__/helpers/fixtures'
import {
  createBomHeaderFixture,
  deleteBomHeaderIfExists,
  createBomLineFixture,
  deleteBomLineIfExists,
  createBomLineVariantFixture,
  deleteBomLineVariantIfExists,
  explodeBomAndWait,
  queryWhereUsed,
} from './helpers/fixtures'

// Static pinning + override pair propagation (spec b §Integration Tests
// B-UI-12 + B-UI-16 + the shape-2 override case).
//
// - B-UI-12 exercises the product_variant_id column on BomLine + the
//   where-used query's 4-way match covering product_variant_id.
// - B-UI-16 exercises override precedence + Step 2 warning suppression:
//   a dynamic BomLine whose Step 2 resolution deliberately fails, plus a
//   matched BomLineVariant with the full override pair — the override
//   wins AND Step 2's queued warning is discarded rather than leaked to
//   the caller.
// - The final test covers override shape (2) — `productOverrideId`-only
//   resets `productVariantId` to null even when the static line had one
//   pinned.

function makeSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ---------------------------------------------------------------------------
// B-UI-12 — Static BomLine with pinned product_variant_id + where-used query
// ---------------------------------------------------------------------------

test.describe('B-UI-12: static BomLine pins product_variant_id + where-used covers the pair', () => {
  test('explode carries pinned pair + where-used returns the BomHeader for the variant UUID', async ({ request }) => {
    let token: string | null = null
    let masterId: string | null = null
    let itemProductId: string | null = null
    // Holds the variant UUID — cleanup is via itemProductId cascade-delete.
    let pinnedVariantId: string | null = null
    let bomHeaderId: string | null = null
    let bomLineId: string | null = null
    const suffix = makeSuffix()

    try {
      token = await getAuthToken(request)
      const uom = await ensureTenantUom(request, token, { code: 'szt', name: 'Sztuka', uomType: 'piece' })
      masterId = await createProductFixture(request, token, {
        title: `QA Pin Master ${suffix}`,
        sku: `QA-PIN-MASTER-${suffix}`,
      })
      itemProductId = await createProductFixture(request, token, {
        title: `QA Pin Item ${suffix}`,
        sku: `QA-PIN-ITEM-${suffix}`,
      })
      pinnedVariantId = await createVariantFixture(request, token, {
        productId: itemProductId,
        name: 'Red',
        sku: `QA-PIN-ITEM-RED-${suffix}`,
      })

      const bomHeader = await createBomHeaderFixture(request, token, {
        productId: masterId,
        name: `QA BOM ${suffix}`,
      })
      bomHeaderId = bomHeader.id

      const bomLine = await createBomLineFixture(request, token, {
        bomHeaderId: bomHeader.id,
        productId: itemProductId,
        productVariantId: pinnedVariantId,
        netQuantity: 3,
        uomId: uom.id,
      })
      bomLineId = bomLine.id

      // Explode → static mode: ExplosionLine inherits the pinned pair from
      // the BomLine unchanged (no Step 2 or Step 3 in play).
      const result = await explodeBomAndWait(request, token, {
        bomHeaderId: bomHeader.id,
        variantConditions: {},
      })

      expect(result.lines).toHaveLength(1)
      const line = result.lines[0]
      expect(line.bomLineId).toBe(bomLine.id)
      expect(line.productId).toBe(itemProductId)
      expect(line.productVariantId).toBe(pinnedVariantId)
      expect(line.quantity).toBe(3)
      expect(result.warnings.filter((w) => w.bomLineId === bomLine.id)).toHaveLength(0)

      // Where-used: querying by productVariantId must return the BomHeader
      // that contains this line. The where-used endpoint matches
      // product_variant_id on master lines (and BomLineVariant override
      // pairs); this test exercises the master-line path.
      const items = await queryWhereUsed(request, token, {
        productId: itemProductId,
        productVariantId: pinnedVariantId,
      })
      const match = items.find((i) => i.bomHeaderId === bomHeader.id)
      expect(match, 'Expected the BomHeader to appear in where-used results').toBeTruthy()
      // Response carries the MASTER product of the BomHeader, not the
      // searched productId (matches where-used.ts line mapping).
      expect(match?.productId).toBe(masterId)
    } finally {
      await deleteBomLineIfExists(request, token, bomLineId)
      await deleteBomHeaderIfExists(request, token, bomHeaderId)
      // Variant cascades with itemProductId.
      await deleteCatalogProductIfExists(request, token, itemProductId)
      await deleteCatalogProductIfExists(request, token, masterId)
    }
  })
})

// ---------------------------------------------------------------------------
// B-UI-16 — Override precedence + Step 2 warning suppression
// ---------------------------------------------------------------------------
//
// Spec b §Integration Tests B-UI-16 (override wins over a failed dynamic
// resolve + the queued Step 2 warning is discarded). The dynamic BomLine
// carries `product_resolve_key='fabric'`; `variantConditions` deliberately
// omits 'fabric', so Step 2 queues a "resolve key 'fabric' missing …"
// warning on the line. A matched BomLineVariant with the full override
// pair then fills `productId` + `productVariantId`; the spec requires the
// queued warning to be **discarded**, not leaked to the caller.

test.describe('B-UI-16: override precedence + Step 2 warning suppression on dynamic line', () => {
  test('override fills productId+productVariantId AND Step 2 warning is discarded', async ({ request }) => {
    let token: string | null = null
    let masterId: string | null = null
    let extensionId: string | null = null
    let attributeId: string | null = null
    let overrideProductId: string | null = null
    // Holds the variant UUID — cleanup is via overrideProductId cascade-delete.
    let overrideVariantId: string | null = null
    let bomHeaderId: string | null = null
    let bomLineId: string | null = null
    let bomLineVariantId: string | null = null
    const suffix = makeSuffix()

    try {
      token = await getAuthToken(request)
      const uom = await ensureTenantUom(request, token, { code: 'szt', name: 'Sztuka', uomType: 'piece' })
      masterId = await createProductFixture(request, token, {
        title: `QA Override Master ${suffix}`,
        sku: `QA-OVR-MASTER-${suffix}`,
      })
      // rule_based master is required for the ConfigAttribute to be a
      // legitimate resolve target — matches the setup in D-UI-9/10.
      const extension = await createExtensionFixture(request, token, {
        productId: masterId,
        baseUomId: uom.id,
        procurementType: 'make',
        configurationType: 'rule_based',
      })
      extensionId = extension.id

      const attr = await createConfigAttributeFixture(request, token, {
        productId: masterId,
        key: 'fabric',
        label: 'Fabric',
        attributeType: 'product_variant',
        isMandatory: true,
        displayOrder: 0,
      })
      attributeId = attr.id

      overrideProductId = await createProductFixture(request, token, {
        title: `QA Override Target ${suffix}`,
        sku: `QA-OVR-TARGET-${suffix}`,
      })
      overrideVariantId = await createVariantFixture(request, token, {
        productId: overrideProductId,
        name: 'Premium',
        sku: `QA-OVR-TARGET-PREMIUM-${suffix}`,
      })

      const bomHeader = await createBomHeaderFixture(request, token, {
        productId: masterId,
        name: `QA BOM ${suffix}`,
      })
      bomHeaderId = bomHeader.id

      // Dynamic BomLine — no static productId, resolve-key mode. Step 2 will
      // need 'fabric' in variantConditions to resolve; the explode call below
      // deliberately omits it.
      const bomLine = await createBomLineFixture(request, token, {
        bomHeaderId: bomHeader.id,
        productResolveKey: 'fabric',
        netQuantity: 2,
        uomId: uom.id,
      })
      bomLineId = bomLine.id

      // Override triggers on an orthogonal key (grade=premium) so we can
      // fire it without supplying 'fabric'. When matched, it fills both
      // (productId, productVariantId) — which per spec discards the queued
      // Step 2 warning.
      const bomLineVariant = await createBomLineVariantFixture(request, token, {
        bomLineId: bomLine.id,
        variantCondition: { grade: ['premium'] },
        productOverrideId: overrideProductId,
        productVariantOverrideId: overrideVariantId,
      })
      bomLineVariantId = bomLineVariant.id

      // Override path: grade=premium triggers the BomLineVariant; 'fabric'
      // is intentionally missing → Step 2 queues a warning → Step 3 fills
      // the pair → the queued warning is discarded.
      const result = await explodeBomAndWait(request, token, {
        bomHeaderId: bomHeader.id,
        variantConditions: { grade: 'premium' },
      })

      expect(result.lines).toHaveLength(1)
      const line = result.lines[0]
      expect(line.bomLineId).toBe(bomLine.id)
      // Override's pair is on the output even though Step 2 failed.
      expect(line.productId).toBe(overrideProductId)
      expect(line.productVariantId).toBe(overrideVariantId)
      expect(line.quantity).toBe(2)

      // Spec contract: Step 2's queued "resolve key 'fabric' missing …"
      // warning MUST NOT leak into result.warnings[] when Step 3 rescues
      // the line. Assert neither the 'fabric' string nor the generic
      // "resolve key" phrase appears for this bomLineId. Also assert
      // the emit-on-null "emitted with null product_id" downstream-contract
      // warning is absent (productId is non-null on the output).
      const lineWarnings = result.warnings.filter((w) => w.bomLineId === bomLine.id)
      expect(lineWarnings, `Unexpected warnings: ${JSON.stringify(lineWarnings)}`).toHaveLength(0)

      // Control: without the override trigger, Step 2 warning DOES surface
      // — proves the queued warning really was queued and only the override
      // path suppresses it.
      const uncovered = await explodeBomAndWait(request, token, {
        bomHeaderId: bomHeader.id,
        variantConditions: { grade: 'economy' },
      })
      expect(uncovered.lines).toHaveLength(1)
      const uncoveredLine = uncovered.lines[0]
      expect(uncoveredLine.productId).toBeNull()
      const uncoveredWarnings = uncovered.warnings.filter((w) => w.bomLineId === bomLine.id)
      expect(
        uncoveredWarnings.some((w) => w.message.includes("resolve key 'fabric'")),
        'Step 2 should queue a warning when override does not rescue the line',
      ).toBe(true)
    } finally {
      await deleteBomLineVariantIfExists(request, token, bomLineVariantId)
      await deleteBomLineIfExists(request, token, bomLineId)
      await deleteBomHeaderIfExists(request, token, bomHeaderId)
      await deleteConfigAttributeIfExists(request, token, attributeId)
      await deleteExtensionIfExists(request, token, extensionId)
      // overrideVariantId cascades with overrideProductId.
      await deleteCatalogProductIfExists(request, token, overrideProductId)
      await deleteCatalogProductIfExists(request, token, masterId)
    }
  })

  // Spec b §BomLineVariant Constraints allows three override shapes. The
  // first test above covers shape (3) "both set". This test covers shape
  // (2) "productOverrideId set, productVariantOverrideId null" — the
  // override switches the product AND MUST reset productVariantId to null,
  // even if the static line had a variant pinned. Easy to regress if
  // someone tries to "preserve" the static variant when the override
  // doesn't specify one.
  test('productOverrideId-only override resets productVariantId to null even when static line pinned one', async ({ request }) => {
    let token: string | null = null
    let masterId: string | null = null
    let staticProductId: string | null = null
    // staticVariantId is pinned on the BomLine; the override must clear it.
    let staticVariantId: string | null = null
    let overrideProductId: string | null = null
    let bomHeaderId: string | null = null
    let bomLineId: string | null = null
    let bomLineVariantId: string | null = null
    const suffix = makeSuffix()

    try {
      token = await getAuthToken(request)
      const uom = await ensureTenantUom(request, token, { code: 'szt', name: 'Sztuka', uomType: 'piece' })
      masterId = await createProductFixture(request, token, {
        title: `QA OvrOnly Master ${suffix}`,
        sku: `QA-OVRONLY-MASTER-${suffix}`,
      })
      staticProductId = await createProductFixture(request, token, {
        title: `QA OvrOnly Static ${suffix}`,
        sku: `QA-OVRONLY-STATIC-${suffix}`,
      })
      staticVariantId = await createVariantFixture(request, token, {
        productId: staticProductId,
        name: 'Blue',
        sku: `QA-OVRONLY-STATIC-BLUE-${suffix}`,
      })
      overrideProductId = await createProductFixture(request, token, {
        title: `QA OvrOnly Target ${suffix}`,
        sku: `QA-OVRONLY-TARGET-${suffix}`,
      })

      const bomHeader = await createBomHeaderFixture(request, token, {
        productId: masterId,
        name: `QA BOM ${suffix}`,
      })
      bomHeaderId = bomHeader.id

      // Static line with BOTH productId and productVariantId pinned.
      const bomLine = await createBomLineFixture(request, token, {
        bomHeaderId: bomHeader.id,
        productId: staticProductId,
        productVariantId: staticVariantId,
        netQuantity: 1,
        uomId: uom.id,
      })
      bomLineId = bomLine.id

      // Override switches the product but deliberately omits
      // productVariantOverrideId.
      const bomLineVariant = await createBomLineVariantFixture(request, token, {
        bomLineId: bomLine.id,
        variantCondition: { grade: ['premium'] },
        productOverrideId: overrideProductId,
        productVariantOverrideId: null,
      })
      bomLineVariantId = bomLineVariant.id

      const result = await explodeBomAndWait(request, token, {
        bomHeaderId: bomHeader.id,
        variantConditions: { grade: 'premium' },
      })

      expect(result.lines).toHaveLength(1)
      const line = result.lines[0]
      expect(line.bomLineId).toBe(bomLine.id)
      expect(line.productId).toBe(overrideProductId)
      // The override's absence of productVariantOverrideId resets
      // productVariantId to null, even though the static line had
      // staticVariantId pinned. This is the distinctive behavior of
      // shape (2) vs shape (3) — test fails if the implementation ever
      // "helpfully" carries the static variant through.
      expect(line.productVariantId).toBeNull()
    } finally {
      await deleteBomLineVariantIfExists(request, token, bomLineVariantId)
      await deleteBomLineIfExists(request, token, bomLineId)
      await deleteBomHeaderIfExists(request, token, bomHeaderId)
      await deleteCatalogProductIfExists(request, token, overrideProductId)
      // staticVariantId cascades with staticProductId.
      await deleteCatalogProductIfExists(request, token, staticProductId)
      await deleteCatalogProductIfExists(request, token, masterId)
    }
  })
})
