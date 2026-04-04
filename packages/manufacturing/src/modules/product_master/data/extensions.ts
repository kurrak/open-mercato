import type { EntityExtension } from '@open-mercato/shared/modules/entities'

export const extensions: EntityExtension[] = [
  {
    base: 'catalog:product',
    extension: 'product_master:product_manufacturing_extension',
    join: { baseKey: 'id', extensionKey: 'product_id' },
    cardinality: 'one-to-one',
    description: 'Manufacturing classification fields for catalog products',
  },
]

export default extensions
