import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'menu:sidebar:main': {
    widgetId: 'product_master.injection.manufacturing-menu',
    priority: 50,
  },

  // Empty slots for sub-specs b/c/d to inject BOM, routing, configurator tabs
  'product-detail:manufacturing:bom': [],
  'product-detail:manufacturing:routing': [],
  'product-detail:manufacturing:configurator': [],
}

export default injectionTable
