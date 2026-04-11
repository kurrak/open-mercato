'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function RoutingTab({ productId: _productId }: { productId?: string }) {
  const t = useT()

  return (
    <div className="p-4">
      <h3 className="text-lg font-medium mb-2">
        {t('routing.tab.title', 'Production Routing')}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t(
          'routing.tab.placeholder',
          'Routing operations, work centers, and dependency graph will be displayed here.',
        )}
      </p>
    </div>
  )
}
