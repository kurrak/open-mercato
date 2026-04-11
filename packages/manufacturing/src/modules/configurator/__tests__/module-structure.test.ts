import { features } from '../acl'
import eventsConfig from '../events'
import { setup } from '../setup'
import { translatableFields } from '../translations'

describe('ACL features', () => {
  it('exports 2 features', () => {
    expect(features).toHaveLength(2)
  })

  it('all feature IDs follow module.action format', () => {
    for (const feature of features) {
      expect(feature.id).toMatch(/^configurator\./)
      expect(feature.module).toBe('configurator')
      expect(feature.title.length).toBeGreaterThan(0)
    }
  })

  it('includes view and edit features', () => {
    const ids = features.map((f) => f.id)
    expect(ids).toContain('configurator.view')
    expect(ids).toContain('configurator.edit')
  })
})

describe('Events config', () => {
  it('has moduleId configurator', () => {
    expect(eventsConfig.moduleId).toBe('configurator')
  })

  it('declares 7 events (6 CRUD + 1 lifecycle)', () => {
    expect(eventsConfig.events).toHaveLength(7)
  })

  it('all event IDs follow module.entity.action format', () => {
    for (const event of eventsConfig.events) {
      expect(event.id).toMatch(/^configurator\.\w+\.\w+$/)
    }
  })

  it('covers config_attribute and constraint_rule entities plus lifecycle', () => {
    const entities = new Set(eventsConfig.events.map((e) => e.entity))
    expect(entities).toEqual(new Set(['config_attribute', 'constraint_rule']))
  })

  it('has lifecycle event for configuration resolved', () => {
    const lifecycleEvents = eventsConfig.events.filter((e) => e.category === 'lifecycle')
    expect(lifecycleEvents).toHaveLength(1)
    expect(lifecycleEvents[0].id).toBe('configurator.configuration.resolved')
  })
})

describe('Setup config', () => {
  it('declares defaultRoleFeatures for admin and employee', () => {
    expect(setup.defaultRoleFeatures).toBeDefined()
    expect(setup.defaultRoleFeatures!.admin).toContain('configurator.*')
    expect(setup.defaultRoleFeatures!.employee).toContain('configurator.view')
  })
})

describe('Translations', () => {
  it('declares translatable fields for config_attribute', () => {
    expect(translatableFields['configurator:config_attribute']).toContain('label')
    expect(translatableFields['configurator:config_attribute']).toContain('attributeGroup')
  })

  it('declares translatable fields for constraint_rule', () => {
    expect(translatableFields['configurator:constraint_rule']).toContain('description')
  })
})
