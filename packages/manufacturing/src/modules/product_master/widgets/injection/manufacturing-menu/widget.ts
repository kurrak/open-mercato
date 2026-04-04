import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'product_master.injection.manufacturing-menu',
  },
  menuItems: [
    {
      id: 'manufacturing-dashboard',
      labelKey: 'product_master.menu.manufacturing',
      label: 'Manufacturing',
      icon: 'Factory',
      href: '/backend/product_master',
      features: ['product_master.view'],
      groupId: 'manufacturing',
      groupLabelKey: 'product_master.menu.group',
      placement: { position: InjectionPosition.Before, relativeTo: 'settings' },
    },
  ],
}

export default widget
