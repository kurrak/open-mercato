import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import CatalogManufacturingLinkWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'product_master.injection.catalog-manufacturing-link',
    title: 'Manufacturing Link',
    description: 'Shows manufacturing status and link on catalog product detail page',
    features: ['product_master.view'],
    priority: 40,
    enabled: true,
  },
  Widget: CatalogManufacturingLinkWidget,
}

export default widget
