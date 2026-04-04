'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function ManufacturingDashboardPage() {
  const t = useT()

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">
        {t('product_master.dashboard.title', 'Manufacturing')}
      </h1>
      <p className="text-muted-foreground">
        {t(
          'product_master.dashboard.description',
          'Manufacturing product master data. Use the catalog product detail page to manage production methods, BOMs, routings, and configurator settings.',
        )}
      </p>
    </div>
  )
}
