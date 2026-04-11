'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function ConfiguratorTab({ productId: _productId }: { productId?: string }) {
  const t = useT()

  return (
    <div className="p-4">
      <h3 className="text-lg font-medium mb-2">
        {t('configurator.tab.title', 'Configurator')}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t(
          'configurator.tab.placeholder',
          'Configuration attributes, constraint rules, and resolution preview will be implemented here.',
        )}
      </p>
    </div>
  )
}
