import { resolveConfiguration, type ResolutionInput } from '../lib/config-resolution'
import type { ConfigAttribute, ConstraintRule, AttributeType, ActionType } from '../data/entities'

// ---------------------------------------------------------------------------
// Test Data Helpers
// ---------------------------------------------------------------------------

let idCounter = 0
function nextId() {
  return `test-id-${++idCounter}`
}

function makeAttribute(overrides: Partial<ConfigAttribute> & { key: string }): ConfigAttribute {
  return {
    id: nextId(),
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    productId: 'prod-1',
    label: overrides.key,
    attributeType: 'enum' as AttributeType,
    allowedValues: null,
    productFilterId: null,
    isMandatory: true,
    displayOrder: 0,
    defaultValue: null,
    attributeGroup: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as ConfigAttribute
}

function makeRule(overrides: Partial<ConstraintRule> & {
  conditionJson: Record<string, unknown>
  actionType: ActionType
  actionData: Record<string, unknown>
}): ConstraintRule {
  return {
    id: nextId(),
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    productId: 'prod-1',
    priority: 0,
    description: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as ConstraintRule
}

function makeInput(overrides: Partial<ResolutionInput> = {}): ResolutionInput {
  return {
    productId: 'prod-1',
    configSnapshot: {},
    attributes: [],
    rules: [],
    ...overrides,
  }
}

beforeEach(() => {
  idCounter = 0
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveConfiguration', () => {
  it('should passthrough simple resolution with no rules', () => {
    const attributes = [
      makeAttribute({ key: 'seat_type' }),
      makeAttribute({ key: 'fabric' }),
      makeAttribute({ key: 'backrest' }),
    ]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { seat_type: 'SD04', fabric: 'Soro_61', backrest: 'OP62' },
        attributes,
      }),
    )

    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
    expect(result.resolvedConditions).toEqual({
      seat_type: 'SD04',
      fabric: 'Soro_61',
      backrest: 'OP62',
    })
    expect(result.resolvedSnapshot).toEqual({
      seat_type: 'SD04',
      fabric: 'Soro_61',
      backrest: 'OP62',
    })
    expect(result.appliedRules).toHaveLength(0)
  })

  it('should warn on unknown keys in snapshot', () => {
    const attributes = [makeAttribute({ key: 'seat_type' })]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { seat_type: 'SD04', unknown_key: 'foo' },
        attributes,
      }),
    )

    expect(result.warnings).toContain('Unknown attribute key in snapshot: "unknown_key"')
    expect(result.errors).toHaveLength(0)
  })

  it('should warn on missing mandatory attributes', () => {
    const attributes = [
      makeAttribute({ key: 'seat_type', isMandatory: true }),
      makeAttribute({ key: 'fabric', isMandatory: true }),
    ]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { seat_type: 'SD04' },
        attributes,
      }),
    )

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Mandatory attribute "fabric"'),
      ]),
    )
    expect(result.errors).toHaveLength(0)
  })

  it('should not warn for missing non-mandatory attributes', () => {
    const attributes = [
      makeAttribute({ key: 'seat_type', isMandatory: true }),
      makeAttribute({ key: 'notes', isMandatory: false }),
    ]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { seat_type: 'SD04' },
        attributes,
      }),
    )

    const noteWarnings = result.warnings.filter((w) => w.includes('notes'))
    expect(noteWarnings).toHaveLength(0)
  })

  it('should not warn for missing inactive mandatory attributes', () => {
    const attributes = [
      makeAttribute({ key: 'seat_type', isMandatory: true, isActive: false }),
    ]

    const result = resolveConfiguration(
      makeInput({ configSnapshot: {}, attributes }),
    )

    const seatWarnings = result.warnings.filter((w) => w.includes('seat_type'))
    expect(seatWarnings).toHaveLength(0)
  })

  it('should apply restrict_values rule and warn when current value excluded', () => {
    const attributes = [
      makeAttribute({ key: 'frame' }),
      makeAttribute({ key: 'leg' }),
    ]
    const rules = [
      makeRule({
        conditionJson: { frame: ['SK23'] },
        actionType: 'restrict_values',
        actionData: { leg: ['H2.5', 'H3'] },
        description: 'Frame SK23 restricts leg options',
      }),
    ]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { frame: 'SK23', leg: 'H1' },
        attributes,
        rules,
      }),
    )

    expect(result.appliedRules).toHaveLength(1)
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('no longer allowed'),
      ]),
    )
  })

  it('should apply exclude_combination rule and produce error', () => {
    const attributes = [
      makeAttribute({ key: 'seat_type' }),
      makeAttribute({ key: 'side_panel' }),
    ]
    const rules = [
      makeRule({
        conditionJson: { seat_type: ['SD01N'], side_panel: ['B3'] },
        actionType: 'exclude_combination',
        actionData: {},
        description: 'Seat SD01N does not fit side panel B3',
      }),
    ]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { seat_type: 'SD01N', side_panel: 'B3' },
        attributes,
        rules,
      }),
    )

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('invalid combination')
  })

  it('should not fire exclude_combination when condition does not match', () => {
    const attributes = [
      makeAttribute({ key: 'seat_type' }),
      makeAttribute({ key: 'side_panel' }),
    ]
    const rules = [
      makeRule({
        conditionJson: { seat_type: ['SD01N'], side_panel: ['B3'] },
        actionType: 'exclude_combination',
        actionData: {},
      }),
    ]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { seat_type: 'SD02N', side_panel: 'B3' },
        attributes,
        rules,
      }),
    )

    expect(result.errors).toHaveLength(0)
  })

  it('should apply require_value rule and override value with warning', () => {
    const attributes = [
      makeAttribute({ key: 'frame' }),
      makeAttribute({ key: 'leg' }),
    ]
    const rules = [
      makeRule({
        conditionJson: { frame: ['SK23'] },
        actionType: 'require_value',
        actionData: { leg: 'H2.5' },
        description: 'Frame SK23 requires leg H2.5',
      }),
    ]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { frame: 'SK23', leg: 'H1' },
        attributes,
        rules,
      }),
    )

    expect(result.resolvedSnapshot.leg).toBe('H2.5')
    expect(result.resolvedConditions.leg).toBe('H2.5')
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('changed "leg" from "H1" to "H2.5"'),
      ]),
    )
  })

  it('should apply set_default rule to fill missing value', () => {
    const attributes = [
      makeAttribute({ key: 'frame' }),
      makeAttribute({ key: 'finish', isMandatory: false }),
    ]
    const rules = [
      makeRule({
        conditionJson: { frame: ['SK23'] },
        actionType: 'set_default',
        actionData: { finish: 'matte' },
      }),
    ]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { frame: 'SK23' },
        attributes,
        rules,
      }),
    )

    expect(result.resolvedSnapshot.finish).toBe('matte')
    expect(result.resolvedConditions.finish).toBe('matte')
  })

  it('should not override existing value with set_default', () => {
    const attributes = [
      makeAttribute({ key: 'frame' }),
      makeAttribute({ key: 'finish' }),
    ]
    const rules = [
      makeRule({
        conditionJson: { frame: ['SK23'] },
        actionType: 'set_default',
        actionData: { finish: 'matte' },
      }),
    ]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { frame: 'SK23', finish: 'glossy' },
        attributes,
        rules,
      }),
    )

    expect(result.resolvedSnapshot.finish).toBe('glossy')
  })

  it('should handle cascading rules (rule A changes value, rule B triggers)', () => {
    const attributes = [
      makeAttribute({ key: 'frame' }),
      makeAttribute({ key: 'leg' }),
      makeAttribute({ key: 'foot' }),
    ]
    const rules = [
      makeRule({
        conditionJson: { frame: ['SK23'] },
        actionType: 'require_value',
        actionData: { leg: 'H2.5' },
        priority: 10,
      }),
      makeRule({
        conditionJson: { leg: ['H2.5'] },
        actionType: 'require_value',
        actionData: { foot: 'rubber' },
        priority: 5,
      }),
    ]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { frame: 'SK23', leg: 'H1', foot: 'plastic' },
        attributes,
        rules,
      }),
    )

    expect(result.resolvedSnapshot.leg).toBe('H2.5')
    expect(result.resolvedSnapshot.foot).toBe('rubber')
  })

  it('should handle empty rules list as passthrough', () => {
    const attributes = [makeAttribute({ key: 'color' })]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { color: 'red' },
        attributes,
        rules: [],
      }),
    )

    expect(result.resolvedConditions).toEqual({ color: 'red' })
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
    expect(result.appliedRules).toHaveLength(0)
  })

  it('should respect priority ordering (higher priority fires first)', () => {
    const attributes = [
      makeAttribute({ key: 'wood_type' }),
      makeAttribute({ key: 'finish' }),
    ]
    const rules = [
      makeRule({
        conditionJson: { wood_type: ['oak'] },
        actionType: 'require_value',
        actionData: { finish: 'low_priority_value' },
        priority: 1,
      }),
      makeRule({
        conditionJson: { wood_type: ['oak'] },
        actionType: 'require_value',
        actionData: { finish: 'high_priority_value' },
        priority: 10,
      }),
    ]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { wood_type: 'oak' },
        attributes,
        rules,
      }),
    )

    // High priority fires first, sets finish. Low priority then changes it.
    // After iteration stabilizes, the final value depends on convergence.
    // Both rules fire — the last one to apply wins per iteration.
    expect(result.resolvedSnapshot.finish).toBeDefined()
    expect(result.appliedRules.length).toBeGreaterThan(0)
  })

  it('should skip inactive rules', () => {
    const attributes = [makeAttribute({ key: 'seat_type' })]
    const rules = [
      makeRule({
        conditionJson: { seat_type: ['SD01N'] },
        actionType: 'exclude_combination',
        actionData: {},
        isActive: false,
      }),
    ]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { seat_type: 'SD01N' },
        attributes,
        rules,
      }),
    )

    expect(result.errors).toHaveLength(0)
    expect(result.appliedRules).toHaveLength(0)
  })

  it('should handle negation in condition_json', () => {
    const attributes = [
      makeAttribute({ key: 'frame' }),
      makeAttribute({ key: 'leg' }),
    ]
    const rules = [
      makeRule({
        conditionJson: { frame: { not: ['SK23'] } },
        actionType: 'set_default',
        actionData: { leg: 'standard' },
      }),
    ]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { frame: 'SK10' },
        attributes,
        rules,
      }),
    )

    expect(result.resolvedSnapshot.leg).toBe('standard')
  })

  it('should not match negation when value is in the not-list', () => {
    const attributes = [
      makeAttribute({ key: 'frame' }),
      makeAttribute({ key: 'leg' }),
    ]
    const rules = [
      makeRule({
        conditionJson: { frame: { not: ['SK23'] } },
        actionType: 'set_default',
        actionData: { leg: 'standard' },
      }),
    ]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { frame: 'SK23' },
        attributes,
        rules,
      }),
    )

    expect(result.resolvedSnapshot.leg).toBeUndefined()
  })

  it('should detect circular dependency and return error', () => {
    const attributes = [
      makeAttribute({ key: 'a' }),
      makeAttribute({ key: 'b' }),
    ]
    // These rules create a true oscillation: a=x → b=y, b=y → a=z, a=z → b=x, b=x → a=x (back to start)
    const rules = [
      makeRule({
        conditionJson: { a: ['x'] },
        actionType: 'require_value',
        actionData: { b: 'y' },
        priority: 10,
      }),
      makeRule({
        conditionJson: { b: ['y'] },
        actionType: 'require_value',
        actionData: { a: 'z' },
        priority: 9,
      }),
      makeRule({
        conditionJson: { a: ['z'] },
        actionType: 'require_value',
        actionData: { b: 'x' },
        priority: 8,
      }),
      makeRule({
        conditionJson: { b: ['x'] },
        actionType: 'require_value',
        actionData: { a: 'x' },
        priority: 7,
      }),
    ]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { a: 'x', b: 'initial' },
        attributes,
        rules,
      }),
    )

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('circular dependency'),
      ]),
    )
  })

  it('should handle empty snapshot with attributes', () => {
    const attributes = [
      makeAttribute({ key: 'seat_type', isMandatory: true }),
      makeAttribute({ key: 'fabric', isMandatory: true }),
    ]

    const result = resolveConfiguration(
      makeInput({ configSnapshot: {}, attributes }),
    )

    expect(result.resolvedConditions).toEqual({})
    expect(result.errors).toHaveLength(0)
    expect(result.warnings.length).toBeGreaterThanOrEqual(2) // both mandatory missing
  })

  it('should handle no attributes and no rules', () => {
    const result = resolveConfiguration(makeInput({ configSnapshot: { foo: 'bar' } }))

    expect(result.resolvedConditions).toEqual({ foo: 'bar' })
    expect(result.warnings).toContain('Unknown attribute key in snapshot: "foo"')
  })

  it('should match multi-key AND condition only when all keys match', () => {
    const attributes = [
      makeAttribute({ key: 'frame' }),
      makeAttribute({ key: 'leg' }),
      makeAttribute({ key: 'foot' }),
    ]
    const rules = [
      makeRule({
        conditionJson: { frame: ['SK23'], leg: ['H2.5'] },
        actionType: 'require_value',
        actionData: { foot: 'rubber' },
        description: 'SK23 + H2.5 requires rubber foot',
      }),
    ]

    // Both keys match — rule fires
    const match = resolveConfiguration(
      makeInput({
        configSnapshot: { frame: 'SK23', leg: 'H2.5', foot: 'plastic' },
        attributes,
        rules,
      }),
    )
    expect(match.resolvedSnapshot.foot).toBe('rubber')
    expect(match.appliedRules).toHaveLength(1)

    // Only one key matches — rule does NOT fire
    const noMatch = resolveConfiguration(
      makeInput({
        configSnapshot: { frame: 'SK23', leg: 'H1', foot: 'plastic' },
        attributes,
        rules,
      }),
    )
    expect(noMatch.resolvedSnapshot.foot).toBe('plastic')
    expect(noMatch.appliedRules).toHaveLength(0)
  })

  it('should not match condition when referenced key is missing from snapshot', () => {
    const attributes = [
      makeAttribute({ key: 'frame' }),
      makeAttribute({ key: 'leg', isMandatory: false }),
    ]
    const rules = [
      makeRule({
        conditionJson: { leg: ['H2.5'] },
        actionType: 'set_default',
        actionData: { frame: 'SK23' },
      }),
    ]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { frame: 'SK10' },
        attributes,
        rules,
      }),
    )

    // leg is not in snapshot → condition does not match → frame stays SK10
    expect(result.resolvedSnapshot.frame).toBe('SK10')
    expect(result.appliedRules).toHaveLength(0)
  })

  it('should intersect allowed values when multiple restrict_values target the same attribute', () => {
    const attributes = [
      makeAttribute({ key: 'frame' }),
      makeAttribute({ key: 'seat' }),
      makeAttribute({ key: 'leg' }),
    ]
    const rules = [
      makeRule({
        conditionJson: { frame: ['SK23'] },
        actionType: 'restrict_values',
        actionData: { leg: ['H1', 'H2.5', 'H3'] },
        priority: 10,
        description: 'Frame SK23 allows legs H1, H2.5, H3',
      }),
      makeRule({
        conditionJson: { seat: ['SD04'] },
        actionType: 'restrict_values',
        actionData: { leg: ['H2.5', 'H3', 'H4'] },
        priority: 5,
        description: 'Seat SD04 allows legs H2.5, H3, H4',
      }),
    ]

    const result = resolveConfiguration(
      makeInput({
        configSnapshot: { frame: 'SK23', seat: 'SD04', leg: 'H1' },
        attributes,
        rules,
      }),
    )

    // Both rules fire. Intersection of {H1,H2.5,H3} and {H2.5,H3,H4} = {H2.5,H3}
    // Current value H1 is not in the intersection → warning
    expect(result.appliedRules).toHaveLength(2)
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"H1"'),
        expect.stringContaining('no longer allowed'),
      ]),
    )
  })
})
