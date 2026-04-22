/**
 * Shared variant condition matching logic.
 *
 * Used by BOM explosion (Step 1 filter + BomLineVariant override activation),
 * routing time rollup, and production-method resolution.
 *
 * Asymmetry between the two arguments is deliberate:
 *   - `lineCondition` is a *filter* on a persisted row (e.g. BomLine.variant_condition,
 *     OperationTemplateVariant.variant_condition) and keeps its array shape:
 *     `{ key: ['A', 'B'] }` means "active when the user picked A OR B";
 *     `{ key: { not: ['C'] } }` means "active when the user did not pick C".
 *   - `inputConditions` is the *user's resolved selection* — one value per
 *     attribute — and is `Record<string, string>` per spec b's 2026-04-17
 *     amendment. The user picks exactly one value per configuration axis.
 *
 * The matcher is therefore scalar-in-array inclusion (and scalar-not-in-array
 * for negation).
 */
/**
 * Coerce a raw ConfigurationForm / configurator snapshot into the
 * `Record<string, string>` shape expected by the configurator resolve
 * endpoint, `/time-rollup`'s `variantConditions`, and any other
 * downstream that matches against persisted `variant_condition` JSONB
 * via `matchVariantCondition`. Scalars stringify; null / undefined /
 * empty-string / non-scalar values drop silently.
 *
 * Shared by BOM's explosion panel and routing's time-rollup panel so a
 * change to the coercion contract (e.g. adding array-valued
 * ConfigAttribute types) fans out to both at once.
 */
export function coerceSnapshotToStrings(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue
    if (typeof value === 'string') {
      if (value.length > 0) out[key] = value
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      out[key] = String(value)
    }
  }
  return out
}

export function matchVariantCondition(
  lineCondition: Record<string, unknown>,
  inputConditions: Record<string, string>,
): boolean {
  for (const [key, conditionValue] of Object.entries(lineCondition)) {
    const inputValue = inputConditions[key]
    if (inputValue === undefined || inputValue === null || inputValue === '') return false

    if (
      typeof conditionValue === 'object' &&
      conditionValue !== null &&
      !Array.isArray(conditionValue) &&
      'not' in conditionValue
    ) {
      const negatedValues = (conditionValue as { not: string[] }).not
      if (negatedValues.includes(inputValue)) return false
    } else if (Array.isArray(conditionValue)) {
      const allowedValues = conditionValue as string[]
      if (!allowedValues.includes(inputValue)) return false
    } else {
      return false
    }
  }
  return true
}
