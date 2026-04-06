import type { ProductionMethod, LifecycleState } from '../data/entities'

export type ResolveResult = {
  productionMethod: ProductionMethod | null
  fallback: 'variant_match' | 'default' | 'none'
  warnings: string[]
}

/**
 * Resolve the best ProductionMethod for a product given optional variant conditions.
 *
 * Resolution logic (pure function):
 * 1. Filter to active PMs (lifecycle_state = 'active', deleted_at IS NULL)
 * 2. If variantConditions provided: find PM whose variant_condition matches (AND-match)
 * 3. If no variant match: fall back to is_default = true PM
 * 4. If no default: return null with warning
 */
export function resolveProductionMethod(
  productionMethods: ProductionMethod[],
  variantConditions?: Record<string, string[]>,
): ResolveResult {
  const warnings: string[] = []

  const activeMethods = productionMethods.filter(
    (pm) => pm.lifecycleState === ('active' as LifecycleState) && !pm.deletedAt,
  )

  if (activeMethods.length === 0) {
    return { productionMethod: null, fallback: 'none', warnings: ['No active production methods found'] }
  }

  if (variantConditions && Object.keys(variantConditions).length > 0) {
    const matched = activeMethods.find((pm) => matchesVariantCondition(pm.variantCondition, variantConditions))
    if (matched) {
      return { productionMethod: matched, fallback: 'variant_match', warnings }
    }
    warnings.push('No production method matches the given variant conditions, falling back to default')
  }

  const defaultMethod = activeMethods.find((pm) => pm.isDefault)
  if (defaultMethod) {
    return { productionMethod: defaultMethod, fallback: 'default', warnings }
  }

  warnings.push('No matching production method')
  return { productionMethod: null, fallback: 'none', warnings }
}

/**
 * AND-match: every key in the PM's variant_condition must have at least one value
 * present in the provided variantConditions for that key.
 */
function matchesVariantCondition(
  pmCondition: Record<string, unknown> | null | undefined,
  variantConditions: Record<string, string[]>,
): boolean {
  if (!pmCondition || Object.keys(pmCondition).length === 0) return false

  for (const [key, expected] of Object.entries(pmCondition)) {
    const provided = variantConditions[key]
    if (!provided || !Array.isArray(provided)) return false

    const expectedValues = Array.isArray(expected) ? expected : [expected]
    const hasMatch = expectedValues.some((val) => provided.includes(String(val)))
    if (!hasMatch) return false
  }

  return true
}
