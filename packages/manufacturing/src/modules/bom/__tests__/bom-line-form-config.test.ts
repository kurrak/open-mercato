import {
  BOM_LINE_DEFAULT_VALUES,
  bomLineToFormValues,
  buildCreatePayload,
  buildUpdatePayload,
} from '../components/BomLineFormConfig'
import type { BomLineRow } from '../components/BomTreeView'

function minimalLine(overrides: Partial<BomLineRow> = {}): BomLineRow {
  return {
    id: 'bl-1',
    bom_header_id: 'h-1',
    line_type: 'material',
    product_id: null,
    product_variant_id: null,
    product_resolve_key: null,
    child_bom_header_id: null,
    net_quantity: null,
    gross_quantity: null,
    scrap_percentage: '0',
    uom_id: null,
    variant_condition: null,
    operation_template_id: null,
    sort_order: 0,
    valid_from: null,
    valid_to: null,
    is_consumable: false,
    notes: null,
    ...overrides,
  }
}

describe('bomLineToFormValues', () => {
  it('maps nulls to empty strings for text/id fields', () => {
    const out = bomLineToFormValues(minimalLine())
    expect(out.productId).toBe('')
    expect(out.productVariantId).toBe('')
    expect(out.productResolveKey).toBe('')
    expect(out.childBomHeaderId).toBe('')
    expect(out.netQuantity).toBe('')
    expect(out.grossQuantity).toBe('')
    expect(out.uomId).toBe('')
    expect(out.operationTemplateId).toBe('')
    expect(out.validFrom).toBe('')
    expect(out.validTo).toBe('')
    expect(out.notes).toBe('')
  })

  it('maps scrap null/undefined to "0" string (form inputs expect strings)', () => {
    const out = bomLineToFormValues(minimalLine({ scrap_percentage: '0' }))
    expect(out.scrapPercentage).toBe('0')
  })

  it('truncates ISO timestamps to YYYY-MM-DD for date inputs', () => {
    const out = bomLineToFormValues(
      minimalLine({ valid_from: '2026-04-01T00:00:00.000Z', valid_to: '2026-04-30T00:00:00.000Z' }),
    )
    expect(out.validFrom).toBe('2026-04-01')
    expect(out.validTo).toBe('2026-04-30')
  })

  it('preserves variant_condition object and drops malformed shapes', () => {
    const good = bomLineToFormValues(minimalLine({ variant_condition: { fabric: ['SD01'] } }))
    expect(good.variantCondition).toEqual({ fabric: ['SD01'] })

    const bad = bomLineToFormValues(minimalLine({ variant_condition: 'not an object' }))
    expect(bad.variantCondition).toBeNull()

    const arr = bomLineToFormValues(minimalLine({ variant_condition: ['not', 'an', 'object'] }))
    expect(arr.variantCondition).toBeNull()
  })

  it('coerces line_type to the narrow union (falls back to "material")', () => {
    expect(bomLineToFormValues(minimalLine({ line_type: 'material' })).lineType).toBe('material')
    expect(bomLineToFormValues(minimalLine({ line_type: 'semi_product' })).lineType).toBe('semi_product')
    // Unknown value → material (defensive; server-side enum should prevent this)
    expect(bomLineToFormValues(minimalLine({ line_type: 'weird' as 'material' })).lineType).toBe('material')
  })
})

