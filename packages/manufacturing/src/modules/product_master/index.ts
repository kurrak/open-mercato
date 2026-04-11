import './commands/production-methods'
import './commands/product-manufacturing-extension'
import './commands/unit-of-measure'
import './commands/supplier-info'
import './commands/uom-conversion'
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'product_master',
  title: 'Manufacturing Product Master',
  version: '0.1.0',
  description: 'Product manufacturing extensions, production methods, units of measure, and supplier information.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: true,
}

export { features } from './acl'
