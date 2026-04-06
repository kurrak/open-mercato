import {
  UnitOfMeasure,
  ProductManufacturingExtension,
  ProductionMethod,
  SupplierInfo,
  UomConversion,
} from '../data/entities'

describe('Entity class structure', () => {
  it('all 5 entity classes are constructable', () => {
    expect(new UnitOfMeasure()).toBeDefined()
    expect(new ProductManufacturingExtension()).toBeDefined()
    expect(new ProductionMethod()).toBeDefined()
    expect(new SupplierInfo()).toBeDefined()
    expect(new UomConversion()).toBeDefined()
  })

  it('UnitOfMeasure has correct defaults', () => {
    const uom = new UnitOfMeasure()
    expect(uom.isActive).toBe(true)
    expect(uom.deletedAt).toBeUndefined()
  })

  it('ProductionMethod has correct defaults', () => {
    const pm = new ProductionMethod()
    expect(pm.isDefault).toBe(false)
    expect(pm.version).toBe(1)
    expect(pm.lifecycleState).toBe('draft')
    expect(pm.bomHeaderId).toBeUndefined()
    expect(pm.routingTemplateId).toBeUndefined()
    expect(pm.deletedAt).toBeUndefined()
  })

  it('SupplierInfo has correct defaults', () => {
    const si = new SupplierInfo()
    expect(si.isPreferred).toBe(false)
    expect(si.price).toBeUndefined()
    expect(si.currency).toBeUndefined()
    expect(si.leadTimeDays).toBeUndefined()
    expect(si.deletedAt).toBeUndefined()
  })

  it('ProductManufacturingExtension has correct defaults', () => {
    const ext = new ProductManufacturingExtension()
    expect(ext.configurationType).toBe('none')
    expect(ext.procurementType).toBe('buy')
    expect(ext.isPhantomDefault).toBe(false)
    expect(ext.deletedAt).toBeUndefined()
  })

  it('UomConversion has no unexpected defaults', () => {
    const uc = new UomConversion()
    expect(uc.deletedAt).toBeUndefined()
  })
})
