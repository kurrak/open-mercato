'use client'

import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { Button } from '@open-mercato/ui/primitives/button'
import { ExternalLink } from 'lucide-react'
import AttributesSection from './AttributesSection'

type ConfiguratorTabProps = {
  productId: string
  configurationType?: string
}

export default function ConfiguratorTab({ productId, configurationType }: ConfiguratorTabProps) {
  const t = useT()

  if (configurationType === 'variant_based') {
    return (
      <div className="p-4">
        <Notice variant="info" title={t('configurator.tab.variantBasedTitle', 'Variant-based configuration')}>
          <p className="text-sm mt-1">
            {t(
              'configurator.tab.variantBasedMessage',
              'This product uses variant-based configuration. Manage variants in the Catalog.',
            )}
          </p>
          <div className="mt-3">
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href={`/backend/catalog/products/${productId}`}>
                <ExternalLink className="mr-2 size-4" />
                {t('configurator.tab.openCatalog', 'Open in Catalog')}
              </Link>
            </Button>
          </div>
        </Notice>
      </div>
    )
  }

  if (configurationType !== 'rule_based') {
    return null
  }

  return (
    <div className="space-y-4">
      <AttributesSection productId={productId} />
    </div>
  )
}
