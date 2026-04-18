/**
 * BOM Explosion Algorithm — Pure function, no DB dependency.
 *
 * Recursively flattens a multi-level BOM into a flat material list.
 * Handles: phantom pass-through, date-effective lines, variant-condition
 * activation, dynamic product resolution (Step 2, spec b §BOM Explosion
 * Algorithm), BomLineVariant override pair (product + productVariant),
 * and max depth limiting.
 *
 * Step order per spec b 2026-04-17 amendment:
 *   1. Filter BomLines (date-effective + variant_condition)
 *   2. Resolve dynamic products (product_resolve_key → type-directed lookup)
 *   3. Apply BomLineVariant overrides (pair: productOverrideId + productVariantOverrideId)
 *   4. Phantom pass-through / sub-assembly handling
 *   5. Recurse
 */

// ---------------------------------------------------------------------------
// Types — BOM graph (existing shape)
// ---------------------------------------------------------------------------

export type BomHeaderData = {
  id: string
  productId: string
  isPhantom: boolean
  isActive: boolean
}

export type BomLineData = {
  id: string
  bomHeaderId: string
  lineType: 'material' | 'semi_product'
  productId: string | null
  productVariantId: string | null
  productResolveKey: string | null
  childBomHeaderId: string | null
  netQuantity: string | null
  grossQuantity: string | null
  scrapPercentage: string
  uomId: string | null
  variantCondition: Record<string, unknown> | null
  operationTemplateId: string | null
  sortOrder: number
  validFrom: Date | null
  validTo: Date | null
  isConsumable: boolean
}

export type BomLineVariantData = {
  id: string
  bomLineId: string
  variantId: string | null
  variantCondition: Record<string, unknown> | null
  quantityOverride: string | null
  productOverrideId: string | null
  productVariantOverrideId: string | null
  unitOverrideId: string | null
}

// ---------------------------------------------------------------------------
// Types — ExplosionContext (pre-loaded maps passed by the worker)
// ---------------------------------------------------------------------------

// Flat data shapes — no ORM imports. The worker projects CatalogProduct /
// CatalogProductVariant / ConfigAttribute rows into these before calling
// explodeBom, so the pure function stays DB-free and trivially unit-testable.

export type ConfigAttributeData = {
  key: string
  // Mirrors spec b/d attribute_type enum. Step 2 branches on this to pick
  // the right catalog table. Only 'product' and 'product_variant' drive
  // dynamic resolution; other types can't resolve to a catalog row and
  // should produce a warning if the BomLine references them via
  // product_resolve_key.
  attributeType: 'enum' | 'numeric_range' | 'boolean' | 'text' | 'product' | 'product_variant'
}

export type CatalogProductData = {
  id: string
}

export type CatalogProductVariantData = {
  id: string
  productId: string
}

export type ExplosionContext = {
  // Built from the top-level master product's ConfigAttribute records (single
  // query at the start of explosion). Same map is reused at every level of
  // recursion — matches the namespace rule that governs variant_condition keys.
  configAttributesByKey: Map<string, ConfigAttributeData>
  // Pre-loaded by the worker from the UUIDs referenced in the BOM graph
  // (static product_id + variantConditions values for 'product' attributes +
  // productOverrideId on BomLineVariants).
  catalogProducts: Map<string, CatalogProductData>
  // Same, for variants referenced via product_variant_id / variantConditions
  // 'product_variant' values / productVariantOverrideId.
  catalogProductVariants: Map<string, CatalogProductVariantData>
}

// ---------------------------------------------------------------------------
// Types — ExplosionInput / ExplosionLine / ExplosionResult
// ---------------------------------------------------------------------------

