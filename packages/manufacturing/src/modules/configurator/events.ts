import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'configurator.config_attribute.created', label: 'Config Attribute Created', entity: 'config_attribute', category: 'crud' },
  { id: 'configurator.config_attribute.updated', label: 'Config Attribute Updated', entity: 'config_attribute', category: 'crud' },
  { id: 'configurator.config_attribute.deleted', label: 'Config Attribute Deleted', entity: 'config_attribute', category: 'crud' },

  { id: 'configurator.constraint_rule.created', label: 'Constraint Rule Created', entity: 'constraint_rule', category: 'crud' },
  { id: 'configurator.constraint_rule.updated', label: 'Constraint Rule Updated', entity: 'constraint_rule', category: 'crud' },
  { id: 'configurator.constraint_rule.deleted', label: 'Constraint Rule Deleted', entity: 'constraint_rule', category: 'crud' },

  { id: 'configurator.configuration.resolved', label: 'Configuration Resolved', entity: 'config_attribute', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'configurator',
  events,
})

export const emitConfiguratorEvent = eventsConfig.emit

export type ConfiguratorEventId = (typeof events)[number]['id']

export default eventsConfig
