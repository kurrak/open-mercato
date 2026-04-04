/**
 * Pure UoM conversion utilities.
 * Used by BOM explosion, MRP, and other quantity-dependent algorithms.
 */

export type ConversionEntry = {
  fromUomId: string
  toUomId: string
  factor: string
}

/**
 * Convert a quantity from one UoM to another using a set of conversion entries.
 * Supports direct conversions and single-step reverse lookups.
 *
 * @returns converted quantity as string (high precision), or null if no conversion path found
 */
export function convertQuantity(
  quantity: string,
  fromUomId: string,
  toUomId: string,
  conversions: ConversionEntry[],
): string | null {
  if (fromUomId === toUomId) return quantity

  const qty = parseFloat(quantity)
  if (isNaN(qty)) return null

  // Direct lookup
  const direct = conversions.find(
    (c) => c.fromUomId === fromUomId && c.toUomId === toUomId,
  )
  if (direct) {
    const factor = parseFloat(direct.factor)
    if (isNaN(factor) || factor === 0) return null
    return String(qty * factor)
  }

  // Reverse lookup
  const reverse = conversions.find(
    (c) => c.fromUomId === toUomId && c.toUomId === fromUomId,
  )
  if (reverse) {
    const factor = parseFloat(reverse.factor)
    if (isNaN(factor) || factor === 0) return null
    return String(qty / factor)
  }

  return null
}

/**
 * Validate that a conversion factor is positive and non-zero.
 */
export function isValidConversionFactor(factor: string): boolean {
  const parsed = parseFloat(factor)
  return !isNaN(parsed) && parsed > 0 && isFinite(parsed)
}

/**
 * Compute the reverse factor for a conversion.
 * e.g., if 1 meter = 100 centimeters (factor 100), reverse is 0.01
 */
export function reverseConversionFactor(factor: string): string | null {
  const parsed = parseFloat(factor)
  if (isNaN(parsed) || parsed === 0) return null
  return String(1 / parsed)
}