export type ExplosionInput = {
  bomHeaderId: string
  // One selected value per attribute key (spec b 2026-04-17). UUIDs for
  // attribute_type = 'product' / 'product_variant'; raw option strings for
  // 'enum' / 'boolean' / 'text' / 'numeric_range'. The configurator's
  // resolvedConditions already produces this shape (spec d §Output).
  // Filter arrays on BomLine.variant_condition itself stay as arrays —
  // matchVariantCondition does scalar-in-array inclusion.
  variantConditions: Record<string, string>
  effectiveDate: Date
  maxDepth: number
}

export type ExplosionLine = {
  bomLineId: string
  // Post-override. Null means the line could not be resolved to a concrete
  // Product at any step (static null, Step 2 failure, no override saved it).
  // B4 currently still skips lines with null productId; B5 flips the contract
  // to emit the row with null so the UI can display it muted.
  productId: string | null
  // Post-override. Null when: (a) static line had no variant pin; (b) Step 2
  // resolved to a 'product' attribute (no variant); (c) override had
  // productOverrideId set without productVariantOverrideId.
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
}

// Structured explosion warning (spec b B5 soft-error contract).
//
// `bomLineId` identifies the owning BomLine when the warning is line-specific
// (failed dynamic resolution, malformed override, null product, etc.). Graph-
// level warnings that aren't tied to a particular line (max depth exceeded,
// circular reference, BOM header not found, inactive BOM, child BOM missing
// for a semi_product reference) carry `bomLineId: null`.
//
// Consumers (MRP, work orders, purchasing) can use `warningsByLineId(result)`
// to fetch all warnings for a specific emitted row; UI renderers can surface
// line-specific warnings next to muted-styled null-productId rows.
export type ExplosionWarning = {
  bomLineId: string | null
  message: string
}

export type ExplosionResult = {
  lines: ExplosionLine[]
  warnings: ExplosionWarning[]
  depth: number
}

export type BomDataLoader = {
  loadHeader: (bomHeaderId: string) => Promise<BomHeaderData | null>
  loadLines: (bomHeaderId: string) => Promise<BomLineData[]>
  loadLineVariants: (bomLineIds: string[]) => Promise<BomLineVariantData[]>
}

// ---------------------------------------------------------------------------
// Variant Condition Matching — imported from shared package lib
// ---------------------------------------------------------------------------

import { matchVariantCondition as _matchVariantCondition } from '../../../lib/variant-condition'

export const matchVariantCondition = _matchVariantCondition

// ---------------------------------------------------------------------------
// Date-Effective Filtering
// ---------------------------------------------------------------------------

function isDateEffective(line: BomLineData, effectiveDate: Date): boolean {
  if (line.validFrom && effectiveDate < line.validFrom) return false
  if (line.validTo && effectiveDate > line.validTo) return false
  return true
}

// ---------------------------------------------------------------------------
// Step 2: Type-Directed Dynamic Product Resolution
// ---------------------------------------------------------------------------

