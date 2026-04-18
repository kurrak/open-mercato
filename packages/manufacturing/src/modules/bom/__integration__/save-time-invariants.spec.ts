import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  createBomHeaderFixture,
  deleteBomHeaderIfExists,
  createBomLineFixture,
  deleteBomLineIfExists,
} from './helpers/fixtures'

// Save-time invariant + drift-guard rejections (spec b §Integration Tests
// B-UI-17/18/19/20). All four scenarios are negative tests: malformed payload
// hits POST /api/bom/bom-line or /api/bom/bom-line-variant and MUST be
// rejected with a targeted 400 before anything persists.
//
// Two error shapes coexist:
//   - Zod superRefine failures (schema-level invariants) surface via
//     the CRUD factory's ZodError handler as
//       { error: 'Invalid input', details: [{ path, message, code }, ...] }
//   - Command-level drift guards throw CrudHttpError with
//       { error: '<first message>', fieldErrors: { <field>: '<message>' } }
//     built by buildInvariantHttpError.
//
// The tests match on the shape the offending path produces so any future
// refactor that moves an invariant between Zod and command layers will fail
// the test and warrant review.

function makeSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Negative control — confirm the rejection actually prevented the write.
// Current implementation rejects before em.persist (Zod at the factory,
// command drift guards early-throw), but a future refactor that moved an
// invariant after persist would silently leave an orphan row. This extra
// list-and-match makes that regression loud.
async function assertNoBomLineFor(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  bomHeaderId: string,
): Promise<void> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/bom/bom-line?bomHeaderId=${encodeURIComponent(bomHeaderId)}&pageSize=10`,
    { token },
  )
  expect(response.ok(), `List BOM lines failed: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { items?: unknown[]; total?: number }
  expect(body.total ?? 0, 'Expected no BOM lines to have been persisted').toBe(0)
}

async function assertNoBomLineVariantFor(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  bomLineId: string,
): Promise<void> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/bom/bom-line-variant?bomLineId=${encodeURIComponent(bomLineId)}&pageSize=10`,
    { token },
  )
  expect(response.ok(), `List BOM line variants failed: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { items?: unknown[]; total?: number }
  expect(body.total ?? 0, 'Expected no BOM line variants to have been persisted').toBe(0)
}

// ---------------------------------------------------------------------------
// B-UI-17 — XOR: product_id AND product_resolve_key both set
// ---------------------------------------------------------------------------

test.describe('B-UI-17: BomLine XOR — cannot carry both product_id and product_resolve_key', () => {
  test('Zod superRefine rejects with path=productResolveKey', async ({ request }) => {
    let token: string | null = null
    let masterId: string | null = null
    let itemProductId: string | null = null
    let bomHeaderId: string | null = null
    const suffix = makeSuffix()

    try {
      token = await getAuthToken(request)
      masterId = await createProductFixture(request, token, {
        title: `QA XOR Master ${suffix}`,
        sku: `QA-XOR-MASTER-${suffix}`,
      })
      itemProductId = await createProductFixture(request, token, {
        title: `QA XOR Item ${suffix}`,
        sku: `QA-XOR-ITEM-${suffix}`,
      })
      const bomHeader = await createBomHeaderFixture(request, token, {
        productId: masterId,
        name: `QA BOM ${suffix}`,
      })
      bomHeaderId = bomHeader.id

      const response = await apiRequest(request, 'POST', '/api/bom/bom-line', {
        token,
        data: {
          bomHeaderId: bomHeader.id,
          lineType: 'material',
          productId: itemProductId, // static
          productResolveKey: 'fabric', // AND dynamic -> Zod XOR rejection
          netQuantity: '1',
        },
      })

      expect(response.status()).toBe(400)
      const body = (await response.json()) as {
        error?: string
        details?: Array<{ path: (string | number)[]; message: string; code?: string }>
      }
      expect(body.error).toBe('Invalid input')
      expect(Array.isArray(body.details)).toBe(true)
      const offending = body.details?.find(
        (issue) => issue.path[issue.path.length - 1] === 'productResolveKey',
      )
      expect(offending, 'Expected a Zod issue keyed to productResolveKey').toBeTruthy()
      expect(offending?.message).toContain('cannot carry both product_id and product_resolve_key')
      await assertNoBomLineFor(request, token, bomHeader.id)
    } finally {
      await deleteBomHeaderIfExists(request, token, bomHeaderId)
      await deleteCatalogProductIfExists(request, token, itemProductId)
      await deleteCatalogProductIfExists(request, token, masterId)
    }
  })
})

