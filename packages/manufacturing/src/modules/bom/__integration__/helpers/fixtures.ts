import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

// Integration-test fixtures for the bom module — BomHeader / BomLine /
// BomLineVariant CRUD + async explosion via the worker/progress pair.

export type BomHeaderFixture = { id: string }

export async function createBomHeaderFixture(
  request: APIRequestContext,
  token: string,
  input: { productId: string; name: string; bomUsage?: string },
): Promise<BomHeaderFixture> {
  // bomUsage intentionally omitted when not provided — the BomHeader entity
  // defaults it to 'production', and letting the default apply means the
  // integration suite exercises the same path as a bare "Save" from the UI.
  const response = await apiRequest(request, 'POST', '/api/bom/bom', {
    token,
    data: {
      productId: input.productId,
      name: input.name,
      ...(input.bomUsage != null ? { bomUsage: input.bomUsage } : {}),
      isActive: true,
    },
  })
  expect(
    response.ok(),
    `Failed to create BOM header: ${response.status()} ${await response.text().catch(() => '')}`,
  ).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id === 'string').toBeTruthy()
  return { id: body.id as string }
}

export async function deleteBomHeaderIfExists(
  request: APIRequestContext,
  token: string | null,
  bomHeaderId: string | null,
): Promise<void> {
  if (!token || !bomHeaderId) return
  try {
    await apiRequest(
      request,
      'DELETE',
      `/api/bom/bom?id=${encodeURIComponent(bomHeaderId)}`,
      { token },
    )
  } catch {
    // Non-fatal during cleanup — a failing delete usually means the record is already gone.
    return
  }
}

// BomLine create per spec b §Data Models. `productId` is the static product
// pointer (null in dynamic mode or for draft placeholders); `productVariantId`
// is optional static variant pin (requires productId); `productResolveKey`
// flips the line into dynamic mode (resolves at explosion time via
// ConfigAttribute.attribute_type). netQuantity + uomId are the quantity/unit
// pair consumed by the explosion output.
export async function createBomLineFixture(
  request: APIRequestContext,
  token: string,
  input: {
    bomHeaderId: string
    productId?: string | null
    productVariantId?: string | null
    productResolveKey?: string | null
    netQuantity?: string | number
    uomId?: string | null
    variantCondition?: Record<string, unknown> | null
  },
): Promise<{ id: string }> {
  const response = await apiRequest(request, 'POST', '/api/bom/bom-line', {
    token,
    data: {
      bomHeaderId: input.bomHeaderId,
      lineType: 'material',
      productId: input.productId ?? null,
      productVariantId: input.productVariantId ?? null,
      productResolveKey: input.productResolveKey ?? null,
      netQuantity: input.netQuantity != null ? String(input.netQuantity) : null,
      uomId: input.uomId ?? null,
      variantCondition: input.variantCondition ?? null,
    },
  })
  expect(
    response.ok(),
    `Failed to create BOM line: ${response.status()} ${await response.text().catch(() => '')}`,
  ).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id === 'string').toBeTruthy()
  return { id: body.id as string }
}

export async function deleteBomLineIfExists(
  request: APIRequestContext,
  token: string | null,
  bomLineId: string | null,
): Promise<void> {
  if (!token || !bomLineId) return
  try {
    await apiRequest(
      request,
      'DELETE',
      `/api/bom/bom-line?id=${encodeURIComponent(bomLineId)}`,
      { token },
    )
  } catch {
    // Non-fatal during cleanup — a failing delete usually means the record is already gone.
    return
  }
}

// BomLineVariant override pair per spec b §BomLineVariant Constraints.
// Activation is XOR: exactly one of variantId or variantCondition. Override
// pair: productOverrideId + productVariantOverrideId (Zod enforces the
// "variant without product" invariant; the drift guard in the bom-line-variant
// command ensures variant.product_id === productOverrideId).
export async function createBomLineVariantFixture(
  request: APIRequestContext,
  token: string,
  input: {
    bomLineId: string
    variantId?: string | null
    variantCondition?: Record<string, unknown> | null
    quantityOverride?: string | number | null
    productOverrideId?: string | null
    productVariantOverrideId?: string | null
    unitOverrideId?: string | null
  },
): Promise<{ id: string }> {
  const response = await apiRequest(request, 'POST', '/api/bom/bom-line-variant', {
    token,
    data: {
      bomLineId: input.bomLineId,
      variantId: input.variantId ?? null,
      variantCondition: input.variantCondition ?? null,
      quantityOverride: input.quantityOverride != null ? String(input.quantityOverride) : null,
      productOverrideId: input.productOverrideId ?? null,
      productVariantOverrideId: input.productVariantOverrideId ?? null,
      unitOverrideId: input.unitOverrideId ?? null,
    },
  })
  expect(
    response.ok(),
    `Failed to create BOM line variant: ${response.status()} ${await response.text().catch(() => '')}`,
  ).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id === 'string').toBeTruthy()
  return { id: body.id as string }
}

export async function deleteBomLineVariantIfExists(
  request: APIRequestContext,
  token: string | null,
  bomLineVariantId: string | null,
): Promise<void> {
  if (!token || !bomLineVariantId) return
  try {
    await apiRequest(
      request,
      'DELETE',
      `/api/bom/bom-line-variant?id=${encodeURIComponent(bomLineVariantId)}`,
      { token },
    )
  } catch {
    return
  }
}

