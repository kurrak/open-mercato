'use client'

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { TabEmptyState } from '@open-mercato/ui/backend/detail'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { FlaskConical, ArrowUp, ArrowDown, AlertTriangle, XCircle } from 'lucide-react'
import { useListLoader } from '../../../lib/useListLoader'
import ConfigurationForm from './ConfigurationForm'
import { useFeatureFlag } from '../../../lib/useFeatureFlag'
import {
  ATTRIBUTE_DEFAULT_VALUES,
  attributeRecordToFormValues,
  buildAttributeFormFields,
  buildAttributeFormGroups,
  submitAttributeCreate,
  submitAttributeUpdate,
  type AttributeFormValues,
  type ConfigAttributeRow,
} from './AttributeFormConfig'
import type { ResolutionResult } from '../lib/config-resolution'

type UsageResult = { bomLineCount: number; operationVariantCount: number }

const PAGE_SIZE = 50

export default function AttributesSection({ productId }: { productId: string }) {
  const t = useT()
  const canEdit = useFeatureFlag('configurator.edit')
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'configurator-attributes',
  })

  const [page, setPage] = React.useState(1)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingRow, setEditingRow] = React.useState<ConfigAttributeRow | null>(null)
  const [testConfigOpen, setTestConfigOpen] = React.useState(false)
  const [resolutionResult, setResolutionResult] = React.useState<ResolutionResult | null>(null)
  const [resolving, setResolving] = React.useState(false)

  const reload = React.useCallback(() => setReloadToken((n) => n + 1), [])

  const url = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      productId,
      sortField: 'displayOrder',
      sortDir: 'asc',
    })
    return `/api/configurator/manufacturing/config-attribute?${params.toString()}`
  }, [page, productId])

  const { rows, total, totalPages, isLoading } = useListLoader<ConfigAttributeRow>({
    url,
    reloadKey: String(reloadToken),
    errorMessage: t('manufacturing.common.error', 'An error occurred'),
  })

  // --- Category name map for product / product_variant attributes ---

  const [categoryMap, setCategoryMap] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    const filterIds = rows
      .filter(
        (r) =>
          (r.attribute_type === 'product' || r.attribute_type === 'product_variant') &&
          r.product_filter_id,
      )
      .map((r) => r.product_filter_id as string)
    if (filterIds.length === 0) return
    let cancelled = false
    readApiResultOrThrow<{ items?: Array<{ id: string; name: string }> }>(
      `/api/catalog/categories?ids=${encodeURIComponent(filterIds.join(','))}&pageSize=100`,
      undefined,
      { errorMessage: '' },
    )
      .then((data) => {
        if (cancelled) return
        const map: Record<string, string> = {}
        for (const cat of data?.items ?? []) map[cat.id] = cat.name
        setCategoryMap(map)
      })
      .catch((err) => {
        // Non-fatal: Values column falls back to "No category selected" for affected rows.
        console.warn('[configurator] failed to load category names', err)
      })
    return () => { cancelled = true }
  }, [rows])

  // --- Dialog helpers ---

  const openCreateDialog = React.useCallback(() => {
    setEditingRow(null)
    setDialogOpen(true)
  }, [])

  const openEditDialog = React.useCallback((row: ConfigAttributeRow) => {
    setEditingRow(row)
    setDialogOpen(true)
  }, [])

  const closeDialog = React.useCallback(() => {
    setDialogOpen(false)
    setEditingRow(null)
  }, [])

  // --- Reorder ---

  const handleReorder = React.useCallback(
    async (row: ConfigAttributeRow, direction: 'up' | 'down') => {
      const currentIndex = rows.findIndex((r) => r.id === row.id)
      if (currentIndex < 0) return
      const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
      if (swapIndex < 0 || swapIndex >= rows.length) return

      const swapRow = rows[swapIndex]
      try {
        await runMutation({
          operation: async () => {
            await apiCall('/api/configurator/manufacturing/config-attribute/reorder', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sourceId: row.id, targetId: swapRow.id }),
            })
          },
          context: {
            formId: 'configurator-attributes',
            attributeId: row.id,
            retryLastMutation,
          },
        })
        reload()
      } catch {
        flash(t('configurator.attributes.flash.reorderError', 'Failed to reorder'), 'error')
      }
    },
    [rows, runMutation, retryLastMutation, reload, t],
  )

  // --- Delete with usage check ---

  const handleDelete = React.useCallback(
    async (row: ConfigAttributeRow) => {
      let usageText = ''
      try {
        const usage = await readApiResultOrThrow<UsageResult>(
          `/api/configurator/manufacturing/config-attribute/usage?id=${encodeURIComponent(row.id)}`,
          undefined,
          { errorMessage: '' },
        )
        if (usage && (usage.bomLineCount > 0 || usage.operationVariantCount > 0)) {
          usageText = t(
            'configurator.attributes.deleteConfirm.usageWarning',
            'This attribute is referenced by {{bomCount}} BOM lines and {{routingCount}} routing overrides. Deleting it will orphan those references.',
          )
            .replace('{{bomCount}}', String(usage.bomLineCount))
            .replace('{{routingCount}}', String(usage.operationVariantCount))
        }
      } catch {
        // Non-fatal — proceed with delete confirmation without usage info
      }

      const baseText = t(
        'configurator.attributes.deleteConfirm.text',
        'This attribute will be permanently deleted.',
      )

      const confirmed = await confirm({
        title: t('configurator.attributes.deleteConfirm.title', 'Delete Attribute?'),
        text: usageText ? `${usageText}\n\n${baseText}` : baseText,
        variant: 'destructive',
        confirmText: t('manufacturing.common.actions.delete', 'Delete'),
      })
      if (!confirmed) return

      try {
        await runMutation({
          operation: () => deleteCrud('configurator/manufacturing/config-attribute', row.id),
          context: {
            formId: 'configurator-attributes',
            attributeId: row.id,
            retryLastMutation,
          },
        })
        flash(t('configurator.attributes.flash.deleted', 'Attribute deleted'), 'success')
        reload()
      } catch {
        flash(t('configurator.attributes.flash.deleteError', 'Failed to delete attribute'), 'error')
      }
    },
    [confirm, runMutation, retryLastMutation, reload, t],
  )

  // --- Form submit ---

  const handleFormSubmit = React.useCallback(
    async (values: AttributeFormValues) => {
      await runMutation({
        operation: async () => {
          if (editingRow) {
            await submitAttributeUpdate(editingRow.id, values, productId, t)
            flash(t('configurator.attributes.flash.updated', 'Attribute updated'), 'success')
          } else {
            await submitAttributeCreate(values, productId, t)
            flash(t('configurator.attributes.flash.created', 'Attribute created'), 'success')
          }
        },
        context: {
          formId: 'configurator-attributes',
          retryLastMutation,
        },
      })
      closeDialog()
      reload()
    },
    [editingRow, productId, closeDialog, reload, runMutation, retryLastMutation, t],
  )

  // --- Test Configuration ---

  const handleTestResolve = React.useCallback(
    async (snapshot: Record<string, unknown>) => {
      setResolving(true)
      setResolutionResult(null)
      try {
        const stringSnapshot: Record<string, string> = {}
        for (const [key, val] of Object.entries(snapshot)) {
          if (val != null) stringSnapshot[key] = String(val)
        }
        const { ok, result } = await apiCall<ResolutionResult>(
          '/api/configurator/manufacturing/configurator/resolve',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ productId, configSnapshot: stringSnapshot }),
          },
        )
        if (!ok || !result) {
          flash(t('configurator.testConfig.resolveError', 'Failed to resolve configuration'), 'error')
          return
        }
        setResolutionResult(result)
      } catch (err) {
        console.warn('[configurator] resolve failed', err)
        flash(t('configurator.testConfig.resolveError', 'Failed to resolve configuration'), 'error')
      } finally {
        setResolving(false)
      }
    },
    [productId, t],
  )

  // --- Values display helper ---

  const renderValuesCell = React.useCallback(
    (row: ConfigAttributeRow) => {
      switch (row.attribute_type) {
        case 'enum': {
          if (!Array.isArray(row.allowed_values) || row.allowed_values.length === 0)
            return <span className="text-muted-foreground">—</span>
          const values = row.allowed_values as string[]
          return (
            <div className="flex flex-wrap gap-1">
              {values.map((v) => (
                <span
                  key={v}
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-muted text-muted-foreground"
                >
                  {v}
                </span>
              ))}
            </div>
          )
        }
        case 'numeric_range': {
          if (!row.allowed_values || typeof row.allowed_values !== 'object' || Array.isArray(row.allowed_values))
            return <span className="text-muted-foreground">—</span>
          const range = row.allowed_values as { min?: number; max?: number; step?: number }
          return (
            <span className="text-sm">
              {range.min ?? 0} – {range.max ?? 100} ({t('configurator.attributes.table.step', 'step')} {range.step ?? 1})
            </span>
          )
        }
        case 'boolean':
          return <span className="text-sm">{t('configurator.attributes.table.yesNo', 'Yes / No')}</span>
        case 'text':
          return <span className="text-sm text-muted-foreground">{t('configurator.attributes.table.freeText', 'Free text')}</span>
        case 'product':
        case 'product_variant': {
          const filterId = row.product_filter_id
          if (!filterId) {
            return <span className="text-sm text-muted-foreground">{t('configurator.attributes.table.noCategorySelected', 'No category selected')}</span>
          }
          const categoryName = categoryMap[filterId]
          return categoryName ? (
            <Link
              href="/backend/catalog/categories"
              target="_blank"
              className="text-sm text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {categoryName}
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">{filterId.slice(0, 8)}…</span>
          )
        }
        default:
          return <span className="text-muted-foreground">—</span>
      }
    },
    [categoryMap, t],
  )

  // --- Columns ---

  const columns = React.useMemo<ColumnDef<ConfigAttributeRow>[]>(
    () => {
      const cols: ColumnDef<ConfigAttributeRow>[] = [
        {
          accessorKey: 'key',
          header: t('configurator.attributes.table.key', 'Key'),
          cell: ({ row }) => <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{row.original.key}</code>,
          meta: { truncate: true, maxWidth: 180 },
        },
        {
          accessorKey: 'label',
          header: t('configurator.attributes.table.label', 'Label'),
          cell: ({ row }) => <span className="text-sm">{row.original.label || '—'}</span>,
          meta: { truncate: true, maxWidth: 160 },
        },
        {
          accessorKey: 'attribute_type',
          header: t('configurator.attributes.table.type', 'Type'),
          cell: ({ row }) => (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-secondary/80 text-secondary-foreground">
              {t(`configurator.attributes.enum.type.${row.original.attribute_type}`, row.original.attribute_type)}
            </span>
          ),
          meta: { maxWidth: 90 },
        },
        {
          id: 'values',
          header: t('configurator.attributes.table.values', 'Values'),
          cell: ({ row }) => renderValuesCell(row.original),
        },
        {
          accessorKey: 'is_mandatory',
          header: t('configurator.attributes.table.mandatory', 'Mandatory'),
          cell: ({ row }) => <BooleanIcon value={row.original.is_mandatory} />,
          meta: { maxWidth: 50 },
        },
        {
          accessorKey: 'attribute_group',
          header: t('configurator.attributes.table.group', 'Group'),
          cell: ({ row }) => (
            <span className="text-sm">{row.original.attribute_group || '—'}</span>
          ),
          meta: { maxWidth: 100 },
        },
      ]

      if (canEdit) {
        cols.push({
          id: 'reorder',
          header: '',
          cell: ({ row }) => {
            const rowIndex = rows.findIndex((r) => r.id === row.original.id)
            return (
              <div role="group" className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <IconButton
                  variant="ghost"
                  size="xs"
                  type="button"
                  aria-label={t('configurator.attributes.actions.moveUp', 'Move Up')}
                  disabled={rowIndex <= 0}
                  onClick={() => handleReorder(row.original, 'up')}
                >
                  <ArrowUp className="size-3.5" />
                </IconButton>
                <IconButton
                  variant="ghost"
                  size="xs"
                  type="button"
                  aria-label={t('configurator.attributes.actions.moveDown', 'Move Down')}
                  disabled={rowIndex >= rows.length - 1}
                  onClick={() => handleReorder(row.original, 'down')}
                >
                  <ArrowDown className="size-3.5" />
                </IconButton>
              </div>
            )
          },
          meta: { maxWidth: 44 },
        })
      }

      return cols
    },
    [canEdit, handleReorder, renderValuesCell, rows, t],
  )

  // --- Form state ---

  const formInitialValues = React.useMemo<Partial<AttributeFormValues>>(() => {
    if (editingRow) return attributeRecordToFormValues(editingRow)
    return { ...ATTRIBUTE_DEFAULT_VALUES, displayOrder: rows.length }
  }, [editingRow, rows.length])

  // --- Empty state ---

  if (!isLoading && rows.length === 0 && page === 1) {
    return (
      <>
        <TabEmptyState
          title={t('configurator.attributes.emptyTitle', 'No configuration attributes defined')}
          description={t(
            'configurator.attributes.emptyDescription',
            'Add attributes to define configuration axes for this product.',
          )}
          actionLabel={canEdit ? t('configurator.attributes.actions.add', 'Add Attribute') : undefined}
          onAction={canEdit ? openCreateDialog : undefined}
        />
        {dialogOpen && (
          <AttributeDialog
            open={dialogOpen}
            onClose={closeDialog}
            title={t('configurator.attributes.dialog.createTitle', 'Add Attribute')}
            isEdit={false}
            initialValues={formInitialValues}
            submitLabel={t('configurator.attributes.dialog.create', 'Create')}
            onSubmit={handleFormSubmit}
          />
        )}
        {ConfirmDialogElement}
      </>
    )
  }

  // --- Table view ---

  return (
    <div className="space-y-4">
      <DataTable<ConfigAttributeRow>
        columns={columns}
        data={rows}
        isLoading={isLoading}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total,
          totalPages,
          onPageChange: setPage,
        }}
        actions={
          canEdit ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={rows.length === 0}
                onClick={() => {
                  setResolutionResult(null)
                  setTestConfigOpen(true)
                }}
              >
                <FlaskConical className="mr-2 size-4" />
                {t('configurator.attributes.actions.testConfig', 'Test Configuration')}
              </Button>
              <Button type="button" size="sm" onClick={openCreateDialog}>
                {t('configurator.attributes.actions.add', 'Add Attribute')}
              </Button>
            </div>
          ) : undefined
        }
        rowActions={
          canEdit
            ? (row) => (
                <RowActions
                  items={[
                    {
                      id: 'edit',
                      label: t('manufacturing.common.actions.edit', 'Edit'),
                      onSelect: () => openEditDialog(row),
                    },
                    {
                      id: 'delete',
                      label: t('manufacturing.common.actions.delete', 'Delete'),
                      destructive: true,
                      onSelect: () => handleDelete(row),
                    },
                  ]}
                />
              )
            : undefined
        }
      />

      {dialogOpen && (
        <AttributeDialog
          open={dialogOpen}
          onClose={closeDialog}
          title={
            editingRow
              ? t('configurator.attributes.dialog.editTitle', 'Edit Attribute')
              : t('configurator.attributes.dialog.createTitle', 'Add Attribute')
          }
          isEdit={!!editingRow}
          initialValues={formInitialValues}
          submitLabel={
            editingRow
              ? t('configurator.attributes.dialog.save', 'Save')
              : t('configurator.attributes.dialog.create', 'Create')
          }
          onSubmit={handleFormSubmit}
        />
      )}

      {testConfigOpen && (
        <Dialog open={testConfigOpen} onOpenChange={(isOpen) => { if (!isOpen) setTestConfigOpen(false) }}>
          <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('configurator.testConfig.title', 'Test Configuration')}</DialogTitle>
            </DialogHeader>
            <ConfigurationForm
              productId={productId}
              onSubmit={handleTestResolve}
              submitLabel={t('configurator.testConfig.resolve', 'Resolve')}
              disabled={resolving}
            />
            {resolutionResult && (
              <div className="space-y-3 border-t pt-4 mt-2">
                <h4 className="text-sm font-medium">
                  {t('configurator.testConfig.resolvedTitle', 'Resolved Variant Conditions')}
                </h4>
                <div className="rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-3 py-1.5 text-left font-medium">{t('configurator.testConfig.keyHeader', 'Key')}</th>
                        <th className="px-3 py-1.5 text-left font-medium">{t('configurator.testConfig.valueHeader', 'Value')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(resolutionResult.resolvedConditions).map(([key, val]) => (
                        <tr key={key} className="border-b last:border-0">
                          <td className="px-3 py-1.5"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{key}</code></td>
                          <td className="px-3 py-1.5">{val}</td>
                        </tr>
                      ))}
                      {Object.keys(resolutionResult.resolvedConditions).length === 0 && (
                        <tr>
                          <td colSpan={2} className="px-3 py-3 text-center text-muted-foreground">
                            {t('configurator.testConfig.noConditions', 'No conditions resolved')}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {resolutionResult.warnings.length > 0 && (
                  <div className="space-y-1">
                    {resolutionResult.warnings.map((warning, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 text-sm text-amber-600">
                        <AlertTriangle className="size-3.5 shrink-0" />
                        {warning}
                      </div>
                    ))}
                  </div>
                )}
                {resolutionResult.errors.length > 0 && (
                  <div className="space-y-1">
                    {resolutionResult.errors.map((error, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 text-sm text-destructive">
                        <XCircle className="size-3.5 shrink-0" />
                        {error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {ConfirmDialogElement}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dialog wrapper
// ---------------------------------------------------------------------------

type AttributeDialogProps = {
  open: boolean
  onClose: () => void
  title: string
  isEdit: boolean
  initialValues: Partial<AttributeFormValues>
  submitLabel: string
  onSubmit: (values: AttributeFormValues) => Promise<void>
}

function AttributeDialog({
  open,
  onClose,
  title,
  isEdit,
  initialValues,
  submitLabel,
  onSubmit,
}: AttributeDialogProps) {
  const t = useT()
  const [currentType, setCurrentType] = React.useState(
    (initialValues.attributeType as string) || 'enum',
  )

  const fields = React.useMemo(
    () => buildAttributeFormFields(t, isEdit, currentType, isEdit ? undefined : setCurrentType),
    [t, isEdit, currentType],
  )

  const groups = React.useMemo(
    () => buildAttributeFormGroups(t, currentType),
    [t, currentType],
  )

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <CrudForm<AttributeFormValues>
          embedded
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          submitLabel={submitLabel}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
