import {
  BOM_LINE_VARIANT_DEFAULT_VALUES,
  bomLineVariantToFormValues,
  buildCreatePayload,
  buildUpdatePayload,
  clearOnActivationChange,
  clearOnProductOverrideChange,
} from '../components/BomLineVariantFormConfig'
import type { BomLineVariantRow } from '../hooks/useBomLineVariants'

function minimalRow(overrides: Partial<BomLineVariantRow> = {}): BomLineVariantRow {
  return {
    id: 'blv-1',
    bom_line_id: 'bl-1',
    variant_id: null,
    variant_condition: null,
    quantity_override: null,
    product_override_id: null,
    product_variant_override_id: null,
    unit_override_id: null,
    sort_order: 0,
    notes: null,
    ...overrides,
  }
}

describe('bomLineVariantToFormValues', () => {
  it('derives activation="variant" from a saved row with variant_id set', () => {
    const out = bomLineVariantToFormValues(minimalRow({ variant_id: 'pv-1' }))
    expect(out.activation).toBe('variant')
    expect(out.variantId).toBe('pv-1')
    expect(out.variantCondition).toBeNull()
  })

  it('derives activation="condition" from a saved row with variant_condition set', () => {
    const out = bomLineVariantToFormValues(
      minimalRow({ variant_condition: { grade: ['premium'] } }),
    )
    expect(out.activation).toBe('condition')
    expect(out.variantId).toBe('')
    expect(out.variantCondition).toEqual({ grade: ['premium'] })
  })

  it('drops malformed variant_condition shapes (defensive)', () => {
    const out = bomLineVariantToFormValues(
      minimalRow({ variant_condition: 'not an object' }),
    )
    expect(out.variantCondition).toBeNull()
  })

  it('maps nulls to empty strings for text/id fields', () => {
    const out = bomLineVariantToFormValues(minimalRow())
    expect(out.productOverrideId).toBe('')
    expect(out.productVariantOverrideId).toBe('')
    expect(out.unitOverrideId).toBe('')
    expect(out.quantityOverride).toBe('')
  })
})

describe('buildCreatePayload', () => {
  it('passes bomLineId through; activation="variant" sends variantId + null variant_condition', () => {
    const payload = buildCreatePayload(
      { ...BOM_LINE_VARIANT_DEFAULT_VALUES, activation: 'variant', variantId: 'pv-1' },
      'bl-42',
    )
    expect(payload.bomLineId).toBe('bl-42')
    expect(payload.variantId).toBe('pv-1')
    expect(payload.variantCondition).toBeNull()
  })

  it('activation="condition" sends variant_condition + null variantId', () => {
    const payload = buildCreatePayload(
      {
        ...BOM_LINE_VARIANT_DEFAULT_VALUES,
        activation: 'condition',
        variantCondition: { grade: ['premium'] },
      },
      'bl-1',
    )
    expect(payload.variantId).toBeNull()
    expect(payload.variantCondition).toEqual({ grade: ['premium'] })
  })

  it('empty variant_condition in condition mode serializes as null (spec: activation XOR requires one set)', () => {
    const payload = buildCreatePayload(
      { ...BOM_LINE_VARIANT_DEFAULT_VALUES, activation: 'condition', variantCondition: {} },
      'bl-1',
    )
    expect(payload.variantId).toBeNull()
    expect(payload.variantCondition).toBeNull()
  })

  it('clears productVariantOverrideId when productOverrideId is empty (drift-guard defense)', () => {
    const payload = buildCreatePayload(
      {
        ...BOM_LINE_VARIANT_DEFAULT_VALUES,
        productOverrideId: '',
        productVariantOverrideId: 'pv-stale',
      },
      'bl-1',
    )
    expect(payload.productOverrideId).toBeNull()
    expect(payload.productVariantOverrideId).toBeNull()
  })

  it('keeps productVariantOverrideId when productOverrideId is set (drift-guard trusts the ids)', () => {
    const payload = buildCreatePayload(
      {
        ...BOM_LINE_VARIANT_DEFAULT_VALUES,
        productOverrideId: 'p-1',
        productVariantOverrideId: 'pv-1',
      },
      'bl-1',
    )
    expect(payload.productOverrideId).toBe('p-1')
    expect(payload.productVariantOverrideId).toBe('pv-1')
  })

  it('emits null for omitted override fields (inherit-from-base semantics)', () => {
    const payload = buildCreatePayload(BOM_LINE_VARIANT_DEFAULT_VALUES, 'bl-1')
    expect(payload.quantityOverride).toBeNull()
    expect(payload.productOverrideId).toBeNull()
    expect(payload.productVariantOverrideId).toBeNull()
    expect(payload.unitOverrideId).toBeNull()
    expect(payload.notes).toBeNull()
  })
})