// ---------------------------------------------------------------------------
// B-UI-18 — Static-mode drift guard: product_variant.product_id !== product_id
// ---------------------------------------------------------------------------

test.describe('B-UI-18: BomLine static-mode drift — variant belongs to a different product', () => {
  test('command drift guard rejects with fieldErrors.productVariantId', async ({ request }) => {
    let token: string | null = null
    let masterId: string | null = null
    let productA: string | null = null
    let productB: string | null = null
    // Holds the variant UUID for the malformed payload below. Kept as a
    // declaration (not just an inline value) so the drift assertion reads
    // clearly; cleanup is via productA cascade-delete, not an explicit
    // deleteVariantIfExists.
    let variantOnA: string | null = null
    let bomHeaderId: string | null = null
    const suffix = makeSuffix()

    try {
      token = await getAuthToken(request)
      masterId = await createProductFixture(request, token, {
        title: `QA Drift Master ${suffix}`,
        sku: `QA-DRIFT-MASTER-${suffix}`,
      })
      productA = await createProductFixture(request, token, {
        title: `QA Drift Prod A ${suffix}`,
        sku: `QA-DRIFT-A-${suffix}`,
      })
      productB = await createProductFixture(request, token, {
        title: `QA Drift Prod B ${suffix}`,
        sku: `QA-DRIFT-B-${suffix}`,
      })
      variantOnA = await createVariantFixture(request, token, {
        productId: productA,
        name: 'Red',
        sku: `QA-DRIFT-A-RED-${suffix}`,
      })
      const bomHeader = await createBomHeaderFixture(request, token, {
        productId: masterId,
        name: `QA BOM ${suffix}`,
      })
      bomHeaderId = bomHeader.id

      // Drift: productId points at B, but productVariantId is a variant of A.
      const response = await apiRequest(request, 'POST', '/api/bom/bom-line', {
        token,
        data: {
          bomHeaderId: bomHeader.id,
          lineType: 'material',
          productId: productB,
          productVariantId: variantOnA,
          netQuantity: '1',
        },
      })

      expect(response.status()).toBe(400)
      const body = (await response.json()) as {
        error?: string
        fieldErrors?: Record<string, string>
      }
      expect(body.fieldErrors, 'Expected fieldErrors map on command drift rejection').toBeTruthy()
      const message = body.fieldErrors?.productVariantId
      expect(message, 'Expected fieldErrors.productVariantId').toBeTruthy()
      expect(message).toContain('drift')
      // Anchor on both product UUIDs to ensure the message identifies the
      // actual mismatch (not a generic "mismatch" phrase).
      expect(message).toContain(productA)
      expect(message).toContain(productB)
      await assertNoBomLineFor(request, token, bomHeader.id)
    } finally {
      await deleteBomHeaderIfExists(request, token, bomHeaderId)
      // Variant cascades with productA on delete.
      await deleteCatalogProductIfExists(request, token, productA)
      await deleteCatalogProductIfExists(request, token, productB)
      await deleteCatalogProductIfExists(request, token, masterId)
    }
  })
})

// ---------------------------------------------------------------------------
// B-UI-19 — BomLineVariant pair: productVariantOverrideId requires
//           productOverrideId (Zod superRefine)
// ---------------------------------------------------------------------------

