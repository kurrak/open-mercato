import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'menu:sidebar:main': {
    widgetId: 'product_master.injection.manufacturing-menu',
    priority: 50,
  },

  'crud-form:catalog.product': {
    widgetId: 'product_master.injection.catalog-manufacturing-link',
    kind: 'group',
    column: 2,
    groupLabel: 'manufacturing.catalog.groupLabel',
    groupDescription: 'manufacturing.catalog.groupDescription',
    priority: 40,
  },

  // Slots for sub-specs b/c/d to inject BOM, routing, configurator tabs
  'product-detail:manufacturing:bom': [],
  'product-detail:manufacturing:routing': [],
  'product-detail:manufacturing:configurator': [],
}

export default injectionTable
