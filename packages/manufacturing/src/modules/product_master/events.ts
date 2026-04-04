import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'manufacturing.production_method.created', label: 'Production Method Created', entity: 'production_method', category: 'crud' },
  { id: 'manufacturing.production_method.updated', label: 'Production Method Updated', entity: 'production_method', category: 'crud' },
  { id: 'manufacturing.production_method.deleted', label: 'Production Method Deleted', entity: 'production_method', category: 'crud' },

  { id: 'manufacturing.supplier_info.created', label: 'Supplier Info Created', entity: 'supplier_info', category: 'crud' },
  { id: 'manufacturing.supplier_info.updated', label: 'Supplier Info Updated', entity: 'supplier_info', category: 'crud' },
  { id: 'manufacturing.supplier_info.deleted', label: 'Supplier Info Deleted', entity: 'supplier_info', category: 'crud' },

  { id: 'manufacturing.unit_of_measure.created', label: 'Unit of Measure Created', entity: 'unit_of_measure', category: 'crud' },
  { id: 'manufacturing.unit_of_measure.updated', label: 'Unit of Measure Updated', entity: 'unit_of_measure', category: 'crud' },
  { id: 'manufacturing.unit_of_measure.deleted', label: 'Unit of Measure Deleted', entity: 'unit_of_measure', category: 'crud' },

  { id: 'manufacturing.uom_conversion.created', label: 'UoM Conversion Created', entity: 'uom_conversion', category: 'crud' },
  { id: 'manufacturing.uom_conversion.updated', label: 'UoM Conversion Updated', entity: 'uom_conversion', category: 'crud' },
  { id: 'manufacturing.uom_conversion.deleted', label: 'UoM Conversion Deleted', entity: 'uom_conversion', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'product_master',
  events,
})

export const emitProductMasterEvent = eventsConfig.emit

export type ProductMasterEventId = (typeof events)[number]['id']

export default eventsConfig
