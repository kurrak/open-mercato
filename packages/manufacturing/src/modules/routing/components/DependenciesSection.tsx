'use client'

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { EnumBadge, type EnumBadgeMap } from '@open-mercato/ui/backend/ValueIcons'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOperationsForRouting } from '../hooks/useOperationsForRouting'
import { useOperationDependencies, type OperationDependencyRow } from '../hooks/useOperationDependencies'
import { OperationDependencyDialog } from './OperationDependencyDialog'

export type DependenciesSectionProps = {
  routingTemplateId: string
}

/**
 * Dependency list CRUD panel for a routing. Lives below the operations
 * table on the RoutingTab. Renders a simple list of edges
 * ("A → B (finish-to-start, required)") with add + delete actions.
 *
 * Cycle protection is client-side pre-check via validateDag (same pure
 * function the server's /validate-graph endpoint uses) — blocks save
 * in the dialog with the cycle path. The DB UNIQUE(predecessor,
 * successor) + same-routing server check remain the backstop.
 */
export function DependenciesSection({ routingTemplateId }: DependenciesSectionProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: `routing-dependencies:${routingTemplateId}`,
  })

  const { rows: operations } = useOperationsForRouting(routingTemplateId)
  const operationIds = React.useMemo(() => operations.map((o) => o.id), [operations])
  const { rows: dependencies, isLoading, isError, invalidate } = useOperationDependencies(operationIds)

  const [dialogOpen, setDialogOpen] = React.useState(false)

  const operationNamesById = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const op of operations) map.set(op.id, op.name)
    return map
  }, [operations])

  const dependencyTypeBadgeMap = React.useMemo<EnumBadgeMap>(
    () => ({
      finish_to_start: { label: t('routing.dependency.type.finish_to_start', 'Finish-to-start') },
      start_to_start: { label: t('routing.dependency.type.start_to_start', 'Start-to-start') },
      finish_to_finish: { label: t('routing.dependency.type.finish_to_finish', 'Finish-to-finish') },
    }),
    [t],
  )

  const linkStrengthBadgeMap = React.useMemo<EnumBadgeMap>(
    () => ({
      required: { label: t('routing.dependency.strength.required', 'Required') },
      optional: { label: t('routing.dependency.strength.optional', 'Optional') },
    }),
    [t],
  )

  const handleDelete = React.useCallback(
    async (row: OperationDependencyRow) => {
      const predName = operationNamesById.get(row.predecessor_operation_id) ?? row.predecessor_operation_id.slice(0, 8)
      const succName = operationNamesById.get(row.successor_operation_id) ?? row.successor_operation_id.slice(0, 8)
      const ok = await confirm({
        title: t('routing.dependency.deleteConfirm.title', 'Delete this dependency?'),
        text: t(
          'routing.dependency.deleteConfirm.text',
          'The link "{pred} → {succ}" will be soft-deleted.',
        )
          .replace('{pred}', predName)
          .replace('{succ}', succName),
        confirmText: t('routing.dependency.deleteConfirm.confirm', 'Delete'),
        variant: 'destructive',
      })
      if (!ok) return
      try {
        await runMutation({
          context: {
            entityId: 'routing:operation_dependency',
            operation: 'delete',
            formId: `routing-dependencies:${routingTemplateId}`,
            routingTemplateId,
            dependencyId: row.id,
            retryLastMutation,
          },
          operation: async () => {
            await deleteCrud('routing/operation-dependency', row.id)
            flash(t('routing.dependency.flash.deleted', 'Dependency deleted.'), 'success')
            invalidate()
          },
        })
      } catch (err) {
        console.warn('[routing] delete dependency failed', err)
        flash(t('routing.dependency.flash.deleteError', 'Failed to delete dependency.'), 'error')
      }
    },
    [confirm, invalidate, operationNamesById, retryLastMutation, routingTemplateId, runMutation, t],
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">
          {t('routing.dependency.sectionTitle', 'Operation dependencies')}
        </h4>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDialogOpen(true)}
          disabled={operations.length < 2}
        >
          <Plus className="mr-1 size-4" />
          {t('routing.dependency.addCta', 'Add dependency')}
        </Button>
      </div>

      {operations.length < 2 ? (
        <p className="rounded-md border border-dashed bg-muted/10 p-3 text-sm text-muted-foreground">
          {t(
            'routing.dependency.needTwoOps',
            'Add at least two operations to this routing before defining dependencies.',
          )}
        </p>
      ) : isLoading ? (
        <LoadingMessage label={t('routing.dependency.loading', 'Loading dependencies…')} />
      ) : isError ? (
        <p className="text-sm text-destructive">
          {t('routing.dependency.loadError', 'Failed to load dependencies.')}
        </p>
      ) : dependencies.length === 0 ? (
        <p className="rounded-md border border-dashed bg-muted/10 p-3 text-sm text-muted-foreground">
          {t(
            'routing.dependency.none',
            'No dependencies defined — operations will run in sequence order by default.',
          )}
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full">
            <tbody>
              {dependencies.map((dep) => {
                const predName = operationNamesById.get(dep.predecessor_operation_id) ?? dep.predecessor_operation_id.slice(0, 8)
                const succName = operationNamesById.get(dep.successor_operation_id) ?? dep.successor_operation_id.slice(0, 8)
                return (
                  <tr key={dep.id} className="border-b last:border-b-0 hover:bg-muted/10">
                    <td className="px-3 py-2 align-middle text-sm">
                      <span className="font-medium">{predName}</span>
                      <span className="mx-2 text-muted-foreground">→</span>
                      <span className="font-medium">{succName}</span>
                    </td>
                    <td className="w-40 px-3 py-2 align-middle">
                      <EnumBadge value={dep.dependency_type} map={dependencyTypeBadgeMap} />
                    </td>
                    <td className="w-32 px-3 py-2 align-middle">
                      <EnumBadge value={dep.link_strength} map={linkStrengthBadgeMap} />
                    </td>
                    <td className="w-16 px-3 py-2 align-middle text-right">
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(dep)}
                        aria-label={t('routing.dependency.action.delete', 'Delete dependency')}
                      >
                        <Trash2 className="size-4 text-red-600" />
                      </IconButton>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <OperationDependencyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        routingTemplateId={routingTemplateId}
        operations={operations}
        existingDependencies={dependencies}
        onSuccess={() => {
          setDialogOpen(false)
          invalidate()
        }}
      />

      {ConfirmDialogElement}
    </div>
  )
}