describe('buildCreatePayload', () => {
  it('trims empty strings to null for optional id fields', () => {
    const payload = buildCreatePayload(BOM_LINE_DEFAULT_VALUES, 'h-1')
    expect(payload.productId).toBeNull()
    expect(payload.productVariantId).toBeNull()
    expect(payload.productResolveKey).toBeNull()
    expect(payload.childBomHeaderId).toBeNull()
    expect(payload.uomId).toBeNull()
    expect(payload.operationTemplateId).toBeNull()
    expect(payload.validFrom).toBeNull()
    expect(payload.validTo).toBeNull()
    expect(payload.notes).toBeNull()
  })

  it('carries bomHeaderId through as-is', () => {
    const payload = buildCreatePayload(BOM_LINE_DEFAULT_VALUES, 'h-42')
    expect(payload.bomHeaderId).toBe('h-42')
  })

  it('Static XOR: resolveKey empty + productId set → static mode payload', () => {
    const payload = buildCreatePayload(
      { ...BOM_LINE_DEFAULT_VALUES, productId: 'p-1', productVariantId: 'pv-1' },
      'h-1',
    )
    expect(payload.productId).toBe('p-1')
    expect(payload.productVariantId).toBe('pv-1')
    expect(payload.productResolveKey).toBeNull()
  })

  it('Dynamic XOR: resolveKey set → productId/productVariantId forced null', () => {
    const payload = buildCreatePayload(
      {
        ...BOM_LINE_DEFAULT_VALUES,
        productId: 'p-1',
        productVariantId: 'pv-1',
        productResolveKey: 'fabric',
      },
      'h-1',
    )
    expect(payload.productId).toBeNull()
    expect(payload.productVariantId).toBeNull()
    expect(payload.productResolveKey).toBe('fabric')
  })

  it('semi_product line keeps childBomHeaderId; material line forces it to null', () => {
    const semi = buildCreatePayload(
      { ...BOM_LINE_DEFAULT_VALUES, lineType: 'semi_product', childBomHeaderId: 'h-child' },
      'h-1',
    )
    expect(semi.childBomHeaderId).toBe('h-child')

    const mat = buildCreatePayload(
      { ...BOM_LINE_DEFAULT_VALUES, lineType: 'material', childBomHeaderId: 'h-child' },
      'h-1',
    )
    expect(mat.childBomHeaderId).toBeNull()
  })

  it('passes through string quantities without parsing (server validates)', () => {
    const payload = buildCreatePayload(
      { ...BOM_LINE_DEFAULT_VALUES, netQuantity: '1.5', grossQuantity: '2', scrapPercentage: '25' },
      'h-1',
    )
    expect(payload.netQuantity).toBe('1.5')
    expect(payload.grossQuantity).toBe('2')
    expect(payload.scrapPercentage).toBe('25')
  })

  it('empty scrapPercentage falls back to "0" (not null — scrap is NOT NULL on entity)', () => {
    const payload = buildCreatePayload({ ...BOM_LINE_DEFAULT_VALUES, scrapPercentage: '' }, 'h-1')
    expect(payload.scrapPercentage).toBe('0')
  })

  it('passes variantCondition through unchanged (including null)', () => {
    const nullPayload = buildCreatePayload(BOM_LINE_DEFAULT_VALUES, 'h-1')
    expect(nullPayload.variantCondition).toBeNull()

    const setPayload = buildCreatePayload(
      { ...BOM_LINE_DEFAULT_VALUES, variantCondition: { fabric: ['SD01'] } },
      'h-1',
    )
    expect(setPayload.variantCondition).toEqual({ fabric: ['SD01'] })
  })

  it('trims whitespace-only strings to null', () => {
    const payload = buildCreatePayload(
      { ...BOM_LINE_DEFAULT_VALUES, productId: '   ', uomId: '  ', notes: '   ' },
      'h-1',
    )
    expect(payload.productId).toBeNull()
    expect(payload.uomId).toBeNull()
    expect(payload.notes).toBeNull()
  })
})

describe('buildUpdatePayload', () => {
  it('includes id, excludes bomHeaderId (immutable on update)', () => {
    const payload = buildUpdatePayload(
      { ...BOM_LINE_DEFAULT_VALUES, productId: 'p-1' },
      'bl-1',
    )
    expect(payload.id).toBe('bl-1')
    expect('bomHeaderId' in payload).toBe(false)
    expect(payload.productId).toBe('p-1')
  })

  it('retains all other field transforms from buildCreatePayload', () => {
    const payload = buildUpdatePayload(
      {
        ...BOM_LINE_DEFAULT_VALUES,
        lineType: 'semi_product',
        productId: 'p-1',
        childBomHeaderId: 'h-child',
        variantCondition: { a: ['b'] },
      },
      'bl-1',
    )
    expect(payload.childBomHeaderId).toBe('h-child')
    expect(payload.variantCondition).toEqual({ a: ['b'] })
  })
})

describe('round-trip: record → form values → payload', () => {
  it('preserves the essential fields for a static material line', () => {
    const original = minimalLine({
      line_type: 'material',
      product_id: 'p-1',
      product_variant_id: 'pv-1',
      net_quantity: '4',
      gross_quantity: '5',
      scrap_percentage: '2.5',
      uom_id: 'u-1',
      is_consumable: true,
    })
    const formValues = bomLineToFormValues(original)
    const payload = buildUpdatePayload(formValues, original.id)
    expect(payload).toMatchObject({
      id: 'bl-1',
      lineType: 'material',
      productId: 'p-1',
      productVariantId: 'pv-1',
      productResolveKey: null,
      netQuantity: '4',
      grossQuantity: '5',
      scrapPercentage: '2.5',
      uomId: 'u-1',
      isConsumable: true,
    })
  })

  // Regression guard — without reading `notes` from BomLineRow into the
  // form, editing any line would clobber its notes with null on save.
  it('preserves `notes` when editing a line that already has notes set', () => {
    const original = minimalLine({
      product_id: 'p-1',
      notes: 'Handling: fragile. Store at 4°C.',
    })
    const formValues = bomLineToFormValues(original)
    expect(formValues.notes).toBe('Handling: fragile. Store at 4°C.')
    const payload = buildUpdatePayload(formValues, original.id)
    expect(payload.notes).toBe('Handling: fragile. Store at 4°C.')
  })

  it('collapses null / missing notes on load to empty-string, back to null on save', () => {
    const nullNotes = bomLineToFormValues(minimalLine({ notes: null }))
    expect(nullNotes.notes).toBe('')
    expect(buildUpdatePayload(nullNotes, 'bl-1').notes).toBeNull()
  })

  it('preserves the essential fields for a semi_product line with child BOM', () => {
    const original = minimalLine({
      line_type: 'semi_product',
      product_id: 'p-1',
      child_bom_header_id: 'h-child',
    })
    const payload = buildUpdatePayload(bomLineToFormValues(original), original.id)
    expect(payload).toMatchObject({
      lineType: 'semi_product',
      productId: 'p-1',
      childBomHeaderId: 'h-child',
    })
  })
})
