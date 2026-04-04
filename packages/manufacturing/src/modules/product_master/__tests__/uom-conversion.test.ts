import {
  convertQuantity,
  isValidConversionFactor,
  reverseConversionFactor,
  type ConversionEntry,
} from '../lib/uom-conversion'

const uomMeter = 'uom-meter'
const uomCm = 'uom-cm'
const uomKg = 'uom-kg'
const uomG = 'uom-gram'
const uomPiece = 'uom-piece'

const conversions: ConversionEntry[] = [
  { fromUomId: uomMeter, toUomId: uomCm, factor: '100' },
  { fromUomId: uomKg, toUomId: uomG, factor: '1000' },
]

describe('convertQuantity', () => {
  it('returns same quantity when from === to', () => {
    expect(convertQuantity('5.5', uomMeter, uomMeter, conversions)).toBe('5.5')
  })

  it('converts using direct factor', () => {
    expect(convertQuantity('2.5', uomMeter, uomCm, conversions)).toBe('250')
  })

  it('converts using reverse factor', () => {
    expect(convertQuantity('500', uomCm, uomMeter, conversions)).toBe('5')
  })

  it('converts kg to grams', () => {
    expect(convertQuantity('1.5', uomKg, uomG, conversions)).toBe('1500')
  })

  it('converts grams to kg (reverse)', () => {
    expect(convertQuantity('250', uomG, uomKg, conversions)).toBe('0.25')
  })

  it('returns null when no conversion path exists', () => {
    expect(convertQuantity('10', uomMeter, uomKg, conversions)).toBeNull()
  })

  it('returns null for invalid quantity', () => {
    expect(convertQuantity('abc', uomMeter, uomCm, conversions)).toBeNull()
  })

  it('returns null for zero factor', () => {
    const zeroFactor: ConversionEntry[] = [
      { fromUomId: 'a', toUomId: 'b', factor: '0' },
    ]
    expect(convertQuantity('10', 'a', 'b', zeroFactor)).toBeNull()
  })

  it('handles high precision factors', () => {
    const precise: ConversionEntry[] = [
      { fromUomId: 'inch', toUomId: 'cm', factor: '2.54' },
    ]
    const result = convertQuantity('10', 'inch', 'cm', precise)
    expect(result).not.toBeNull()
    expect(parseFloat(result!)).toBeCloseTo(25.4, 10)
  })

  it('handles empty conversions array', () => {
    expect(convertQuantity('10', uomMeter, uomCm, [])).toBeNull()
  })

  it('converts quantity of 0', () => {
    expect(convertQuantity('0', uomMeter, uomCm, conversions)).toBe('0')
  })
})

describe('isValidConversionFactor', () => {
  it('accepts positive numbers', () => {
    expect(isValidConversionFactor('100')).toBe(true)
    expect(isValidConversionFactor('0.001')).toBe(true)
    expect(isValidConversionFactor('999999.999999')).toBe(true)
  })

  it('rejects zero', () => {
    expect(isValidConversionFactor('0')).toBe(false)
  })

  it('rejects negative numbers', () => {
    expect(isValidConversionFactor('-1')).toBe(false)
    expect(isValidConversionFactor('-0.5')).toBe(false)
  })

  it('rejects non-numeric strings', () => {
    expect(isValidConversionFactor('abc')).toBe(false)
    expect(isValidConversionFactor('')).toBe(false)
  })

  it('rejects Infinity', () => {
    expect(isValidConversionFactor('Infinity')).toBe(false)
  })
})

describe('reverseConversionFactor', () => {
  it('computes reverse of 100 → 0.01', () => {
    const result = reverseConversionFactor('100')
    expect(result).not.toBeNull()
    expect(parseFloat(result!)).toBeCloseTo(0.01, 10)
  })

  it('computes reverse of 2.54 → ~0.3937', () => {
    const result = reverseConversionFactor('2.54')
    expect(result).not.toBeNull()
    expect(parseFloat(result!)).toBeCloseTo(1 / 2.54, 10)
  })

  it('computes reverse of 1 → 1', () => {
    expect(reverseConversionFactor('1')).toBe('1')
  })

  it('returns null for zero', () => {
    expect(reverseConversionFactor('0')).toBeNull()
  })

  it('returns null for non-numeric', () => {
    expect(reverseConversionFactor('abc')).toBeNull()
  })
})
