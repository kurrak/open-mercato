'use client'

import * as React from 'react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfigAttributeKeys } from '../../configurator/components/useConfigAttributeKeys'
import { useCatalogLookup } from '../hooks/useCatalogLookup'
import {
  parseDisplayEntries,
  collectCatalogIds,
  type VariantConditionValue,
} from '../lib/variant-condition-ui'

export type { VariantConditionValue } from '../lib/variant-condition-ui'

export type VariantConditionBadgesProps = {
  value: VariantConditionValue
  // Product whose ConfigAttributes define the authoring scope (see spec b
  // §BomLine Constraints). For semi-products this is typically empty — keys
  // render as "Unknown" with a tooltip explaining runtime semantics.
  productId: string
  compact?: boolean
}

export function VariantConditionBadges({ value, productId, compact }: VariantConditionBadgesProps) {
  const t = useT()
  const entries = React.useMemo(() => parseDisplayEntries(value), [value])
  const { attributesByKey, ready: scopeReady } = useConfigAttributeKeys(productId)
  const { productIds, variantIds } = React.useMemo(
    () => collectCatalogIds(entries, attributesByKey),
    [entries, attributesByKey],
  )
  const { productsById, variantsById } = useCatalogLookup(productIds, variantIds)

  if (entries.length === 0) return null

  return (
    <div className={compact ? 'inline-flex flex-wrap gap-1' : 'flex flex-wrap gap-1.5'}>
      {entries.map((entry, index) => {
        // `${entry.key}:${index}` guards against a future regression where
        // parseDisplayEntries might emit duplicate keys (e.g. if the input
        // shape ever shifts from Record to Array of entries).
        const rowKey = `${entry.key}:${index}`
        const meta = attributesByKey.get(entry.key)
        const unknown = scopeReady && !meta
        const attributeType = meta?.attributeType ?? null
        const displayValues = entry.values.map((raw) => {
          if (attributeType === 'product') return productsById.get(raw)?.title ?? raw
          if (attributeType === 'product_variant') return variantsById.get(raw)?.name ?? raw
          return raw
        })
        const operatorLabel = entry.operator === 'not_in'
          ? t('bom.variantCondition.operator.notIn', 'NOT')
          : ''
        const valuesText = displayValues.length === 0 ? '—' : displayValues.join(', ')
        const body = operatorLabel
          ? `${entry.key}: ${operatorLabel} ${valuesText}`
          : `${entry.key}: ${valuesText}`

        if (unknown) {
          return (
            <SimpleTooltip
              key={rowKey}
              content={t(
                'bom.variantCondition.unknownKey.tooltip',
                'Unknown key — matched against the consuming master\'s configuration at runtime.',
              )}
            >
              <Badge variant="muted" className="cursor-help">
                {body}
              </Badge>
            </SimpleTooltip>
          )
        }

        return (
          <Badge key={rowKey} variant="secondary">
            {body}
          </Badge>
        )
      })}
    </div>
  )
}