// Returns the resolved (productId, productVariantId) pair when the line has
// a product_resolve_key set, plus an optional warning message describing why
// resolution failed. The caller attaches bomLineId when pushing the warning
// into the structured result — messages here omit the "Line <id>:" prefix
// that the old string-warnings shape used. The caller may discard the warning
// if Step 3 (override) later fills in productId.
function resolveFromResolveKey(
  line: BomLineData,
  inputConditions: Record<string, string>,
  context: ExplosionContext,
): { productId: string | null; productVariantId: string | null; warning: string | null } {
  const key = line.productResolveKey
  if (!key) {
    return { productId: line.productId, productVariantId: line.productVariantId, warning: null }
  }

  // B2 Zod (spec b §BomLine Constraints) forbids semi_product lines from
  // carrying product_resolve_key — they reference a child BOM, not a
  // concrete product. Defense-in-depth for bypass paths (migration /
  // direct-SQL writes): surface a dedicated warning rather than running
  // Step 2 on a line that can't meaningfully resolve to a catalog row.
  if (line.lineType !== 'material') {
    return {
      productId: null,
      productVariantId: null,
      warning: `product_resolve_key on '${line.lineType}' line violates spec — Zod invariant bypassed; ignoring resolve key`,
    }
  }

  // B2 Zod forbids lines from carrying both product_id and product_resolve_key
  // (static XOR dynamic). Defense-in-depth: spec b line 146 mandates that
  // Step 2 detects the inconsistency, leaves productId null, and warns.
  if (line.productId) {
    return {
      productId: null,
      productVariantId: null,
      warning: `carries both product_id and product_resolve_key — Zod invariant bypassed; treating as unresolved`,
    }
  }

  const attr = context.configAttributesByKey.get(key)
  if (!attr) {
    return {
      productId: null,
      productVariantId: null,
      warning: `resolve key '${key}' has no matching ConfigAttribute on the master product`,
    }
  }

  const val = inputConditions[key]
  if (val === undefined || val === null || val === '') {
    return {
      productId: null,
      productVariantId: null,
      warning: `resolve key '${key}' missing from variantConditions`,
    }
  }

  if (attr.attributeType === 'product') {
    const product = context.catalogProducts.get(val)
    if (!product) {
      return {
        productId: null,
        productVariantId: null,
        warning: `product '${val}' for key '${key}' not found in catalog`,
      }
    }
    return { productId: product.id, productVariantId: null, warning: null }
  }

  if (attr.attributeType === 'product_variant') {
    const variant = context.catalogProductVariants.get(val)
    if (!variant) {
      return {
        productId: null,
        productVariantId: null,
        warning: `product variant '${val}' for key '${key}' not found in catalog`,
      }
    }
    return { productId: variant.productId, productVariantId: variant.id, warning: null }
  }

  // enum / boolean / text / numeric_range — cannot drive dynamic resolution.
  return {
    productId: null,
    productVariantId: null,
    warning: `attribute_type '${attr.attributeType}' for key '${key}' does not drive dynamic product resolution`,
  }
}

// ---------------------------------------------------------------------------
// Step 3: BomLineVariant Override Application
// ---------------------------------------------------------------------------

// Returns the line's final (productId, productVariantId, quantity, uomId)
// after applying the first matching BomLineVariant override. The `starting`
// pair carries the line's static product (after Step 2 has replaced it for
// dynamic lines).
//
// Override pair semantics (spec b §BomLineVariant Constraints):
//   - Both productOverrideId and productVariantOverrideId null → no product
//     override; the starting pair flows through.
//   - productOverrideId set, productVariantOverrideId null → product
//     overridden; productVariantId reset to null (override Product may not
//     have variants, or no specific variant is pinned).
//   - Both set → product + variant overridden from the pair.
//   - productVariantOverrideId set WITHOUT productOverrideId → malformed
//     (B2 Zod should have rejected it on save; defensive here). Skip the
//     override pair, emit a warning.
function applyLineVariantOverrides(
  line: BomLineData,
  variants: BomLineVariantData[],
  inputConditions: Record<string, string>,
  starting: { productId: string | null; productVariantId: string | null },
  variantId?: string,
): {
  productId: string | null
  productVariantId: string | null
  quantity: string | null
  uomId: string | null
  warning: string | null
} {
  let productId = starting.productId
  let productVariantId = starting.productVariantId
  let quantity = line.netQuantity
  let uomId = line.uomId
  let warning: string | null = null

  for (const variant of variants) {
    if (variant.bomLineId !== line.id) continue

    let matches = false
    if (variant.variantId && variantId) {
      matches = variant.variantId === variantId
    } else if (variant.variantCondition) {
      matches = matchVariantCondition(
        variant.variantCondition as Record<string, unknown>,
        inputConditions,
      )
    }

    if (matches) {
      if (variant.productOverrideId) {
        productId = variant.productOverrideId
        productVariantId = variant.productVariantOverrideId ?? null
      } else if (variant.productVariantOverrideId) {
        // Malformed pair: variant override without product override. Zod
        // should have caught this; preserve the starting pair and flag.
        warning = `BomLineVariant ${variant.id} has product_variant_override_id without product_override_id — override skipped`
      }
      if (variant.quantityOverride) quantity = variant.quantityOverride
      if (variant.unitOverrideId) uomId = variant.unitOverrideId
      break
    }
  }

  return { productId, productVariantId, quantity, uomId, warning }
}

