import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'manufacturing.routing.created', label: 'Routing Created', entity: 'routing_template', category: 'crud' },
  { id: 'manufacturing.routing.updated', label: 'Routing Updated', entity: 'routing_template', category: 'crud' },
  { id: 'manufacturing.routing.deleted', label: 'Routing Deleted', entity: 'routing_template', category: 'crud' },

  { id: 'manufacturing.operation.created', label: 'Operation Created', entity: 'operation_template', category: 'crud' },
  { id: 'manufacturing.operation.updated', label: 'Operation Updated', entity: 'operation_template', category: 'crud' },
  { id: 'manufacturing.operation.deleted', label: 'Operation Deleted', entity: 'operation_template', category: 'crud' },

  { id: 'manufacturing.work_center.created', label: 'Work Center Created', entity: 'work_center', category: 'crud' },
  { id: 'manufacturing.work_center.updated', label: 'Work Center Updated', entity: 'work_center', category: 'crud' },
  { id: 'manufacturing.work_center.deleted', label: 'Work Center Deleted', entity: 'work_center', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'routing',
  events,
})

export const emitRoutingEvent = eventsConfig.emit

export type RoutingEventId = (typeof events)[number]['id']

export default eventsConfig
