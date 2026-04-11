'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function BomTab({ productId: _productId }: { productId?: string }) {
  const t = useT()

  return (
    <div className="p-4">
      <h3 className="text-lg font-medium mb-2">
        {t('bom.tab.title', 'Bill of Materials')}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t(
          'bom.tab.placeholder',
          'BOM tree view will be implemented here. Manage material lists, sub-assemblies, and variant conditions for this product.',
        )}
      </p>
    </div>
  )
}
