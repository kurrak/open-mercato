/**
 * BOM Explosion Algorithm — Pure function, no DB dependency.
 *
 * Recursively flattens a multi-level BOM into a flat material list.
 * Handles: phantom pass-through, date-effective lines, variant conditions (AND + negation),
 * BomLineVariant overrides, and max depth limiting.
 */

// ---------------------------------------------------------------------------
// Types
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

export type ExplosionInput = {
  bomHeaderId: string
  variantConditions: Record<string, string[]>
  effectiveDate: Date
  maxDepth: number
}

export type ExplosionLine = {
  bomLineId: string
  productId: string | null
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

export type ExplosionResult = {
  lines: ExplosionLine[]
  warnings: string[]
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
// BomLineVariant Override Application
// ---------------------------------------------------------------------------

function applyLineVariantOverrides(
  line: BomLineData,
  variants: BomLineVariantData[],
  inputConditions: Record<string, string[]>,
  variantId?: string,
): { productId: string | null; quantity: string | null; uomId: string | null } {
  let productId = line.productId
  let quantity = line.netQuantity
  let uomId = line.uomId

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
      if (variant.productOverrideId) productId = variant.productOverrideId
      if (variant.quantityOverride) quantity = variant.quantityOverride
      if (variant.unitOverrideId) uomId = variant.unitOverrideId
      break
    }
  }

  return { productId, quantity, uomId }
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
): Promise<ExplosionResult> {
  const result: ExplosionResult = { lines: [], warnings: [], depth: 0 }
  const visited = new Set<string>()

  async function recurse(bomHeaderId: string, level: number, isPhantomContext: boolean): Promise<void> {
    if (level > input.maxDepth) {
      result.warnings.push(`Max depth (${input.maxDepth}) exceeded at BOM ${bomHeaderId}`)
      return
    }

    if (visited.has(bomHeaderId)) {
      result.warnings.push(`Circular reference detected: BOM ${bomHeaderId} already visited`)
      return
    }
    visited.add(bomHeaderId)

    if (level > result.depth) result.depth = level

    const header = await loader.loadHeader(bomHeaderId)
    if (!header) {
      result.warnings.push(`BOM header ${bomHeaderId} not found`)
      visited.delete(bomHeaderId)
      return
    }

    if (!header.isActive) {
      result.warnings.push(`BOM ${bomHeaderId} (${header.productId}) is inactive — skipped`)
      visited.delete(bomHeaderId)
      return
    }

    const allLines = await loader.loadLines(bomHeaderId)
    const allLineIds = allLines.map((l) => l.id)
    const allVariants = allLineIds.length > 0 ? await loader.loadLineVariants(allLineIds) : []

    for (const line of allLines) {
      // Step 2a: Date-effective filtering
      if (!isDateEffective(line, input.effectiveDate)) continue

      // Step 2b: Variant condition filtering
      if (line.variantCondition) {
        if (!matchVariantCondition(line.variantCondition as Record<string, unknown>, input.variantConditions)) {
          continue
        }
      }

      // Step 3: Apply BomLineVariant overrides
      const overrides = applyLineVariantOverrides(line, allVariants, input.variantConditions)

      // Step 4: Handle semi_product (child BOM reference)
      if (line.lineType === 'semi_product' && line.childBomHeaderId) {
        const childHeader = await loader.loadHeader(line.childBomHeaderId)

        if (childHeader && childHeader.isPhantom) {
          // Phantom: recurse and merge child lines into current level
          await recurse(line.childBomHeaderId, level, true)
        } else if (childHeader) {
          // Non-phantom sub-assembly: add as a line, then recurse for its children
          const qty = parseFloat(overrides.quantity ?? '0')
          const scrap = parseFloat(line.scrapPercentage ?? '0')
          result.lines.push({
            bomLineId: line.id,
            productId: overrides.productId,
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
          result.warnings.push(`Child BOM ${line.childBomHeaderId} not found for line ${line.id}`)
        }
        continue
      }

      // Material line
      if (!overrides.productId) {
        result.warnings.push(`Line ${line.id} has null product_id — skipped`)
        continue
      }

      const qty = parseFloat(overrides.quantity ?? '0')
      const scrap = parseFloat(line.scrapPercentage ?? '0')

      result.lines.push({
        bomLineId: line.id,
        productId: overrides.productId,
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
