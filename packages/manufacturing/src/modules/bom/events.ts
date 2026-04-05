import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'bom.bom_header.created', label: 'BOM Created', entity: 'bom_header', category: 'crud' },
  { id: 'bom.bom_header.updated', label: 'BOM Updated', entity: 'bom_header', category: 'crud' },
  { id: 'bom.bom_header.deleted', label: 'BOM Deleted', entity: 'bom_header', category: 'crud' },

  { id: 'bom.bom_line.created', label: 'BOM Line Created', entity: 'bom_line', category: 'crud' },
  { id: 'bom.bom_line.updated', label: 'BOM Line Updated', entity: 'bom_line', category: 'crud' },
  { id: 'bom.bom_line.deleted', label: 'BOM Line Deleted', entity: 'bom_line', category: 'crud' },

  { id: 'bom.explosion.completed', label: 'BOM Explosion Completed', entity: 'bom_header', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'bom',
  events,
})

export const emitBomEvent = eventsConfig.emit

export type BomEventId = (typeof events)[number]['id']

export default eventsConfig
