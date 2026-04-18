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
} from '../../product_master/__integration__/helpers/fixtures'
import {
  createConfigAttributeFixture,
  deleteConfigAttributeIfExists,
  listConfigAttributes,
  createBomHeaderFixture,
  deleteBomHeaderIfExists,
  createBomLineFixture,
  deleteBomLineIfExists,
} from './helpers/fixtures'

// ---------------------------------------------------------------------------
// Shared setup: product + extension with rule_based configuration
// ---------------------------------------------------------------------------

async function createRuleBasedProduct(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  suffix: number,
) {
  const uom = await ensureTenantUom(request, token, { code: 'szt', name: 'Sztuka', uomType: 'piece' })
  const productId = await createProductFixture(request, token, {
    title: `QA Configurator ${suffix}`,
    sku: `QA-CFG-${suffix}`,
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
// D-UI-1: Empty state + enum attribute CRUD
// ---------------------------------------------------------------------------

test.describe('D-UI-1: Empty state, Attribute CRUD — enum', () => {
  test('create rule_based product → empty list → create enum attribute → verify in list', async ({ request }) => {
    let token: string | null = null
    let productId: string | null = null
    let extensionId: string | null = null
    let attributeId: string | null = null
    const suffix = Date.now()

    try {
      token = await getAuthToken(request)
      const setup = await createRuleBasedProduct(request, token, suffix)
      productId = setup.productId
      extensionId = setup.extensionId

      // Verify empty list
      const emptyList = await listConfigAttributes(request, token, productId)
      expect(emptyList.length).toBe(0)

      // Create enum attribute
      const attr = await createConfigAttributeFixture(request, token, {
        productId,
        key: 'seat_type',
        label: 'Seat Type',
        attributeType: 'enum',
        allowedValues: ['SD01N', 'SD02N', 'SD03'],
        attributeGroup: 'Construction',
        displayOrder: 0,
      })
      attributeId = attr.id

      // Verify appears in list
      const list = await listConfigAttributes(request, token, productId)
      expect(list.length).toBe(1)
      expect(list[0].key).toBe('seat_type')
      expect(list[0].attribute_type).toBe('enum')

      // Verify update
      const updateResponse = await apiRequest(
        request,
        'PUT',
        '/api/configurator/manufacturing/config-attribute',
        { token, data: { id: attributeId, label: 'Seat Type Updated' } },
      )
      expect(updateResponse.ok()).toBeTruthy()

      // Verify delete (soft)
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/configurator/manufacturing/config-attribute?id=${encodeURIComponent(attributeId)}`,
        { token },
      )
      expect(deleteResponse.ok()).toBeTruthy()
      attributeId = null

      const postDeleteList = await listConfigAttributes(request, token, productId)
      expect(postDeleteList.length).toBe(0)
    } finally {
      await deleteConfigAttributeIfExists(request, token, attributeId)
      await deleteExtensionIfExists(request, token, extensionId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})

// ---------------------------------------------------------------------------
// D-UI-2: Create attribute of each type
// ---------------------------------------------------------------------------

test.describe('D-UI-2: All 5 attribute types', () => {
  test('create enum, numeric_range, boolean, text, product, product_variant → verify all in list', async ({ request }) => {
    let token: string | null = null
    let productId: string | null = null
    let extensionId: string | null = null
    const attrIds: string[] = []
    const suffix = Date.now()

    try {
      token = await getAuthToken(request)
      const setup = await createRuleBasedProduct(request, token, suffix)
      productId = setup.productId
      extensionId = setup.extensionId

      const types = [
        { key: 'fabric', label: 'Fabric', attributeType: 'enum', allowedValues: ['Soro_61', 'Soro_83'], attributeGroup: 'Materials', displayOrder: 0 },
        { key: 'seat_width', label: 'Seat Width', attributeType: 'numeric_range', allowedValues: { min: 60, max: 260, step: 10 }, attributeGroup: 'Dimensions', displayOrder: 1 },
        { key: 'armrest', label: 'Armrest', attributeType: 'boolean', attributeGroup: 'Options', displayOrder: 2 },
        { key: 'notes', label: 'Notes', attributeType: 'text', attributeGroup: null, displayOrder: 3 },
        { key: 'frame_product', label: 'Frame Product', attributeType: 'product', attributeGroup: 'Materials', displayOrder: 4 },
        { key: 'fabric_variant', label: 'Fabric Variant', attributeType: 'product_variant', attributeGroup: 'Materials', displayOrder: 5 },
      ] as const

      for (const spec of types) {
        const attr = await createConfigAttributeFixture(request, token, {
          productId,
          key: spec.key,
          label: spec.label,
          attributeType: spec.attributeType,
          allowedValues: 'allowedValues' in spec ? spec.allowedValues : undefined,
          attributeGroup: spec.attributeGroup,
          displayOrder: spec.displayOrder,
        })
        attrIds.push(attr.id)
      }

      const list = await listConfigAttributes(request, token, productId)
      expect(list.length).toBe(6)

      const typeSet = new Set(list.map((a) => a.attribute_type))
      expect(typeSet.has('enum')).toBe(true)
      expect(typeSet.has('numeric_range')).toBe(true)
      expect(typeSet.has('boolean')).toBe(true)
      expect(typeSet.has('text')).toBe(true)
      expect(typeSet.has('product')).toBe(true)
      expect(typeSet.has('product_variant')).toBe(true)
    } finally {
      for (const id of attrIds.reverse()) {
        await deleteConfigAttributeIfExists(request, token, id)
      }
      await deleteExtensionIfExists(request, token, extensionId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})

// ---------------------------------------------------------------------------
// D-UI-3: Resolve passthrough — attribute values → variant conditions
// ---------------------------------------------------------------------------

test.describe('D-UI-3: Test Configuration resolve', () => {
  test('create 3 attributes → resolve → verify conditions + warning for missing mandatory', async ({ request }) => {
    let token: string | null = null
    let productId: string | null = null
    let extensionId: string | null = null
    const attrIds: string[] = []
    const suffix = Date.now()

    try {
      token = await getAuthToken(request)
      const setup = await createRuleBasedProduct(request, token, suffix)
      productId = setup.productId
      extensionId = setup.extensionId

      // Create 3 mandatory attributes
      for (const spec of [
        { key: 'seat_type', label: 'Seat Type', allowedValues: ['SD01N', 'SD02N'] },
        { key: 'fabric', label: 'Fabric', allowedValues: ['Soro_61', 'Soro_83'] },
        { key: 'backrest', label: 'Backrest', allowedValues: ['OP62', 'OP63'] },
      ]) {
        const attr = await createConfigAttributeFixture(request, token, {
          productId,
          key: spec.key,
          label: spec.label,
          attributeType: 'enum',
          allowedValues: spec.allowedValues,
          isMandatory: true,
        })
        attrIds.push(attr.id)
      }

      // Resolve with 2 of 3 filled (backrest missing → should warn)
      const resolveResponse = await apiRequest(
        request,
        'POST',
        '/api/configurator/manufacturing/configurator/resolve',
        {
          token,
          data: {
            productId,
            configSnapshot: { seat_type: 'SD01N', fabric: 'Soro_61' },
          },
        },
      )
      expect(resolveResponse.ok(), `Resolve failed: ${resolveResponse.status()}`).toBeTruthy()
      const result = (await resolveResponse.json()) as {
        resolvedConditions: Record<string, string[]>
        warnings: string[]
        errors: string[]
      }

      // Resolved conditions should contain the provided values
      expect(result.resolvedConditions.seat_type).toEqual(['SD01N'])
      expect(result.resolvedConditions.fabric).toEqual(['Soro_61'])

      // Warning for missing mandatory attribute
      expect(result.warnings.length).toBeGreaterThan(0)
      const hasMissingWarning = result.warnings.some((w) => w.toLowerCase().includes('backrest'))
      expect(hasMissingWarning, 'Expected warning about missing mandatory "backrest"').toBeTruthy()
    } finally {
      for (const id of attrIds.reverse()) {
        await deleteConfigAttributeIfExists(request, token, id)
      }
      await deleteExtensionIfExists(request, token, extensionId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})

// ---------------------------------------------------------------------------
// D-UI-4: variant_based configuration type
// ---------------------------------------------------------------------------

test.describe('D-UI-4: Variant-based configuration', () => {
  test('set configuration_type=variant_based → verify extension persists type (tab body swap is UI-side)', async ({ request }) => {
    let token: string | null = null
    let productId: string | null = null
    let extensionId: string | null = null
    const suffix = Date.now()

    try {
      token = await getAuthToken(request)
      const uom = await ensureTenantUom(request, token, { code: 'szt', name: 'Sztuka', uomType: 'piece' })
      productId = await createProductFixture(request, token, {
        title: `QA Configurator VB ${suffix}`,
        sku: `QA-CFG-VB-${suffix}`,
      })
      const extension = await createExtensionFixture(request, token, {
        productId,
        baseUomId: uom.id,
        procurementType: 'make',
        configurationType: 'variant_based',
      })
      extensionId = extension.id

      // Verify extension has variant_based type
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/product-manufacturing-extension?productId=${encodeURIComponent(productId)}&pageSize=1`,
        { token },
      )
      expect(listResponse.ok()).toBeTruthy()
      const body = (await listResponse.json()) as {
        items?: Array<{ configuration_type?: string }>
      }
      expect(body.items?.[0]?.configuration_type).toBe('variant_based')

      // Config attributes list should be empty (no attributes for variant_based products)
      const attrList = await listConfigAttributes(request, token, productId)
      expect(attrList.length).toBe(0)
    } finally {
      await deleteExtensionIfExists(request, token, extensionId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})

// ---------------------------------------------------------------------------
// D-UI-5: configuration_type = none → tab hidden
// ---------------------------------------------------------------------------

test.describe('D-UI-5: Configuration type none', () => {
  test('set configuration_type=none → verify extension persists none type (shell tab visibility is UI-side)', async ({ request }) => {
    let token: string | null = null
    let productId: string | null = null
    let extensionId: string | null = null
    const suffix = Date.now()

    try {
      token = await getAuthToken(request)
      const uom = await ensureTenantUom(request, token, { code: 'szt', name: 'Sztuka', uomType: 'piece' })
      productId = await createProductFixture(request, token, {
        title: `QA Configurator None ${suffix}`,
        sku: `QA-CFG-NONE-${suffix}`,
      })
      const extension = await createExtensionFixture(request, token, {
        productId,
        baseUomId: uom.id,
        procurementType: 'make',
        configurationType: 'none',
      })
      extensionId = extension.id

      // Verify extension type
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/product_master/manufacturing/product-manufacturing-extension?productId=${encodeURIComponent(productId)}&pageSize=1`,
        { token },
      )
      expect(listResponse.ok()).toBeTruthy()
      const body = (await listResponse.json()) as {
        items?: Array<{ configuration_type?: string }>
      }
      expect(body.items?.[0]?.configuration_type).toBe('none')
    } finally {
      await deleteExtensionIfExists(request, token, extensionId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})

// ---------------------------------------------------------------------------
// D-UI-6: Reorder attributes via atomic endpoint
// ---------------------------------------------------------------------------

test.describe('D-UI-6: Reorder attributes', () => {
  test('create 3 attributes → reorder → verify display_order updated', async ({ request }) => {
    let token: string | null = null
    let productId: string | null = null
    let extensionId: string | null = null
    const attrIds: string[] = []
    const suffix = Date.now()

    try {
      token = await getAuthToken(request)
      const setup = await createRuleBasedProduct(request, token, suffix)
      productId = setup.productId
      extensionId = setup.extensionId

      // Create 3 attributes with explicit order
      const specs = [
        { key: 'attr_a', label: 'Attribute A', displayOrder: 0 },
        { key: 'attr_b', label: 'Attribute B', displayOrder: 1 },
        { key: 'attr_c', label: 'Attribute C', displayOrder: 2 },
      ]
      for (const spec of specs) {
        const attr = await createConfigAttributeFixture(request, token, {
          productId,
          key: spec.key,
          label: spec.label,
          displayOrder: spec.displayOrder,
        })
        attrIds.push(attr.id)
      }

      // Verify initial order: A, B, C
      const before = await listConfigAttributes(request, token, productId)
      expect(before.map((a) => a.key)).toEqual(['attr_a', 'attr_b', 'attr_c'])

      // Swap A and B via reorder endpoint
      const reorderResponse = await apiRequest(
        request,
        'POST',
        '/api/configurator/manufacturing/config-attribute/reorder',
        { token, data: { sourceId: attrIds[0], targetId: attrIds[1] } },
      )
      expect(reorderResponse.ok(), `Reorder failed: ${reorderResponse.status()}`).toBeTruthy()

      // Verify new order: B, A, C
      const after = await listConfigAttributes(request, token, productId)
      expect(after.map((a) => a.key)).toEqual(['attr_b', 'attr_a', 'attr_c'])
    } finally {
      for (const id of attrIds.reverse()) {
        await deleteConfigAttributeIfExists(request, token, id)
      }
      await deleteExtensionIfExists(request, token, extensionId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})

// ---------------------------------------------------------------------------
// D-UI-7: Delete impact warning via usage endpoint
// ---------------------------------------------------------------------------

test.describe('D-UI-7: Delete with usage warning', () => {
  test('create attribute + BOM line referencing key → usage endpoint shows count → delete → BOM line still exists', async ({ request }) => {
    let token: string | null = null
    let productId: string | null = null
    let extensionId: string | null = null
    let attributeId: string | null = null
    let bomHeaderId: string | null = null
    let bomLineId: string | null = null
    let itemProductId: string | null = null
    const suffix = Date.now()

    try {
      token = await getAuthToken(request)
      const setup = await createRuleBasedProduct(request, token, suffix)
      productId = setup.productId
      extensionId = setup.extensionId

      // Create a config attribute
      const attr = await createConfigAttributeFixture(request, token, {
        productId,
        key: 'seat_type',
        label: 'Seat Type',
        attributeType: 'enum',
        allowedValues: ['SD01N', 'SD02N'],
      })
      attributeId = attr.id

      // Create a second product to use as BOM line item
      itemProductId = await createProductFixture(request, token, {
        title: `QA BOM Item ${suffix}`,
        sku: `QA-BOMITEM-${suffix}`,
      })

      // Create BOM header + line with variant_condition referencing the attribute key
      const bomHeader = await createBomHeaderFixture(request, token, {
        productId,
        name: `QA BOM ${suffix}`,
      })
      bomHeaderId = bomHeader.id

      const bomLine = await createBomLineFixture(request, token, {
        bomHeaderId: bomHeader.id,
        itemProductId,
        quantity: 1,
        variantCondition: { seat_type: ['SD01N'] },
      })
      bomLineId = bomLine.id

      // Usage endpoint should show 1 BOM line reference
      const usageResponse = await apiRequest(
        request,
        'GET',
        `/api/configurator/manufacturing/config-attribute/usage?id=${encodeURIComponent(attributeId)}`,
        { token },
      )
      expect(usageResponse.ok(), `Usage failed: ${usageResponse.status()}`).toBeTruthy()
      const usage = (await usageResponse.json()) as {
        bomLineCount: number
        operationVariantCount: number
      }
      expect(usage.bomLineCount).toBe(1)
      expect(usage.operationVariantCount).toBe(0)

      // Delete the attribute (should succeed — Graceful Incompleteness)
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/configurator/manufacturing/config-attribute?id=${encodeURIComponent(attributeId)}`,
        { token },
      )
      expect(deleteResponse.ok(), `Delete failed: ${deleteResponse.status()}`).toBeTruthy()
      attributeId = null

      // BOM line should still exist with its variant_condition intact
      const bomLineList = await apiRequest(
        request,
        'GET',
        `/api/bom/bom-line?bomHeaderId=${encodeURIComponent(bomHeaderId)}&pageSize=10`,
        { token },
      )
      expect(bomLineList.ok()).toBeTruthy()
      const bomLineBody = (await bomLineList.json()) as {
        items?: Array<{ id: string; variant_condition?: Record<string, unknown> | null }>
        total?: number
      }
      expect(bomLineBody.total).toBe(1)
      const foundLine = (bomLineBody.items ?? []).find((l) => l.id === bomLine.id)
      expect(foundLine, 'BOM line should still exist after attribute deletion').toBeTruthy()
      expect(foundLine?.variant_condition).toBeTruthy()
    } finally {
      await deleteBomLineIfExists(request, token, bomLineId)
      await deleteBomHeaderIfExists(request, token, bomHeaderId)
      await deleteConfigAttributeIfExists(request, token, attributeId)
      await deleteExtensionIfExists(request, token, extensionId)
      await deleteCatalogProductIfExists(request, token, itemProductId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