// Where-used query helper per spec b §API. Matches on BomLine.product_id +
// BomLine.product_variant_id (when provided) + BomLineVariant override pair.
// productId is required; productVariantId narrows the match. Response items
// carry the MASTER product of each BomHeader, not the searched UUID.
export type WhereUsedItem = {
  bomHeaderId: string
  bomHeaderName: string
  productId: string
}

export async function queryWhereUsed(
  request: APIRequestContext,
  token: string,
  input: { productId: string; productVariantId?: string },
): Promise<WhereUsedItem[]> {
  const params = new URLSearchParams({ productId: input.productId })
  if (input.productVariantId) params.set('productVariantId', input.productVariantId)
  const response = await apiRequest(
    request,
    'GET',
    `/api/bom/bom/where-used?${params.toString()}`,
    { token },
  )
  expect(
    response.ok(),
    `where-used failed: ${response.status()} ${await response.text().catch(() => '')}`,
  ).toBeTruthy()
  const body = (await response.json()) as { items?: WhereUsedItem[] }
  return body.items ?? []
}

// Shape returned by the worker in resultSummary (mirrors ExplosionResult in
// lib/bom-explosion.ts). Named so the explodeBomAndWait signature is legible
// and consumers don't have to reach for ReturnType<> inference.
export type ExplosionSummary = {
  lines: Array<{
    bomLineId: string
    productId: string | null
    productVariantId: string | null
    quantity: number
    uomId: string | null
    scrapPercentage: number
    grossQuantity: number
    operationTemplateId: string | null
    level: number
    isPhantomPassThrough: boolean
    sourceBomHeaderId: string
    isConsumable: boolean
  }>
  warnings: Array<{ bomLineId: string | null; message: string }>
  depth: number
  lineCount: number
}

// Runtime shape probe — guards tests against silent drift in the worker's
// resultSummary contract (e.g. a future refactor that renames `warnings`).
// Cheap insurance; failure here turns a cryptic downstream assertion into a
// targeted error at the helper boundary.
function assertExplosionSummaryShape(value: unknown): asserts value is ExplosionSummary {
  if (!value || typeof value !== 'object') {
    throw new Error('explode resultSummary missing or not an object')
  }
  const candidate = value as Record<string, unknown>
  if (!Array.isArray(candidate.lines)) {
    throw new Error('explode resultSummary.lines is not an array — worker contract drift?')
  }
  if (!Array.isArray(candidate.warnings)) {
    throw new Error('explode resultSummary.warnings is not an array — worker contract drift?')
  }
  if (typeof candidate.depth !== 'number') {
    throw new Error('explode resultSummary.depth is not a number — worker contract drift?')
  }
}

// Async BOM explosion via the queue worker. Posts to /api/bom/bom/explode
// (returns a progress jobId), then polls /api/progress/jobs/{id} until
// terminal status. The worker's resultSummary carries the full explosion
// payload; tests read `lines` / `warnings` / `depth` off it.
//
// Polling cadence: short initial wait (most local-queue jobs complete in
// under 50 ms), then 200 ms cadence. Keeps the HTTP round-trip count low
// for synchronous local-queue runs without extending async-queue latency
// perceptibly. Timeout default 15 s — ample for a single-BOM fixture even
// on dev-container cold starts.
export async function explodeBomAndWait(
  request: APIRequestContext,
  token: string,
  input: {
    bomHeaderId: string
    variantConditions?: Record<string, string>
    effectiveDate?: string
    maxDepth?: number
    timeoutMs?: number
  },
): Promise<ExplosionSummary> {
  const enqueue = await apiRequest(request, 'POST', '/api/bom/bom/explode', {
    token,
    data: {
      bomHeaderId: input.bomHeaderId,
      variantConditions: input.variantConditions ?? {},
      effectiveDate: input.effectiveDate,
      maxDepth: input.maxDepth,
    },
  })
  expect(
    enqueue.ok(),
    `Failed to enqueue BOM explosion: ${enqueue.status()} ${await enqueue.text().catch(() => '')}`,
  ).toBeTruthy()
  const enqueueBody = (await enqueue.json()) as { jobId?: string }
  const jobId = enqueueBody.jobId
  expect(typeof jobId === 'string' && jobId.length > 0, 'explode response missing jobId').toBeTruthy()

  const deadline = Date.now() + (input.timeoutMs ?? 15_000)
  let lastStatus: string | undefined
  let firstPoll = true
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, firstPoll ? 50 : 200))
    firstPoll = false

    const poll = await apiRequest(
      request,
      'GET',
      `/api/progress/jobs/${encodeURIComponent(jobId as string)}`,
      { token },
    )
    if (poll.ok()) {
      const job = (await poll.json()) as {
        status: string
        resultSummary?: Record<string, unknown>
        errorMessage?: string | null
      }
      lastStatus = job.status
      if (job.status === 'completed') {
        const summary = job.resultSummary ?? {}
        assertExplosionSummaryShape(summary)
        return summary
      }
      if (job.status === 'failed') {
        throw new Error(`BOM explosion job ${jobId} failed: ${job.errorMessage ?? '(no error message)'}`)
      }
    }
  }
  throw new Error(`BOM explosion job ${jobId} did not complete within timeout (last status: ${lastStatus ?? 'unknown'})`)
}
