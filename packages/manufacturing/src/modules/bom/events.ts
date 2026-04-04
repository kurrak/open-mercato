import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'manufacturing.bom.created', label: 'BOM Created', entity: 'bom_header', category: 'crud' },
  { id: 'manufacturing.bom.updated', label: 'BOM Updated', entity: 'bom_header', category: 'crud' },
  { id: 'manufacturing.bom.deleted', label: 'BOM Deleted', entity: 'bom_header', category: 'crud' },

  { id: 'manufacturing.bom_line.created', label: 'BOM Line Created', entity: 'bom_line', category: 'crud' },
  { id: 'manufacturing.bom_line.updated', label: 'BOM Line Updated', entity: 'bom_line', category: 'crud' },
  { id: 'manufacturing.bom_line.deleted', label: 'BOM Line Deleted', entity: 'bom_line', category: 'crud' },

  { id: 'manufacturing.bom.exploded', label: 'BOM Exploded', entity: 'bom_header', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'bom',
  events,
})

export const emitBomEvent = eventsConfig.emit

export type BomEventId = (typeof events)[number]['id']

export default eventsConfig