describe('buildUpdatePayload', () => {
  it('includes id, excludes bomLineId (immutable on update)', () => {
    const payload = buildUpdatePayload(
      { ...BOM_LINE_VARIANT_DEFAULT_VALUES, activation: 'variant', variantId: 'pv-1' },
      'blv-1',
    )
    expect(payload.id).toBe('blv-1')
    expect('bomLineId' in payload).toBe(false)
    expect(payload.variantId).toBe('pv-1')
  })
})

describe('clearOnActivationChange', () => {
  it('switching to variant clears the condition state', () => {
    expect(clearOnActivationChange('variant')).toEqual(['variantCondition'])
  })

  it('switching to condition clears the variant id state', () => {
    expect(clearOnActivationChange('condition')).toEqual(['variantId'])
  })
})

describe('clearOnProductOverrideChange', () => {
  it('clears the paired variant override to avoid drift against the new product', () => {
    expect(clearOnProductOverrideChange()).toEqual(['productVariantOverrideId'])
  })
})

describe('notes round-trip (regression guard)', () => {
  // Without reading `notes` from the BomLineVariant row into the form,
  // editing any override with existing notes would clobber them with null
  // on save — same bug class as BomLine's notes regression.
  it('preserves notes when editing an override that already has notes set', () => {
    const original = minimalRow({
      variant_id: 'pv-1',
      notes: 'Handling: fragile fabric; store below 10°C.',
    })
    const formValues = bomLineVariantToFormValues(original)
    expect(formValues.notes).toBe('Handling: fragile fabric; store below 10°C.')
    const payload = buildUpdatePayload(formValues, original.id)
    expect(payload.notes).toBe('Handling: fragile fabric; store below 10°C.')
  })

  it('collapses null / missing notes on load to empty string, back to null on save', () => {
    const nullNotes = bomLineVariantToFormValues(minimalRow({ notes: null }))
    expect(nullNotes.notes).toBe('')
    expect(buildUpdatePayload(nullNotes, 'blv-1').notes).toBeNull()
  })
})

describe('round-trip: row → form values → payload', () => {
  it('preserves a variant-activated override with full override pair', () => {
    const original = minimalRow({
      variant_id: 'pv-trigger',
      product_override_id: 'p-override',
      product_variant_override_id: 'pv-override',
      unit_override_id: 'u-1',
      quantity_override: '4',
    })
    const payload = buildUpdatePayload(bomLineVariantToFormValues(original), original.id)
    expect(payload).toMatchObject({
      id: 'blv-1',
      variantId: 'pv-trigger',
      variantCondition: null,
      productOverrideId: 'p-override',
      productVariantOverrideId: 'pv-override',
      unitOverrideId: 'u-1',
      quantityOverride: '4',
    })
  })

  it('preserves a condition-activated override', () => {
    const original = minimalRow({
      variant_condition: { grade: ['premium'], fabric: { not: ['eco'] } },
      product_override_id: 'p-override',
    })
    const payload = buildUpdatePayload(bomLineVariantToFormValues(original), original.id)
    expect(payload).toMatchObject({
      variantId: null,
      variantCondition: { grade: ['premium'], fabric: { not: ['eco'] } },
      productOverrideId: 'p-override',
    })
  })
})
