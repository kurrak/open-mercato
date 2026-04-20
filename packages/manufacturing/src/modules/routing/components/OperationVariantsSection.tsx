'use client'

import * as React from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { VariantConditionBadges } from '../../bom/components/VariantConditionBadges'
import type { VariantConditionValue } from '../../bom/lib/variant-condition-ui'
import { useCatalogVariantsForProduct } from '../../bom/hooks/useCatalogVariantsForProduct'
import { useOperationVariants, type OperationVariantRow } from '../hooks/useOperationVariants'
import { useWorkCenterLookup } from '../hooks/useWorkCenterLookup'
import { OperationVariantDialog } from './OperationVariantDialog'

export type OperationVariantsSectionProps = {
  operationTemplateId: string
  masterProductId: string
}

/**
 * Inline list of OperationTemplateVariant rows for a single operation.
 * Mirrors spec c §5 OperationTemplateVariant inline section — list +
 * add / edit / delete. The activation XOR is enforced in the dialog
 * (variantId XOR variant_condition) with the server as backstop.
 *
 * Rendered inline as a colSpan detail row inside OperationsTable when
 * the user expands the variants chevron. Mirrors BOM's
 * BomLineVariantsSection UX — same pattern, same look.
 */
export function OperationVariantsSection({
  operationTemplateId,
  masterProductId,
}: OperationVariantsSectionProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: `routing-operation-variants:${operationTemplateId}`,
  })

  const { rows, isLoading, isError, invalidate } = useOperationVariants(operationTemplateId)

  // Variant id lookup — the master's CatalogProductVariants list is fixed per
  // product, so reusing useCatalogVariantsForProduct gives us names without
  // an extra by-id batch fetch. Unknown ids fall back to the short id.
  const { options: masterVariants } = useCatalogVariantsForProduct(masterProductId)
  const masterVariantNameById = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const v of masterVariants) map.set(v.id, v.name)
    return map
  }, [masterVariants])

  // Work center override name resolution — the overrides reference WCs by
  // id; batch-lookup keeps the cell lookup cheap even when inactive/soft-
  // deleted WCs are referenced.
  const wcOverrideIds = React.useMemo(
    () =>
      rows
        .map((r) => r.work_center_override_id)
        .filter((id): id is string => typeof id === 'string'),
    [rows],
  )
  const workCentersById = useWorkCenterLookup(wcOverrideIds)

  const [dialogState, setDialogState] = React.useState<
    | { mode: 'add' }
    | { mode: 'edit'; row: OperationVariantRow }
    | null
  >(null)

  const handleDelete = React.useCallback(
    async (row: OperationVariantRow) => {
      const ok = await confirm({
        title: t('routing.operationVariant.deleteConfirm.title', 'Delete override?'),
        text: t(
          'routing.operationVariant.deleteConfirm.text',
          'This variant override will be soft-deleted.',
        ),
        confirmText: t('routing.operationVariant.deleteConfirm.confirm', 'Delete'),
        variant: 'destructive',
      })
      if (!ok) return
      try {
        await runMutation({
          context: {
            entityId: 'routing:operation_template_variant',
            operation: 'delete',
            formId: `routing-operation-variants:${operationTemplateId}`,
            operationTemplateId,
            overrideId: row.id,
            retryLastMutation,
          },
          operation: async () => {
            await deleteCrud('routing/operation-variant', row.id)
            flash(t('routing.operationVariant.flash.deleted', 'Override deleted.'), 'success')
            invalidate()
          },
        })
      } catch (err) {
        console.warn('[routing] delete operation variant failed', err)
        flash(t('routing.operationVariant.flash.deleteError', 'Failed to delete override.'), 'error')
      }
    },
    [confirm, runMutation, retryLastMutation, operationTemplateId, invalidate, t],
  )

  const handleDialogSuccess = React.useCallback(() => {
    setDialogState(null)
    invalidate()
  }, [invalidate])

  const dialogNode = dialogState ? (
    <OperationVariantDialog
      open
      onOpenChange={(next) => { if (!next) setDialogState(null) }}
      masterProductId={masterProductId}
      operationTemplateId={operationTemplateId}
      editingVariant={dialogState.mode === 'edit' ? dialogState.row : null}
      onSuccess={handleDialogSuccess}
    />
  ) : null

  if (isLoading) {
    return <LoadingMessage label={t('routing.operationVariant.loading', 'Loading overrides…')} />
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">
        {t('routing.operationVariant.loadError', 'Failed to load overrides.')}
      </p>
    )
  }

  if (rows.length === 0) {
    return (
      <>
        <div className="rounded-md border border-dashed bg-muted/10 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {t('routing.operationVariant.none', 'No variant overrides on this operation.')}
            </span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => setDialogState({ mode: 'add' })}
            >
              {t('routing.operationVariant.addCta', '+ Add override')}
            </Button>
          </div>
          {ConfirmDialogElement}
        </div>
        {dialogNode}
      </>
    )
  }

  return (
    <>
      <div className="rounded-md border bg-muted/10">
        <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('routing.operationVariant.sectionLabel', 'Variant overrides')}
          </span>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0"
            onClick={() => setDialogState({ mode: 'add' })}
          >
            {t('routing.operationVariant.addCta', '+ Add override')}
          </Button>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="px-3 py-1.5 text-left font-medium">
                {t('routing.operationVariant.col.trigger', 'Trigger')}
              </th>
              <th className="px-3 py-1.5 text-left font-medium">
                {t('routing.operationVariant.col.timeOverrides', 'Time overrides (setup / run / teardown)')}
              </th>
              <th className="px-3 py-1.5 text-left font-medium">
                {t('routing.operationVariant.col.rateOverrides', 'Rate overrides (hourly / piece)')}
              </th>
              <th className="px-3 py-1.5 text-left font-medium">
                {t('routing.operationVariant.col.workCenterOverride', 'Work center override')}
              </th>
              <th className="px-3 py-1.5 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const wcOverride = row.work_center_override_id ? workCentersById.get(row.work_center_override_id) : null
              return (
                <tr key={row.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">
                    {row.variant_id ? (
                      <Badge variant="secondary">
                        {t('routing.operationVariant.trigger.variantId', 'Variant: {id}').replace(
                          '{id}',
                          masterVariantNameById.get(row.variant_id) ?? row.variant_id.slice(0, 8),
                        )}
                      </Badge>
                    ) : (
                      <VariantConditionBadges
                        value={(row.variant_condition ?? null) as VariantConditionValue}
                        productId={masterProductId}
                        compact
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm font-mono">
                    {formatTriple(row.setup_time_override, row.run_time_override, row.teardown_time_override)}
                  </td>
                  <td className="px-3 py-2 text-sm font-mono">
                    {formatRatePair(row.hourly_rate_override, row.piecework_rate_override)}
                  </td>
                  <td className="px-3 py-2 text-sm">
                    {wcOverride ? (
                      <span>
                        {wcOverride.name}
                        {wcOverride.code ? (
                          <span className="ml-1 font-mono text-xs text-muted-foreground">({wcOverride.code})</span>
                        ) : null}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDialogState({ mode: 'edit', row })}
                      aria-label={t('routing.operationVariant.action.edit', 'Edit override')}
                    >
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(row)}
                      aria-label={t('routing.operationVariant.action.delete', 'Delete override')}
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
      {dialogNode}
    </>
  )
}

// Render setup/run/teardown as a slash-separated triple with '—' for nulls.
// Per Q5 decision: null overrides display as '—' (inheritance silent).
function formatTriple(setup: string | null, run: string | null, teardown: string | null): string {
  const fmt = (v: string | null) => (v == null ? '—' : v)
  return `${fmt(setup)} / ${fmt(run)} / ${fmt(teardown)}`
}

function formatRatePair(hourly: string | null, piece: string | null): React.ReactNode {
  if (hourly == null && piece == null) return '—'
  return (
    <span>
      {hourly != null ? `${hourly}/h` : '—'}
      <span className="mx-1 text-muted-foreground">·</span>
      {piece != null ? `${piece}/pc` : '—'}
    </span>
  )
}
