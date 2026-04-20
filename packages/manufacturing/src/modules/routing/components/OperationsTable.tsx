'use client'

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { AlertCircle } from 'lucide-react'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { BooleanIcon, EnumBadge, type EnumBadgeMap } from '@open-mercato/ui/backend/ValueIcons'
import { NameWithCode } from '../../../lib/components'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOperationsForRouting, type OperationRow } from '../hooks/useOperationsForRouting'
import { useWorkCenterLookup } from '../hooks/useWorkCenterLookup'

export type OperationsTableProps = {
  routingTemplateId: string
  onAddOperation: () => void
  onEditOperation: (row: OperationRow) => void
}

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

export function OperationsTable({ routingTemplateId, onAddOperation, onEditOperation }: OperationsTableProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: `routing-operations:${routingTemplateId}`,
  })

  const { rows, isLoading, isError, invalidate } = useOperationsForRouting(routingTemplateId)

  // Batch-resolve WorkCenter records so each row's badge shows name + code
  // even for WCs outside the active-search page (inactive or soft-deleted).
  const workCenterIds = React.useMemo(
    () =>
      rows
        .map((row) => row.work_center_id)
        .filter((id): id is string => typeof id === 'string'),
    [rows],
  )
  const workCentersById = useWorkCenterLookup(workCenterIds)

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
            // Serial — running the two updates in parallel lets record-
            // lock injection accept one write while the other is still
            // in-flight, leaving a split state if the second mutation
            // hits the guard. Two sequential PUTs keep the pair atomic
            // from the client's perspective; added latency is negligible
            // on a 2-request operation.
            if (mySeq === theirSeq) {
              // Sequence collision fallback: when two ops tied at the
              // same value (shouldn't happen with server max+10 default
              // but tolerant either way), shift one side by ±10 before
              // swapping.
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

  const columns = React.useMemo<ColumnDef<OperationRow>[]>(
    () => [
      {
        accessorKey: 'sequence',
        header: t('routing.operation.table.sequence', 'Seq.'),
        cell: ({ row }) => (
          <span className="text-sm font-mono text-muted-foreground">{row.original.sequence}</span>
        ),
        meta: { maxWidth: 60 },
      },
      {
        accessorKey: 'name',
        header: t('routing.operation.table.name', 'Name'),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name || t('routing.common.placeholderDash', '—')}</span>
        ),
        meta: { truncate: true, maxWidth: 240 },
      },
      {
        id: 'workCenter',
        header: t('routing.operation.table.workCenter', 'Work center'),
        cell: ({ row }) => {
          const wcId = row.original.work_center_id
          if (!wcId) {
            return (
              <SimpleTooltip content={t('routing.operation.table.noWorkCenterTooltip', 'No work center assigned — scheduling will fall back to defaults.')}>
                <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                  <AlertCircle className="size-3" />
                  {t('routing.operation.table.noWorkCenter', 'No work center')}
                </span>
              </SimpleTooltip>
            )
          }
          const wc = workCentersById.get(wcId)
          if (!wc) {
            return (
              <span className="text-xs text-muted-foreground">{t('routing.common.placeholderDash', '—')}</span>
            )
          }
          return (
            <span className="text-sm">
              <NameWithCode name={wc.name} code={wc.code} />
            </span>
          )
        },
      },
      {
        accessorKey: 'setup_time_minutes',
        header: t('routing.operation.table.setupTime', 'Setup (min)'),
        cell: ({ row }) => <span className="text-sm font-mono">{formatMinutes(row.original.setup_time_minutes, t)}</span>,
        meta: { maxWidth: 90 },
      },
      {
        accessorKey: 'run_time_minutes',
        header: t('routing.operation.table.runTime', 'Run (min)'),
        cell: ({ row }) => <span className="text-sm font-mono">{formatMinutes(row.original.run_time_minutes, t)}</span>,
        meta: { maxWidth: 90 },
      },
      {
        accessorKey: 'teardown_time_minutes',
        header: t('routing.operation.table.teardownTime', 'Teardown (min)'),
        cell: ({ row }) => <span className="text-sm font-mono">{formatMinutes(row.original.teardown_time_minutes, t)}</span>,
        meta: { maxWidth: 100 },
      },
      {
        accessorKey: 'wait_time_minutes',
        header: t('routing.operation.table.waitTime', 'Wait (min)'),
        cell: ({ row }) => <span className="text-sm font-mono">{formatMinutes(row.original.wait_time_minutes, t)}</span>,
        meta: { maxWidth: 90 },
      },
      {
        accessorKey: 'move_time_minutes',
        header: t('routing.operation.table.moveTime', 'Move (min)'),
        cell: ({ row }) => <span className="text-sm font-mono">{formatMinutes(row.original.move_time_minutes, t)}</span>,
        meta: { maxWidth: 90 },
      },
      {
        accessorKey: 'payment_type',
        header: t('routing.operation.table.paymentType', 'Payment'),
        cell: ({ row }) => <EnumBadge value={row.original.payment_type} map={paymentTypeBadgeMap} />,
        meta: { maxWidth: 140 },
      },
      {
        id: 'rate',
        header: t('routing.operation.table.rate', 'Rate'),
        cell: ({ row }) => {
          // Per spec §3 + Q4 decision: render the rate matching
          // payment_type; stack both in one cell for base_plus_piecework.
          const payment = row.original.payment_type
          const hourly = row.original.hourly_rate
          const piece = row.original.piecework_rate
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
          // base_plus_piecework — stack both
          return (
            <div className="text-sm font-mono leading-tight">
              <div>{hourly != null ? `${formatRate(hourly)}/h` : t('routing.common.placeholderDash', '—')}</div>
              <div className="text-xs text-muted-foreground">
                {piece != null ? `${formatRate(piece)}/pc` : t('routing.common.placeholderDash', '—')}
              </div>
            </div>
          )
        },
        meta: { maxWidth: 120 },
      },
      {
        accessorKey: 'is_subcontracted',
        header: t('routing.operation.table.subcontracted', 'Sub.'),
        cell: ({ row }) => <BooleanIcon value={row.original.is_subcontracted} />,
        meta: { maxWidth: 60 },
      },
    ],
    [paymentTypeBadgeMap, t, workCentersById],
  )

  if (isError) {
    return (
      <p className="text-sm text-destructive">
        {t('routing.operation.table.error', 'Failed to load operations.')}
      </p>
    )
  }

  return (
    <>
      <DataTable<OperationRow>
        columns={columns}
        data={rows}
        isLoading={isLoading}
        actions={
          <Button type="button" size="sm" onClick={onAddOperation}>
            {t('routing.operation.table.addOperation', 'Add operation')}
          </Button>
        }
        rowActions={(row) => {
          const index = rows.findIndex((r) => r.id === row.id)
          const canMoveUp = index > 0
          const canMoveDown = index >= 0 && index < rows.length - 1
          const items = [
            {
              id: 'edit',
              label: t('routing.operation.table.actions.edit', 'Edit'),
              onSelect: () => onEditOperation(row),
            },
          ]
          if (canMoveUp) {
            items.push({
              id: 'reorder-up',
              label: t('routing.operation.table.actions.moveUp', 'Move up'),
              onSelect: () => handleReorder(row, 'up'),
            })
          }
          if (canMoveDown) {
            items.push({
              id: 'reorder-down',
              label: t('routing.operation.table.actions.moveDown', 'Move down'),
              onSelect: () => handleReorder(row, 'down'),
            })
          }
          items.push({
            id: 'delete',
            label: t('routing.operation.table.actions.delete', 'Delete'),
            destructive: true,
            onSelect: () => handleDelete(row),
          } as typeof items[number])
          return <RowActions items={items} />
        }}
        rowClickActionIds={['edit']}
      />
      {ConfirmDialogElement}
    </>
  )
}
