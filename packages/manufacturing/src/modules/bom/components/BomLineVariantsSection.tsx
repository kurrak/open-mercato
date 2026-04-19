'use client'

import * as React from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { VariantConditionBadges } from './VariantConditionBadges'
import { useCatalogLookup } from '../hooks/useCatalogLookup'
import { useUomLookup } from '../hooks/useUomLookup'
import type { BomLineVariantRow } from '../hooks/useBomLineVariants'
import type { VariantConditionValue } from '../lib/variant-condition-ui'

export type BomLineVariantsSectionProps = {
  variants: readonly BomLineVariantRow[]
  // Top-level master product id — used as the scope for any
  // `variant_condition` pills on BomLineVariant rows (matches explosion-
  // time semantics per spec b §Variant Condition Matching).
  masterProductId: string
  onReload: () => void
}

/**
 * Inline detail content for a BomLine's Variants column expansion
 * (see spec b §BomLineVariant inline section). Read-only display +
 * delete; Add/Edit open a placeholder flash until the BomLineVariant
 * dialog lands (with XOR activation + drift-guarded Product+ProductVariant
 * override pair).
 */
export function BomLineVariantsSection({
  variants,
  masterProductId,
  onReload,
}: BomLineVariantsSectionProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'bom-line-variants',
  })

  const overrideProductIds = React.useMemo(
    () => variants.map((v) => v.product_override_id).filter((id): id is string => typeof id === 'string'),
    [variants],
  )
  // Variant ids here cover BOTH the trigger side (`variant_id` for
  // variant-based activation) and the override side (`product_variant_override_id`).
  // Combining into one lookup call lets the hook resolve both names from a
  // single pair of batched requests.
  const triggerAndOverrideVariantIds = React.useMemo(() => {
    const out: string[] = []
    for (const v of variants) {
      if (typeof v.variant_id === 'string') out.push(v.variant_id)
      if (typeof v.product_variant_override_id === 'string') out.push(v.product_variant_override_id)
    }
    return out
  }, [variants])
  const overrideUnitIds = React.useMemo(
    () => variants.map((v) => v.unit_override_id).filter((id): id is string => typeof id === 'string'),
    [variants],
  )
  const { productsById, variantsById } = useCatalogLookup(overrideProductIds, triggerAndOverrideVariantIds)
  const uomsById = useUomLookup(overrideUnitIds)

  const handleDelete = React.useCallback(
    async (row: BomLineVariantRow) => {
      const ok = await confirm({
        title: t('bom.variants.deleteConfirm.title', 'Delete override?'),
        text: t(
          'bom.variants.deleteConfirm.text',
          'This variant override will be soft-deleted.',
        ),
        confirmText: t('bom.variants.deleteConfirm.confirm', 'Delete'),
        variant: 'destructive',
      })
      if (!ok) return
      try {
        await runMutation({
          context: { entityId: 'bom:bom_line_variant', operation: 'delete', retryLastMutation },
          operation: async () => {
            await deleteCrud('bom/bom-line-variant', row.id)
            flash(t('bom.variants.deleteSuccess', 'Override deleted.'), 'success')
            // Invalidate the variants cache so the count badge and list
            // refresh immediately instead of staying stale for staleTime.
            queryClient.invalidateQueries({ queryKey: ['manufacturing', 'bom', 'line-variants'] })
            onReload()
          },
        })
      } catch (err) {
        console.warn('[bom] delete variant failed', err)
      }
    },
    [confirm, runMutation, retryLastMutation, queryClient, onReload, t],
  )

  const handleAddStub = React.useCallback(() => {
    flash(
      t('bom.variants.addComingSoon', 'Variant override dialog is not implemented yet — use seeded data for now.'),
      'info',
    )
  }, [t])

  const handleEditStub = React.useCallback(() => {
    flash(
      t('bom.variants.editComingSoon', 'Variant override edit dialog is not implemented yet — use seeded data for now.'),
      'info',
    )
  }, [t])

  if (variants.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/10 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {t('bom.variants.none', 'No overrides on this line.')}
          </span>
          <button
            type="button"
            className="text-sm text-primary hover:underline"
            onClick={handleAddStub}
          >
            {t('bom.variants.addCta', '+ Add override')}
          </button>
        </div>
        {ConfirmDialogElement}
      </div>
    )
  }

  return (
    <div className="rounded-md border bg-muted/10">
      <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('bom.variants.sectionLabel', 'Variant overrides')}
        </span>
        <button
          type="button"
          className="text-sm text-primary hover:underline"
          onClick={handleAddStub}
        >
          {t('bom.variants.addCta', '+ Add override')}
        </button>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="px-3 py-1.5 text-left font-medium">
              {t('bom.variants.col.trigger', 'Trigger')}
            </th>
            <th className="px-3 py-1.5 text-left font-medium">
              {t('bom.variants.col.quantityOverride', 'Qty override')}
            </th>
            <th className="px-3 py-1.5 text-left font-medium">
              {t('bom.variants.col.productOverride', 'Product override')}
            </th>
            <th className="px-3 py-1.5 text-left font-medium">
              {t('bom.variants.col.unitOverride', 'Unit override')}
            </th>
            <th className="px-3 py-1.5 text-right font-medium" />
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => {
            const productOverride = v.product_override_id ? productsById.get(v.product_override_id) : null
            const variantOverride = v.product_variant_override_id ? variantsById.get(v.product_variant_override_id) : null
            const unitOverride = v.unit_override_id ? uomsById.get(v.unit_override_id) : null
            return (
              <tr key={v.id} className="border-b last:border-b-0">
                <td className="px-3 py-2">
                  {v.variant_id ? (
                    <Badge variant="secondary">
                      {t('bom.variants.trigger.variantId', 'Variant: {id}').replace(
                        '{id}',
                        variantsById.get(v.variant_id)?.name ?? v.variant_id.slice(0, 8),
                      )}
                    </Badge>
                  ) : (
                    <VariantConditionBadges
                      value={(v.variant_condition ?? null) as VariantConditionValue}
                      productId={masterProductId}
                      compact
                    />
                  )}
                </td>
                <td className="px-3 py-2 text-sm">
                  {v.quantity_override != null ? String(v.quantity_override) : '—'}
                </td>
                <td className="px-3 py-2 text-sm">
                  {productOverride ? (
                    <>
                      {productOverride.title}
                      {variantOverride ? ` / ${variantOverride.name}` : ''}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2 text-sm">
                  {unitOverride ? unitOverride.code : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleEditStub}
                    aria-label={t('bom.variants.action.edit', 'Edit override')}
                  >
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(v)}
                    aria-label={t('bom.variants.action.delete', 'Delete override')}
                  >
                    <Trash2 className="size-4 text-red-600" />
                  </IconButton>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {ConfirmDialogElement}
    </div>
  )
}
