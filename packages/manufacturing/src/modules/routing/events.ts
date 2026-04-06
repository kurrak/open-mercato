import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'routing.routing_template.created', label: 'Routing Created', entity: 'routing_template', category: 'crud' },
  { id: 'routing.routing_template.updated', label: 'Routing Updated', entity: 'routing_template', category: 'crud' },
  { id: 'routing.routing_template.deleted', label: 'Routing Deleted', entity: 'routing_template', category: 'crud' },

  { id: 'routing.operation_template.created', label: 'Operation Created', entity: 'operation_template', category: 'crud' },
  { id: 'routing.operation_template.updated', label: 'Operation Updated', entity: 'operation_template', category: 'crud' },
  { id: 'routing.operation_template.deleted', label: 'Operation Deleted', entity: 'operation_template', category: 'crud' },

  { id: 'routing.work_center.created', label: 'Work Center Created', entity: 'work_center', category: 'crud' },
  { id: 'routing.work_center.updated', label: 'Work Center Updated', entity: 'work_center', category: 'crud' },
  { id: 'routing.work_center.deleted', label: 'Work Center Deleted', entity: 'work_center', category: 'crud' },

  { id: 'routing.factory_zone.created', label: 'Factory Zone Created', entity: 'factory_zone', category: 'crud' },
  { id: 'routing.factory_zone.updated', label: 'Factory Zone Updated', entity: 'factory_zone', category: 'crud' },
  { id: 'routing.factory_zone.deleted', label: 'Factory Zone Deleted', entity: 'factory_zone', category: 'crud' },

  { id: 'routing.operation_template_variant.created', label: 'Operation Variant Created', entity: 'operation_template_variant', category: 'crud' },
  { id: 'routing.operation_template_variant.updated', label: 'Operation Variant Updated', entity: 'operation_template_variant', category: 'crud' },
  { id: 'routing.operation_template_variant.deleted', label: 'Operation Variant Deleted', entity: 'operation_template_variant', category: 'crud' },

  { id: 'routing.operation_dependency.created', label: 'Dependency Created', entity: 'operation_dependency', category: 'crud' },
  { id: 'routing.operation_dependency.updated', label: 'Dependency Updated', entity: 'operation_dependency', category: 'crud' },
  { id: 'routing.operation_dependency.deleted', label: 'Dependency Deleted', entity: 'operation_dependency', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'routing',
  events,
})

export const emitRoutingEvent = eventsConfig.emit

export type RoutingEventId = (typeof events)[number]['id']

export default eventsConfig