// ---------------------------------------------------------------------------
// Gross Quantity Computation
// ---------------------------------------------------------------------------

function computeGrossQuantity(netQuantity: number, scrapPercentage: number): number {
  if (scrapPercentage <= 0 || scrapPercentage >= 100) return netQuantity
  return netQuantity / (1 - scrapPercentage / 100)
}

// ---------------------------------------------------------------------------
// Main Explosion Algorithm
// ---------------------------------------------------------------------------

export async function explodeBom(
  input: ExplosionInput,
  loader: BomDataLoader,
  context: ExplosionContext,
): Promise<ExplosionResult> {
  const result: ExplosionResult = { lines: [], warnings: [], depth: 0 }
  const visited = new Set<string>()

  // Graph-level warnings (max depth, cycle, BOM not found / inactive)
  // carry bomLineId: null — they aren't tied to a specific emitted row.
  // Line-specific warnings (Step 2 / Step 3 failures, child BOM missing
  // for a semi-product reference, null-productId emit) carry the owning
  // line.id so UI renderers + warningsByLineId can route them.
  function warnGraph(message: string): void {
    result.warnings.push({ bomLineId: null, message })
  }
  function warnLine(bomLineId: string, message: string): void {
    result.warnings.push({ bomLineId, message })
  }

  async function recurse(bomHeaderId: string, level: number, isPhantomContext: boolean): Promise<void> {
    if (level > input.maxDepth) {
      warnGraph(`Max depth (${input.maxDepth}) exceeded at BOM ${bomHeaderId}`)
      return
    }

    if (visited.has(bomHeaderId)) {
      warnGraph(`Circular reference detected: BOM ${bomHeaderId} already visited`)
      return
    }
    visited.add(bomHeaderId)

    if (level > result.depth) result.depth = level

    const header = await loader.loadHeader(bomHeaderId)
    if (!header) {
      warnGraph(`BOM header ${bomHeaderId} not found`)
      visited.delete(bomHeaderId)
      return
    }

    if (!header.isActive) {
      warnGraph(`BOM ${bomHeaderId} (${header.productId}) is inactive — skipped`)
      visited.delete(bomHeaderId)
      return
    }

    const allLines = await loader.loadLines(bomHeaderId)
    const allLineIds = allLines.map((l) => l.id)
    const allVariants = allLineIds.length > 0 ? await loader.loadLineVariants(allLineIds) : []

    for (const line of allLines) {
      // Step 1a: Date-effective filtering
      if (!isDateEffective(line, input.effectiveDate)) continue

      // Step 1b: Variant condition filtering
      if (line.variantCondition) {
        if (!matchVariantCondition(line.variantCondition as Record<string, unknown>, input.variantConditions)) {
          continue
        }
      }

      // Step 2: Dynamic product resolution. Static lines (no resolve key)
      // fall through unchanged — resolveFromResolveKey returns the line's
      // static pair with no warning.
      const step2 = resolveFromResolveKey(line, input.variantConditions, context)
      const pendingMessages: string[] = []
      if (step2.warning) pendingMessages.push(step2.warning)

      // Step 3: BomLineVariant override (pair semantics).
      const overrides = applyLineVariantOverrides(
        line,
        allVariants,
        input.variantConditions,
        { productId: step2.productId, productVariantId: step2.productVariantId },
      )
      if (overrides.warning) pendingMessages.push(overrides.warning)

      // If Step 3 filled in productId, Step 2's failure warning is stale —
      // discard it. The override-pair malformed warning (if any) is kept.
      if (overrides.productId && step2.warning) {
        const idx = pendingMessages.indexOf(step2.warning)
        if (idx >= 0) pendingMessages.splice(idx, 1)
      }

      const flushPending = () => {
        for (const message of pendingMessages) warnLine(line.id, message)
        pendingMessages.length = 0
      }

      // Step 4: Handle semi_product (child BOM reference)
      if (line.lineType === 'semi_product' && line.childBomHeaderId) {
        const childHeader = await loader.loadHeader(line.childBomHeaderId)

        if (childHeader && childHeader.isPhantom) {
          // Phantom: recurse and merge child lines into current level
          flushPending()
          await recurse(line.childBomHeaderId, level, true)
        } else if (childHeader) {
          // Non-phantom sub-assembly: add as a line, then recurse for its children
          flushPending()
          const qty = parseFloat(overrides.quantity ?? '0')
          const scrap = parseFloat(line.scrapPercentage ?? '0')
          result.lines.push({
            bomLineId: line.id,
            productId: overrides.productId,
            productVariantId: overrides.productVariantId,
            quantity: qty,
            uomId: overrides.uomId,
            scrapPercentage: scrap,
            grossQuantity: computeGrossQuantity(qty, scrap),
            operationTemplateId: line.operationTemplateId,
            level,
            isPhantomPassThrough: isPhantomContext,
            sourceBomHeaderId: bomHeaderId,
            isConsumable: line.isConsumable,
          })
          await recurse(line.childBomHeaderId, level + 1, false)
        } else {
          flushPending()
          warnLine(line.id, `Child BOM ${line.childBomHeaderId} not found`)
        }
        continue
      }

      // Material line.
      //
      // B5: unresolved lines (productId: null after Step 2 + Step 3) are
      // emitted — matches the semi-product branch above — so the UI can
      // surface muted-styled rows. Downstream planning consumers (MRP,
      // work orders, purchasing) MUST filter `productId === null` rows
      // out of demand totals. The attached warning (flushed below,
      // keyed by bomLineId) carries the reason.
      if (!overrides.productId) {
        pendingMessages.push(
          'line emitted with null product_id — excluded from planning totals',
        )
      }
      flushPending()

      const qty = parseFloat(overrides.quantity ?? '0')
      const scrap = parseFloat(line.scrapPercentage ?? '0')

      result.lines.push({
        bomLineId: line.id,
        productId: overrides.productId,
        productVariantId: overrides.productVariantId,
        quantity: qty,
        uomId: overrides.uomId,
        scrapPercentage: scrap,
        grossQuantity: computeGrossQuantity(qty, scrap),
        operationTemplateId: line.operationTemplateId,
        level,
        isPhantomPassThrough: isPhantomContext,
        sourceBomHeaderId: bomHeaderId,
        isConsumable: line.isConsumable,
      })
    }

    visited.delete(bomHeaderId)
  }

  await recurse(input.bomHeaderId, 0, false)
  return result
}

// ---------------------------------------------------------------------------
// Consumer helpers
// ---------------------------------------------------------------------------

// Groups line-specific warnings by bomLineId so UI renderers (e.g. BOM tree
// view row inspector) can fetch warnings alongside the matching ExplosionLine
// without re-scanning the warnings array. Graph-level warnings (bomLineId:
// null) are not included — consumers that need them should read
// `result.warnings.filter(w => w.bomLineId === null)` directly.
//
// Return type is read-only to signal that the grouping is derived state —
// consumers should not mutate it (e.g. to suppress warnings); mutating the
// source of truth means changing `result.warnings`.
export function warningsByLineId(result: ExplosionResult): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, string[]>()
  for (const warning of result.warnings) {
    if (warning.bomLineId === null) continue
    const existing = grouped.get(warning.bomLineId)
    if (existing) existing.push(warning.message)
    else grouped.set(warning.bomLineId, [warning.message])
  }
  return grouped
}
