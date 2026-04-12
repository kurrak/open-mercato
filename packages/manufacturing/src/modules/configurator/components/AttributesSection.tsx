'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TabEmptyState } from '@open-mercato/ui/backend/detail'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function AttributesSection({ productId }: { productId: string }) {
  const t = useT()

  return (
    <TabEmptyState
      title={t('configurator.attributes.emptyTitle', 'No configuration attributes defined')}
      description={t(
        'configurator.attributes.emptyDescription',
        'Add attributes to define configuration axes for this product.',
      )}
    />
  )
}
