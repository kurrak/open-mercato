'use client'

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { TooltipProvider } from '@open-mercato/ui/primitives/tooltip'
import { Button } from '@open-mercato/ui/primitives/button'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useQueryClient } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRoutingTemplatesForProduct } from '../hooks/useRoutingTemplatesForProduct'
import { invalidateOperationsForRouting, type OperationRow } from '../hooks/useOperationsForRouting'
import { RoutingTemplateSelector } from './RoutingTemplateSelector'
import { OperationsTable } from './OperationsTable'
import { OperationDialog } from './OperationDialog'
import {
  ROUTING_TEMPLATE_DEFAULT_VALUES,
  buildRoutingTemplateFormFields,
  buildRoutingTemplateFormGroups,
  type RoutingTemplateFormValues,
} from './RoutingTemplateFormConfig'

// Downstream panels (time rollup in C6) need the product's manufacturing
// extension to pick their configuration input (none / variant_based /
// rule_based). Parent page always has the extension loaded before
// rendering this tab, so extension is non-optional.
export type RoutingTabExtension = {
  id: string
  productId: string
  configurationType: string
  procurementType: string
  baseUomId: string | null
  isPhantomDefault: boolean
}

export type RoutingTabProps = {
  productId: string
  extension: RoutingTabExtension
}

export default function RoutingTab({ productId, extension: _extension }: RoutingTabProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'routing-tab',
  })

  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [operationDialogState, setOperationDialogState] = React.useState<
    | { mode: 'add' }
    | { mode: 'edit'; operation: OperationRow }
    | null
  >(null)

  const {
    options: templates,
    isLoading,
    isError,
    invalidate,
  } = useRoutingTemplatesForProduct(productId)

  // Default selection = first active template, fallback to first template.
  // Preserves current pick if still present after a reload.
  React.useEffect(() => {
    if (selectedId && templates.some((r) => r.id === selectedId)) return
    const firstActive = templates.find((r) => r.isActive)
    setSelectedId(firstActive?.id ?? templates[0]?.id ?? null)
  }, [templates, selectedId])

  const handleCreateRoutingTemplate = React.useCallback(
    async (values: RoutingTemplateFormValues) => {
      const result = await createCrud<{ id?: string }>('routing/routing', {
        ...values,
        productId,
      })
      flash(t('routing.tab.created', 'Routing created.'), 'success')
      setCreateDialogOpen(false)
      const newId = result.result?.id ?? null
      if (newId) setSelectedId(newId)
      invalidate()
    },
    [productId, invalidate, t],
  )

  const handleDeleteRouting = React.useCallback(async () => {
    if (!selectedId) return
    const current = templates.find((r) => r.id === selectedId)
    const ok = await confirm({
      title: t('routing.tab.deleteConfirm.title', 'Delete this routing?'),
      text: t(
        'routing.tab.deleteConfirm.text',
        'The routing "{name}" will be soft-deleted. Its operations and dependencies remain in the database but are no longer reachable through this tab.',
      ).replace('{name}', current?.name ?? ''),
      confirmText: t('routing.tab.deleteConfirm.confirm', 'Delete routing'),
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await runMutation({
        context: { entityId: 'routing:routing_template', operation: 'delete', retryLastMutation },
        operation: async () => {
          await deleteCrud('routing/routing', selectedId)
          flash(t('routing.tab.deleteSuccess', 'Routing deleted.'), 'success')
          setSelectedId(null)
          invalidate()
        },
      })
    } catch (err) {
      console.warn('[routing] delete routing template failed', err)
    }
  }, [confirm, runMutation, retryLastMutation, selectedId, templates, invalidate, t])

  if (isLoading) {
    return <LoadingMessage label={t('routing.tab.loading', 'Loading routings…')} />
  }

  if (isError) {
    return (
      <div className="p-4">
        <p className="text-sm text-destructive">
          {t('routing.tab.error.loadTemplates', 'Failed to load routings.')}
        </p>
      </div>
    )
  }

  if (templates.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          title={t('routing.tab.empty.title', 'No routing defined')}
          description={t(
            'routing.tab.empty.description',
            'Create a routing to start defining operations, work centers, and dependencies for this product.',
          )}
          action={{
            label: t('routing.tab.empty.createCta', 'Create routing'),
            onClick: () => setCreateDialogOpen(true),
            icon: <Plus className="size-4" />,
          }}
        />
        <RoutingTemplateCreateDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onSubmit={handleCreateRoutingTemplate}
        />
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">{t('routing.tab.title', 'Production Routing')}</h3>
          <div className="flex items-center gap-2">
            {selectedId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDeleteRouting}
                className="text-red-600"
              >
                <Trash2 className="size-4" />
                {t('routing.tab.deleteRouting', 'Delete routing')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCreateDialogOpen(true)}
            >
              <Plus className="size-4" />
              {t('routing.tab.addRouting', 'Add routing')}
            </Button>
          </div>
        </div>

        {templates.length > 1 ? (
          <RoutingTemplateSelector
            templates={templates}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        ) : null}

        {selectedId ? (
          <OperationsTable
            routingTemplateId={selectedId}
            masterProductId={productId}
            onAddOperation={() => setOperationDialogState({ mode: 'add' })}
            onEditOperation={(row) => setOperationDialogState({ mode: 'edit', operation: row })}
          />
        ) : null}

        <RoutingTemplateCreateDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onSubmit={handleCreateRoutingTemplate}
        />

        {selectedId && operationDialogState ? (
          <OperationDialog
            open
            onOpenChange={(next) => { if (!next) setOperationDialogState(null) }}
            routingTemplateId={selectedId}
            editingOperation={operationDialogState.mode === 'edit' ? operationDialogState.operation : null}
            onSuccess={() => {
              setOperationDialogState(null)
              if (selectedId) invalidateOperationsForRouting(queryClient, selectedId)
            }}
          />
        ) : null}

        {ConfirmDialogElement}
      </div>
    </TooltipProvider>
  )
}

// ---------------------------------------------------------------------------
// Create dialog — minimal CrudForm for RoutingTemplate. An edit dialog can
// be hosted here later alongside the routing selector.
// ---------------------------------------------------------------------------

function RoutingTemplateCreateDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: RoutingTemplateFormValues) => Promise<void>
}) {
  const t = useT()
  const fields = React.useMemo(() => buildRoutingTemplateFormFields(t), [t])
  const groups = React.useMemo(() => buildRoutingTemplateFormGroups(t), [t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg [&_.grid]:!grid-cols-1">
        <DialogHeader>
          <DialogTitle>{t('routing.tab.createDialog.title', 'Create routing')}</DialogTitle>
        </DialogHeader>
        <CrudForm<RoutingTemplateFormValues>
          fields={fields}
          groups={groups}
          initialValues={ROUTING_TEMPLATE_DEFAULT_VALUES}
          submitLabel={t('routing.tab.createDialog.submit', 'Create')}
          embedded
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
