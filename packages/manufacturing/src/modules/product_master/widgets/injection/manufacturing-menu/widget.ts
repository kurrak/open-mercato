import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'product_master.injection.manufacturing-menu',
  },
  menuItems: [
    {
      id: 'manufacturing-products',
      labelKey: 'manufacturing.nav.products',
      label: 'Products',
      icon: 'Factory',
      href: '/backend/manufacturing/products',
      features: ['product_master.view'],
      groupId: 'manufacturing',
      groupLabelKey: 'manufacturing.nav.group',
      groupLabel: 'Manufacturing',
      placement: { position: InjectionPosition.Before, relativeTo: 'settings' },
    },
    {
      id: 'manufacturing-work-centers',
      labelKey: 'manufacturing.nav.workCenters',
      label: 'Work Centers',
      icon: 'Wrench',
      href: '/backend/manufacturing/work-centers',
      features: ['routing.work_center.view'],
      groupId: 'manufacturing',
      groupLabelKey: 'manufacturing.nav.group',
      groupLabel: 'Manufacturing',
    },
    {
      id: 'manufacturing-factory-zones',
      labelKey: 'manufacturing.nav.factoryZones',
      label: 'Factory Zones',
      icon: 'Warehouse',
      href: '/backend/manufacturing/factory-zones',
      features: ['routing.factory_zone.view'],
      groupId: 'manufacturing',
      groupLabelKey: 'manufacturing.nav.group',
      groupLabel: 'Manufacturing',
    },
    {
      id: 'manufacturing-units-of-measure',
      labelKey: 'manufacturing.nav.unitsOfMeasure',
      label: 'Units of Measure',
      icon: 'Ruler',
      href: '/backend/manufacturing/units-of-measure',
      features: ['product_master.view'],
      groupId: 'manufacturing',
      groupLabelKey: 'manufacturing.nav.group',
      groupLabel: 'Manufacturing',
    },
  ],
}

export default widget
