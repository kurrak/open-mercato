'use client'

import * as React from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { BooleanIcon, EnumBadge, type EnumBadgeMap } from '@open-mercato/ui/backend/ValueIcons'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { NameWithCode } from '../../../lib/components'
import { useOperationsForRouting, type OperationRow } from '../hooks/useOperationsForRouting'
import { useOperationVariantCounts } from '../hooks/useOperationVariants'
import { useWorkCenterLookup } from '../hooks/useWorkCenterLookup'
import { OperationVariantsSection } from './OperationVariantsSection'

export type OperationsTableProps = {
  routingTemplateId: string
  // Master CatalogProduct id — scopes the variant-overrides activation
  // picker and VariantConditionEditor. Threaded from RoutingTab.
  masterProductId: string
  onAddOperation: () => void
  onEditOperation: (row: OperationRow) => void
}

// Column count must stay in sync with the header + body rows — used by
// the inline variants detail row's colSpan.
//   expand(placeholder) | seq | name | wc | setup | run | teardown | wait
//   | move | payment | rate | subcontracted | variants | actions
const COLUMN_COUNT = 14

function formatMinutes(value: string | null, t: (key: string, fallback: string) => string): string {
  if (value == null) return t('routing.common.placeholderDash', '—')
  const num = Number(value)
  if (!Number.isFinite(num)) return value
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatRate(value: string | null): string {
  if (value == null) return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return value
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

export function OperationsTable({
  routingTemplateId,
  masterProductId,
  onAddOperation,
  onEditOperation,
}: OperationsTableProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: `routing-operations:${routingTemplateId}`,
  })

  const [expandedVariantsIds, setExpandedVariantsIds] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  )

  const toggleVariants = React.useCallback((operationId: string) => {
    setExpandedVariantsIds((prev) => {
      const next = new Set(prev)
      if (next.has(operationId)) next.delete(operationId)
      else next.add(operationId)
      return next
    })
  }, [])

  const { rows, isLoading, isError, invalidate } = useOperationsForRouting(routingTemplateId)

  const workCenterIds = React.useMemo(
    () =>
      rows
        .map((row) => row.work_center_id)
        .filter((id): id is string => typeof id === 'string'),
    [rows],
  )
  const workCentersById = useWorkCenterLookup(workCenterIds)

  const operationIds = React.useMemo(() => rows.map((r) => r.id), [rows])
  const { countsByOperationId } = useOperationVariantCounts(operationIds)

  const paymentTypeBadgeMap = React.useMemo<EnumBadgeMap>(
    () => ({
      hourly: { label: t('routing.operation.paymentType.hourly', 'Hourly') },
      piecework: { label: t('routing.operation.paymentType.piecework', 'Piecework') },
      base_plus_piecework: { label: t('routing.operation.paymentType.base_plus_piecework', 'Base + piecework') },
    }),
    [t],
  )

  const handleDelete = React.useCallback(
    async (row: OperationRow) => {
      const confirmed = await confirm({
        title: t('routing.operation.deleteConfirm.title', 'Delete this operation?'),
        text: t(
          'routing.operation.deleteConfirm.text',
          'Operation "{name}" will be soft-deleted. Dependencies referencing it will be dropped.',
        ).replace('{name}', row.name),
        confirmText: t('routing.operation.deleteConfirm.confirm', 'Delete'),
        variant: 'destructive',
      })
      if (!confirmed) return
      try {
        await runMutation({
          context: {
            entityId: 'routing:operation_template',
            operation: 'delete',
            formId: `routing-operations:${routingTemplateId}`,
            routingTemplateId,
            operationId: row.id,
            retryLastMutation,
          },
          operation: async () => {
            await deleteCrud('routing/operation', row.id)
            flash(t('routing.operation.flash.deleted', 'Operation deleted.'), 'success')
            invalidate()
          },
        })
      } catch (err) {
        console.warn('[routing] delete operation failed', err)
        flash(t('routing.operation.flash.deleteError', 'Failed to delete operation.'), 'error')
      }
    },
    [confirm, invalidate, retryLastMutation, routingTemplateId, runMutation, t],
  )

  const handleReorder = React.useCallback(
    async (row: OperationRow, direction: 'up' | 'down') => {
      const index = rows.findIndex((r) => r.id === row.id)
      if (index < 0) return
      const neighbor = direction === 'up' ? rows[index - 1] : rows[index + 1]
      if (!neighbor) return
      try {
        await runMutation({
          context: {
            entityId: 'routing:operation_template',
            operation: 'update',
            formId: `routing-operations:${routingTemplateId}`,
            routingTemplateId,
            operationId: row.id,
            retryLastMutation,
          },
          operation: async () => {
            const mySeq = row.sequence
            const theirSeq = neighbor.sequence
            // Serial pair — see C3 reorder fix: Promise.all lets record-
            // lock injection accept one write while the other is in-flight.
            if (mySeq === theirSeq) {
              await updateCrud('routing/operation', {
                id: neighbor.id,
                sequence: theirSeq + (direction === 'up' ? 10 : -10),
              })
              await updateCrud('routing/operation', { id: row.id, sequence: theirSeq })
            } else {
              await updateCrud('routing/operation', { id: row.id, sequence: theirSeq })
              await updateCrud('routing/operation', { id: neighbor.id, sequence: mySeq })
            }
            invalidate()
          },
        })
      } catch (err) {
        console.warn('[routing] reorder failed', err)
        flash(t('routing.operation.flash.reorderError', 'Failed to reorder operations.'), 'error')
      }
    },
    [rows, runMutation, retryLastMutation, routingTemplateId, invalidate, t],
  )

  if (isLoading) {
    return <LoadingMessage label={t('routing.operation.table.loading', 'Loading operations…')} />
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">
        {t('routing.operation.table.error', 'Failed to load operations.')}
      </p>
    )
  }

  return (
    <>
      <div className="flex items-center justify-end">
        <Button type="button" size="sm" onClick={onAddOperation}>
          <Plus className="mr-1 size-4" />
          {t('routing.operation.table.addOperation', 'Add operation')}
        </Button>
      </div>
      {/*
        Raw <table> — same rationale as BOM's BomTreeView: DataTable has
        no native expanded-row story, and the variants section is a per-
        row inline detail row spanning all columns. Matching BOM's UI
        exactly per the user's ask.
      */}
      <div className="overflow-hidden rounded-md border">
        <table className="w-full">
          <OperationsTableHeader />
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {t('routing.operation.table.empty', 'No operations yet — add the first one to get started.')}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const isFirst = index === 0
                const isLast = index === rows.length - 1
                const isVariantsExpanded = expandedVariantsIds.has(row.id)
                const variantsCount = countsByOperationId.get(row.id) ?? 0
                return (
                  <React.Fragment key={row.id}>
                    <OperationTableRow
                      row={row}
                      workCenter={row.work_center_id ? workCentersById.get(row.work_center_id) ?? null : null}
                      paymentTypeBadgeMap={paymentTypeBadgeMap}
                      variantsCount={variantsCount}
                      isVariantsExpanded={isVariantsExpanded}
                      isFirst={isFirst}
                      isLast={isLast}
                      onToggleVariants={() => toggleVariants(row.id)}
                      onEdit={() => onEditOperation(row)}
                      onDelete={() => handleDelete(row)}
                      onReorder={(direction) => handleReorder(row, direction)}
                    />
                    {isVariantsExpanded ? (
                      <tr className="bg-muted/5">
                        <td colSpan={COLUMN_COUNT} className="p-3">
                          <div className="pl-8">
                            <OperationVariantsSection
                              operationTemplateId={row.id}
                              masterProductId={masterProductId}
                            />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {ConfirmDialogElement}
    </>
  )
}

// ---------------------------------------------------------------------------
// Table header
// ---------------------------------------------------------------------------

function OperationsTableHeader() {
  const t = useT()
  return (
    <thead className="border-b bg-muted/30">
      <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <th className="w-10 px-2 py-2" aria-hidden />
        <th className="w-14 px-3 py-2 text-left">{t('routing.operation.table.sequence', 'Seq.')}</th>
        <th className="px-3 py-2 text-left">{t('routing.operation.table.name', 'Name')}</th>
        <th className="px-3 py-2 text-left">{t('routing.operation.table.workCenter', 'Work center')}</th>
        <th className="w-20 px-3 py-2 text-left">{t('routing.operation.table.setupTime', 'Setup (min)')}</th>
        <th className="w-20 px-3 py-2 text-left">{t('routing.operation.table.runTime', 'Run (min)')}</th>
        <th className="w-24 px-3 py-2 text-left">{t('routing.operation.table.teardownTime', 'Teardown (min)')}</th>
        <th className="w-20 px-3 py-2 text-left">{t('routing.operation.table.waitTime', 'Wait (min)')}</th>
        <th className="w-20 px-3 py-2 text-left">{t('routing.operation.table.moveTime', 'Move (min)')}</th>
        <th className="w-32 px-3 py-2 text-left">{t('routing.operation.table.paymentType', 'Payment')}</th>
        <th className="w-28 px-3 py-2 text-left">{t('routing.operation.table.rate', 'Rate')}</th>
        <th className="w-14 px-3 py-2 text-left">{t('routing.operation.table.subcontracted', 'Sub.')}</th>
        <th className="w-36 px-3 py-2 text-left">{t('routing.operation.table.variants', 'Overrides')}</th>
        <th className="w-40 px-3 py-2 text-right" aria-hidden />
      </tr>
    </thead>
  )
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

type OperationTableRowProps = {
  row: OperationRow
  workCenter: { name: string; code: string } | null
  paymentTypeBadgeMap: EnumBadgeMap
  variantsCount: number
  isVariantsExpanded: boolean
  isFirst: boolean
  isLast: boolean
  onToggleVariants: () => void
  onEdit: () => void
  onDelete: () => void
  onReorder: (direction: 'up' | 'down') => void
}

function OperationTableRow({
  row,
  workCenter,
  paymentTypeBadgeMap,
  variantsCount,
  isVariantsExpanded,
  isFirst,
  isLast,
  onToggleVariants,
  onEdit,
  onDelete,
  onReorder,
}: OperationTableRowProps) {
  const t = useT()

  const rateCell = React.useMemo(() => {
    const payment = row.payment_type
    const hourly = row.hourly_rate
    const piece = row.piecework_rate
    if (payment === 'hourly') {
      return (
        <span className="text-sm font-mono">
          {hourly != null ? `${formatRate(hourly)}/h` : t('routing.common.placeholderDash', '—')}
        </span>
      )
    }
    if (payment === 'piecework') {
      return (
        <span className="text-sm font-mono">
          {piece != null ? `${formatRate(piece)}/pc` : t('routing.common.placeholderDash', '—')}
        </span>
      )
    }
    return (
      <div className="text-sm font-mono leading-tight">
        <div>{hourly != null ? `${formatRate(hourly)}/h` : t('routing.common.placeholderDash', '—')}</div>
        <div className="text-xs text-muted-foreground">
          {piece != null ? `${formatRate(piece)}/pc` : t('routing.common.placeholderDash', '—')}
        </div>
      </div>
    )
  }, [row.payment_type, row.hourly_rate, row.piecework_rate, t])

  return (
    <tr className="border-b hover:bg-muted/10">
      {/* 1. Spacer column (reserved for a future children-expand arrow; also
            aligns visually with BOM's expand column). */}
      <td className="w-10 px-2 py-2 align-middle" aria-hidden />

      {/* 2. Sequence */}
      <td className="w-14 px-3 py-2 align-middle text-sm font-mono text-muted-foreground">
        {row.sequence}
      </td>

      {/* 3. Name */}
      <td className="px-3 py-2 align-middle text-sm font-medium">
        {row.name || t('routing.common.placeholderDash', '—')}
      </td>

      {/* 4. Work center */}
      <td className="px-3 py-2 align-middle">
        {!row.work_center_id ? (
          <SimpleTooltip content={t('routing.operation.table.noWorkCenterTooltip', 'No work center assigned — scheduling will fall back to defaults.')}>
            <span className="inline-flex items-center gap-1 text-xs text-amber-600">
              <AlertCircle className="size-3" />
              {t('routing.operation.table.noWorkCenter', 'No work center')}
            </span>
          </SimpleTooltip>
        ) : workCenter ? (
          <span className="text-sm">
            <NameWithCode name={workCenter.name} code={workCenter.code} />
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t('routing.common.placeholderDash', '—')}</span>
        )}
      </td>

      {/* 5-9. Time components */}
      <td className="w-20 px-3 py-2 align-middle text-sm font-mono">{formatMinutes(row.setup_time_minutes, t)}</td>
      <td className="w-20 px-3 py-2 align-middle text-sm font-mono">{formatMinutes(row.run_time_minutes, t)}</td>
      <td className="w-24 px-3 py-2 align-middle text-sm font-mono">{formatMinutes(row.teardown_time_minutes, t)}</td>
      <td className="w-20 px-3 py-2 align-middle text-sm font-mono">{formatMinutes(row.wait_time_minutes, t)}</td>
      <td className="w-20 px-3 py-2 align-middle text-sm font-mono">{formatMinutes(row.move_time_minutes, t)}</td>

      {/* 10. Payment type */}
      <td className="w-32 px-3 py-2 align-middle">
        <EnumBadge value={row.payment_type} map={paymentTypeBadgeMap} />
      </td>

      {/* 11. Rate */}
      <td className="w-28 px-3 py-2 align-middle">{rateCell}</td>

      {/* 12. Subcontracted */}
      <td className="w-14 px-3 py-2 align-middle">
        <BooleanIcon value={row.is_subcontracted} />
      </td>

      {/* 13. Variants — count pill + expand chevron (mirror BOM §BomLine
            variants column). Adding a variant happens inside the expanded
            section so this column is a single uniform affordance. */}
      <td className="w-36 px-3 py-2 align-middle">
        <button
          type="button"
          onClick={onToggleVariants}
          className="inline-flex items-center gap-1 rounded hover:bg-muted/40"
          aria-label={
            isVariantsExpanded
              ? t('routing.operation.table.variants.collapse', 'Collapse overrides')
              : t('routing.operation.table.variants.expand', 'Show overrides')
          }
          aria-expanded={isVariantsExpanded}
        >
          <Badge
            variant={variantsCount > 0 ? 'secondary' : 'muted'}
            className="h-5 min-w-[2.25rem] justify-center px-1.5 text-xs"
          >
            {variantsCount > 0 ? variantsCount : t('routing.operation.table.variants.none', 'None')}
          </Badge>
          {isVariantsExpanded ? (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground" />
          )}
        </button>
      </td>

      {/* 14. Row actions — reorder + edit + delete (inline, no menu) */}
      <td className="w-40 px-3 py-2 align-middle">
        <div className="flex items-center justify-end gap-0.5">
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onReorder('up')}
            disabled={isFirst}
            aria-label={t('routing.operation.table.actions.moveUp', 'Move up')}
          >
            <ArrowUp className="size-4" />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onReorder('down')}
            disabled={isLast}
            aria-label={t('routing.operation.table.actions.moveDown', 'Move down')}
          >
            <ArrowDown className="size-4" />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={onEdit}
            aria-label={t('routing.operation.table.actions.edit', 'Edit')}
          >
            <Pencil className="size-4" />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            aria-label={t('routing.operation.table.actions.delete', 'Delete')}
          >
            <Trash2 className="size-4 text-red-600" />
          </IconButton>
        </div>
      </td>
    </tr>
  )
}
