import type { ConfigAttribute } from '../data/entities'

export type NamespaceValidationResult = {
  valid: boolean
  unknownKeys: string[]
  warnings: string[]
}

export function validateNamespace(
  variantCondition: Record<string, unknown>,
  attributes: ConfigAttribute[],
): NamespaceValidationResult {
  const knownKeys = new Set(attributes.map((a) => a.key))
  const conditionKeys = Object.keys(variantCondition)
  const unknownKeys: string[] = []
  const warnings: string[] = []

  for (const key of conditionKeys) {
    if (!knownKeys.has(key)) {
      unknownKeys.push(key)
    }
  }

  if (attributes.length === 0) {
    warnings.push('No ConfigAttributes defined for this product — all keys are unverified')
  }

  if (unknownKeys.length > 0) {
    warnings.push(
      `Unknown variant_condition keys: ${unknownKeys.join(', ')}. These do not match any ConfigAttribute.key for this product`,
    )
  }

  return {
    valid: unknownKeys.length === 0,
    unknownKeys,
    warnings,
  }
}
