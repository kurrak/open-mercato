import { features } from '../acl'
import eventsConfig from '../events'
import { setup } from '../setup'
import { translatableFields } from '../translations'
import { extensions } from '../data/extensions'

describe('ACL features', () => {
  it('exports at least 4 features', () => {
    expect(features.length).toBeGreaterThanOrEqual(4)
  })

  it('all feature IDs follow module.action format', () => {
    for (const feature of features) {
      expect(feature.id).toMatch(/^product_master\./)
      expect(feature.module).toBe('product_master')
      expect(feature.title.length).toBeGreaterThan(0)
    }
  })

  it('includes view and edit features', () => {
    const ids = features.map((f) => f.id)
    expect(ids).toContain('product_master.view')
    expect(ids).toContain('product_master.edit')
    expect(ids).toContain('product_master.supplier_info.view')
    expect(ids).toContain('product_master.supplier_info.edit')
  })
})

describe('Events config', () => {
  it('has moduleId product_master', () => {
    expect(eventsConfig.moduleId).toBe('product_master')
  })

  it('declares 12 CRUD events', () => {
    expect(eventsConfig.events.length).toBe(12)
  })

  it('all event IDs follow manufacturing.entity.action format', () => {
    for (const event of eventsConfig.events) {
      expect(event.id).toMatch(/^manufacturing\.\w+\.\w+$/)
      expect(event.category).toBe('crud')
    }
  })

  it('covers all 4 entities', () => {
    const entities = new Set(eventsConfig.events.map((e) => e.entity))
    expect(entities).toEqual(new Set(['production_method', 'supplier_info', 'unit_of_measure', 'uom_conversion']))
  })
})

describe('Setup config', () => {
  it('declares defaultRoleFeatures for admin and employee', () => {
    expect(setup.defaultRoleFeatures).toBeDefined()
    expect(setup.defaultRoleFeatures!.admin).toContain('product_master.*')
    expect(setup.defaultRoleFeatures!.employee).toContain('product_master.view')
  })

  it('has seedDefaults function', () => {
    expect(typeof setup.seedDefaults).toBe('function')
  })
})

describe('Translations', () => {
  it('declares translatable fields for production_method and unit_of_measure', () => {
    expect(translatableFields['product_master:production_method']).toContain('name')
    expect(translatableFields['product_master:unit_of_measure']).toContain('name')
  })
})

describe('Entity extensions', () => {
  it('declares one extension on catalog:product', () => {
    expect(extensions).toHaveLength(1)
    expect(extensions[0].base).toBe('catalog:product')
    expect(extensions[0].extension).toBe('product_master:product_manufacturing_extension')
    expect(extensions[0].cardinality).toBe('one-to-one')
    expect(extensions[0].join.baseKey).toBe('id')
    expect(extensions[0].join.extensionKey).toBe('product_id')
  })
})