test.describe('B-UI-19: BomLineVariant pair — product_variant_override_id requires product_override_id', () => {
  test('Zod superRefine rejects with path=productOverrideId', async ({ request }) => {
    let token: string | null = null
    let masterId: string | null = null
    let itemProductId: string | null = null
    // Holds the variant UUID for the malformed payload. Cleanup is via
    // itemProductId cascade-delete.
    let overrideVariantOnItem: string | null = null
    let bomHeaderId: string | null = null
    let bomLineId: string | null = null
    const suffix = makeSuffix()

    try {
      token = await getAuthToken(request)
      masterId = await createProductFixture(request, token, {
        title: `QA Pair Master ${suffix}`,
        sku: `QA-PAIR-MASTER-${suffix}`,
      })
      itemProductId = await createProductFixture(request, token, {
        title: `QA Pair Item ${suffix}`,
        sku: `QA-PAIR-ITEM-${suffix}`,
      })
      overrideVariantOnItem = await createVariantFixture(request, token, {
        productId: itemProductId,
        name: 'Red',
        sku: `QA-PAIR-ITEM-RED-${suffix}`,
      })
      const bomHeader = await createBomHeaderFixture(request, token, {
        productId: masterId,
        name: `QA BOM ${suffix}`,
      })
      bomHeaderId = bomHeader.id

      const bomLine = await createBomLineFixture(request, token, {
        bomHeaderId: bomHeader.id,
        productId: itemProductId,
        netQuantity: 1,
      })
      bomLineId = bomLine.id

      // Malformed: variant override without product override.
      const response = await apiRequest(request, 'POST', '/api/bom/bom-line-variant', {
        token,
        data: {
          bomLineId: bomLine.id,
          variantCondition: { color: ['red'] },
          productOverrideId: null,
          productVariantOverrideId: overrideVariantOnItem,
        },
      })

      expect(response.status()).toBe(400)
      const body = (await response.json()) as {
        error?: string
        details?: Array<{ path: (string | number)[]; message: string }>
      }
      expect(body.error).toBe('Invalid input')
      const offending = body.details?.find(
        (issue) => issue.path[issue.path.length - 1] === 'productOverrideId',
      )
      expect(offending, 'Expected a Zod issue keyed to productOverrideId').toBeTruthy()
      expect(offending?.message).toContain('requires product_override_id')
      await assertNoBomLineVariantFor(request, token, bomLine.id)
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
// B-UI-20 — BomLineVariant override drift: product_variant.product_id !==
//           product_override_id
// ---------------------------------------------------------------------------

test.describe('B-UI-20: BomLineVariant override drift — variant belongs to a different override product', () => {
  test('command drift guard rejects with fieldErrors.productVariantOverrideId', async ({ request }) => {
    let token: string | null = null
    let masterId: string | null = null
    let itemProductId: string | null = null
    let overrideA: string | null = null
    let overrideB: string | null = null
    // Holds the variant UUID for the malformed payload. Cleanup is via
    // overrideA cascade-delete.
    let variantOnA: string | null = null
    let bomHeaderId: string | null = null
    let bomLineId: string | null = null
    const suffix = makeSuffix()

    try {
      token = await getAuthToken(request)
      masterId = await createProductFixture(request, token, {
        title: `QA OvrDrift Master ${suffix}`,
        sku: `QA-OVRDRIFT-MASTER-${suffix}`,
      })
      itemProductId = await createProductFixture(request, token, {
        title: `QA OvrDrift Item ${suffix}`,
        sku: `QA-OVRDRIFT-ITEM-${suffix}`,
      })
      overrideA = await createProductFixture(request, token, {
        title: `QA OvrDrift Override A ${suffix}`,
        sku: `QA-OVRDRIFT-A-${suffix}`,
      })
      overrideB = await createProductFixture(request, token, {
        title: `QA OvrDrift Override B ${suffix}`,
        sku: `QA-OVRDRIFT-B-${suffix}`,
      })
      variantOnA = await createVariantFixture(request, token, {
        productId: overrideA,
        name: 'Red',
        sku: `QA-OVRDRIFT-A-RED-${suffix}`,
      })
      const bomHeader = await createBomHeaderFixture(request, token, {
        productId: masterId,
        name: `QA BOM ${suffix}`,
      })
      bomHeaderId = bomHeader.id

      const bomLine = await createBomLineFixture(request, token, {
        bomHeaderId: bomHeader.id,
        productId: itemProductId,
        netQuantity: 1,
      })
      bomLineId = bomLine.id

      // Drift: productOverrideId=B but productVariantOverrideId is a variant of A.
      const response = await apiRequest(request, 'POST', '/api/bom/bom-line-variant', {
        token,
        data: {
          bomLineId: bomLine.id,
          variantCondition: { color: ['red'] },
          productOverrideId: overrideB,
          productVariantOverrideId: variantOnA,
        },
      })

      expect(response.status()).toBe(400)
      const body = (await response.json()) as {
        error?: string
        fieldErrors?: Record<string, string>
      }
      expect(body.fieldErrors, 'Expected fieldErrors map on command drift rejection').toBeTruthy()
      const message = body.fieldErrors?.productVariantOverrideId
      expect(message, 'Expected fieldErrors.productVariantOverrideId').toBeTruthy()
      expect(message).toContain('override drift')
      expect(message).toContain(overrideA)
      expect(message).toContain(overrideB)
      await assertNoBomLineVariantFor(request, token, bomLine.id)
    } finally {
      await deleteBomLineIfExists(request, token, bomLineId)
      await deleteBomHeaderIfExists(request, token, bomHeaderId)
      await deleteCatalogProductIfExists(request, token, itemProductId)
      await deleteCatalogProductIfExists(request, token, overrideA)
      await deleteCatalogProductIfExists(request, token, overrideB)
      await deleteCatalogProductIfExists(request, token, masterId)
    }
  })
})
