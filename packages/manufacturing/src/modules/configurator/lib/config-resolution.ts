import type { ConfigAttribute, ConstraintRule, ActionType } from '../data/entities'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResolutionInput = {
  productId: string
  configSnapshot: Record<string, string>
  attributes: ConfigAttribute[]
  rules: ConstraintRule[]
}

export type ResolutionResult = {
  resolvedConditions: Record<string, string[]>
  resolvedSnapshot: Record<string, string>
  errors: string[]
  warnings: string[]
  appliedRules: string[]
}

// ---------------------------------------------------------------------------
// Condition matching (same logic as BOM explosion variant_condition)
// ---------------------------------------------------------------------------

function matchesCondition(
  conditionJson: Record<string, unknown>,
  snapshot: Record<string, string>,
): boolean {
  for (const [key, condition] of Object.entries(conditionJson)) {
    const snapshotValue = snapshot[key]
    if (snapshotValue === undefined) return false

    if (Array.isArray(condition)) {
      if (!condition.includes(snapshotValue)) return false
    } else if (
      condition !== null &&
      typeof condition === 'object' &&
      'not' in condition &&
      Array.isArray((condition as { not: string[] }).not)
    ) {
      if ((condition as { not: string[] }).not.includes(snapshotValue)) return false
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Action application
// ---------------------------------------------------------------------------

type ActionContext = {
  snapshot: Record<string, string>
  narrowedValues: Map<string, Set<string>>
  errors: string[]
  warnings: string[]
  appliedRules: string[]
  attributeMap: Map<string, ConfigAttribute>
}

function applyAction(
  rule: ConstraintRule,
  ctx: ActionContext,
): boolean {
  const actionType = rule.actionType as ActionType
  const actionData = rule.actionData as Record<string, unknown>
  let changed = false

  switch (actionType) {
    case 'restrict_values': {
      for (const [targetKey, allowedRaw] of Object.entries(actionData)) {
        if (Array.isArray(allowedRaw)) {
          const allowedSet = new Set(allowedRaw as string[])
          const existing = ctx.narrowedValues.get(targetKey)
          if (existing) {
            const intersection = new Set([...existing].filter((v) => allowedSet.has(v)))
            ctx.narrowedValues.set(targetKey, intersection)
          } else {
            ctx.narrowedValues.set(targetKey, allowedSet)
          }
          const currentValue = ctx.snapshot[targetKey]
          if (currentValue !== undefined && !allowedSet.has(currentValue)) {
            ctx.warnings.push(
              `Rule "${rule.description ?? rule.id}": current value "${currentValue}" for "${targetKey}" is no longer allowed`,
            )
          }
        }
      }
      break
    }

    case 'exclude_combination': {
      ctx.errors.push(
        `Rule "${rule.description ?? rule.id}": invalid combination detected`,
      )
      break
    }

    case 'require_value': {
      for (const [targetKey, requiredValue] of Object.entries(actionData)) {
        if (typeof requiredValue === 'string') {
          const currentValue = ctx.snapshot[targetKey]
          if (currentValue !== requiredValue) {
            if (currentValue !== undefined) {
              ctx.warnings.push(
                `Rule "${rule.description ?? rule.id}": changed "${targetKey}" from "${currentValue}" to "${requiredValue}"`,
              )
            }
            ctx.snapshot[targetKey] = requiredValue
            changed = true
          }
        }
      }
      break
    }

    case 'set_default': {
      for (const [targetKey, defaultValue] of Object.entries(actionData)) {
        if (typeof defaultValue === 'string' && ctx.snapshot[targetKey] === undefined) {
          ctx.snapshot[targetKey] = defaultValue
          changed = true
        }
      }
      break
    }
  }

  ctx.appliedRules.push(rule.id)
  return changed
}

// ---------------------------------------------------------------------------
// Resolution engine (pure function)
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 10

export function resolveConfiguration(input: ResolutionInput): ResolutionResult {
  const errors: string[] = []
  const warnings: string[] = []
  const appliedRules: string[] = []

  const attributeMap = new Map<string, ConfigAttribute>()
  for (const attr of input.attributes) {
    attributeMap.set(attr.key, attr)
  }

  // Step 1: Validate snapshot keys
  const snapshot = { ...input.configSnapshot }
  for (const key of Object.keys(snapshot)) {
    if (!attributeMap.has(key)) {
      warnings.push(`Unknown attribute key in snapshot: "${key}"`)
    }
  }
  for (const attr of input.attributes) {
    if (attr.isMandatory && attr.isActive && snapshot[attr.key] === undefined) {
      warnings.push(`Mandatory attribute "${attr.key}" (${attr.label}) is missing from snapshot`)
    }
  }

  // Step 2: Evaluate constraint rules with cascading
  const sortedRules = [...input.rules]
    .filter((r) => r.isActive)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return a.id.localeCompare(b.id)
    })

  const narrowedValues = new Map<string, Set<string>>()
  let iterationCount = 0
  let changed = true

  while (changed && iterationCount < MAX_ITERATIONS) {
    changed = false
    iterationCount++

    for (const rule of sortedRules) {
      const conditionJson = rule.conditionJson as Record<string, unknown>
      if (matchesCondition(conditionJson, snapshot)) {
        const ruleChanged = applyAction(rule, {
          snapshot,
          narrowedValues,
          errors,
          warnings,
          appliedRules,
          attributeMap,
        })
        if (ruleChanged) changed = true
      }
    }
  }

  if (iterationCount >= MAX_ITERATIONS && changed) {
    errors.push(
      `Constraint rules may have circular dependency — evaluation did not stabilize after ${MAX_ITERATIONS} passes`,
    )
  }

  // Step 3: Build resolved variant conditions
  const resolvedConditions: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(snapshot)) {
    resolvedConditions[key] = [value]
  }

  // Deduplicate applied rules
  const uniqueAppliedRules = [...new Set(appliedRules)]

  return {
    resolvedConditions,
    resolvedSnapshot: snapshot,
    errors,
    warnings,
    appliedRules: uniqueAppliedRules,
  }
}
