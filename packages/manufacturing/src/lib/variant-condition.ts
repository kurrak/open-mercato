/**
 * Shared variant condition matching logic.
 *
 * Used by BOM explosion, routing time rollup, and configurator resolution.
 */

/**
 * Match a variant condition against input conditions.
 *
 * Format: { "key": ["value1", "value2"] } — all keys must match (AND).
 * Negation: { "key": { "not": ["value"] } } — excludes matching values.
 *
 * @returns true if all condition keys match the input
 */
export function matchVariantCondition(
  lineCondition: Record<string, unknown>,
  inputConditions: Record<string, string[]>,
): boolean {
  for (const [key, conditionValue] of Object.entries(lineCondition)) {
    const inputValues = inputConditions[key]
    if (!inputValues || inputValues.length === 0) return false

    if (
      typeof conditionValue === 'object' &&
      conditionValue !== null &&
      !Array.isArray(conditionValue) &&
      'not' in conditionValue
    ) {
      const negatedValues = (conditionValue as { not: string[] }).not
      if (inputValues.some((v) => negatedValues.includes(v))) return false
    } else if (Array.isArray(conditionValue)) {
      const allowedValues = conditionValue as string[]
      if (!inputValues.some((v) => allowedValues.includes(v))) return false
    } else {
      return false
    }
  }
  return true
}
