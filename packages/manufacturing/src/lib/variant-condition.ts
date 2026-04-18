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
