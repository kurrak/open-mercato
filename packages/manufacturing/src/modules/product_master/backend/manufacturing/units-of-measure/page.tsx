'use client'

import * as React from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { CodeCell, Select } from '../../../../../lib/components'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useListLoader } from '../../../../../lib/useListLoader'
import { useFeatureFlag } from '../../../../../lib/useFeatureFlag'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { useSubmitShortcut } from '../../../../../lib/useSubmitShortcut'

const UOM_TYPES = ['piece', 'length', 'area', 'weight', 'volume', 'time'] as const
type UomType = (typeof UOM_TYPES)[number]

type UomRow = {
  id: string
  code: string
  name: string
  uom_type: string
  is_active: boolean
}

type FormData = {
  code: string
  name: string
  uomType: UomType
  isActive: boolean
}

const PAGE_SIZE = 25

const EMPTY_FORM: FormData = { code: '', name: '', uomType: 'piece', isActive: true }

function useUomTypeLabels() {
  const t = useT()
  return React.useMemo<Record<UomType, string>>(
    () => ({
      piece: t('manufacturing.uom.type.piece', 'Piece'),
      length: t('manufacturing.uom.type.length', 'Length'),
      area: t('manufacturing.uom.type.area', 'Area'),
      weight: t('manufacturing.uom.type.weight', 'Weight'),
      volume: t('manufacturing.uom.type.volume', 'Volume'),
      time: t('manufacturing.uom.type.time', 'Time'),
    }),
    [t],
  )
}

export default function UnitsOfMeasurePage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'manufacturing-uom',
  })
  const uomTypeLabels = useUomTypeLabels()

  const [page, setPage] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [search, setSearch] = React.useState('')
  const [reloadToken, setReloadToken] = React.useState(0)
  const canEdit = useFeatureFlag('product_master.edit')

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingRow, setEditingRow] = React.useState<UomRow | null>(null)
  const [form, setForm] = React.useState<FormData>(EMPTY_FORM)
  const [isSaving, setIsSaving] = React.useState(false)

  const reload = React.useCallback(() => setReloadToken((n) => n + 1), [])

  const url = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    })
    if (search.trim()) params.set('search', search.trim())
    if (sorting.length > 0) {
      params.set('sortBy', sorting[0].id)
      params.set('sortOrder', sorting[0].desc ? 'desc' : 'asc')
    }
    return `/api/product_master/manufacturing/unit-of-measure?${params.toString()}`
  }, [page, search, sorting])

  const { rows, total, totalPages, isLoading } = useListLoader<UomRow>({
    url,
    reloadKey: `${reloadToken}:${scopeVersion}`,
    errorMessage: t('manufacturing.common.error', 'An error occurred'),
  })

  const openCreate = React.useCallback(() => {
    setEditingRow(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }, [])

  const openEdit = React.useCallback((row: UomRow) => {
    setEditingRow(row)
    setForm({
      code: row.code,
      name: row.name,
      uomType: row.uom_type as UomType,
      isActive: row.is_active,
    })
    setDialogOpen(true)
  }, [])

  const handleSave = React.useCallback(async () => {
    setIsSaving(true)
    try {
      if (editingRow) {
        await runMutation({
          operation: () => updateCrud('product_master/manufacturing/unit-of-measure', {
            id: editingRow.id,
            code: form.code,
            name: form.name,
            uomType: form.uomType,
            isActive: form.isActive,
          }),
          context: {
            formId: 'manufacturing-uom',
            uomId: editingRow.id,
            retryLastMutation,
          },
        })
        flash(t('manufacturing.uom.flash.updated', 'Unit of measure updated'), 'success')
      } else {
        await runMutation({
          operation: () => createCrud('product_master/manufacturing/unit-of-measure', {
            code: form.code,
            name: form.name,
            uomType: form.uomType,
            isActive: form.isActive,
          }),
          context: {
            formId: 'manufacturing-uom',
            retryLastMutation,
          },
        })
        flash(t('manufacturing.uom.flash.created', 'Unit of measure created'), 'success')
      }
      setDialogOpen(false)
      reload()
    } catch {
      flash(t('manufacturing.uom.flash.saveError', 'Failed to save unit of measure'), 'error')
    } finally {
      setIsSaving(false)
    }
  }, [editingRow, form, reload, retryLastMutation, runMutation, t])

  const handleShortcut = useSubmitShortcut(handleSave)

  const handleDelete = React.useCallback(
    async (row: UomRow) => {
      const confirmed = await confirm({
        title: t('manufacturing.uom.deleteConfirm.title', 'Delete Unit of Measure?'),
        text: t(
          'manufacturing.uom.deleteConfirm.text',
          'This unit of measure will be permanently deleted.',
        ),
        variant: 'destructive',
        confirmText: t('manufacturing.common.actions.delete', 'Delete'),
      })
      if (!confirmed) return
      try {
        await runMutation({
          operation: () => deleteCrud('product_master/manufacturing/unit-of-measure', row.id),
          context: {
            formId: 'manufacturing-uom',
            uomId: row.id,
            retryLastMutation,
          },
        })
        flash(t('manufacturing.uom.flash.deleted', 'Unit of measure deleted'), 'success')
        reload()
      } catch {
        flash(t('manufacturing.uom.flash.deleteError', 'Failed to delete unit of measure'), 'error')
      }
    },
    [confirm, reload, retryLastMutation, runMutation, t],
  )

  const columns = React.useMemo<ColumnDef<UomRow>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('manufacturing.uom.table.code', 'Code'),
        cell: ({ row }) => <CodeCell value={row.original.code} />,
        meta: { maxWidth: 120 },
      },
      {
        accessorKey: 'name',
        header: t('manufacturing.uom.table.name', 'Name'),
        meta: { truncate: true, maxWidth: 240 },
      },
      {
        id: 'uomType',
        header: t('manufacturing.uom.table.type', 'Type'),
        cell: ({ row }) => (
          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-secondary/80 text-secondary-foreground">
            {uomTypeLabels[row.original.uom_type as UomType] ?? row.original.uom_type}
          </span>
        ),
        meta: { maxWidth: 120 },
      },
      {
        id: 'isActive',
        header: t('manufacturing.uom.table.active', 'Active'),
        cell: ({ row }) =>
          row.original.is_active ? (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-secondary/80 text-secondary-foreground">
              {t('manufacturing.common.active', 'Active')}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">
              {t('manufacturing.common.inactive', 'Inactive')}
            </span>
          ),
        meta: { maxWidth: 100 },
      },
    ],
    [t, uomTypeLabels],
  )

  return (
    <div className="space-y-4">
      <DataTable<UomRow>
        columns={columns}
        data={rows}
        searchValue={search}
        onSearchChange={setSearch}
        sorting={sorting}
        onSortingChange={setSorting}
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
            <Button type="button" onClick={openCreate}>
              {t('manufacturing.uom.actions.add', 'Add Unit of Measure')}
            </Button>
          ) : undefined
        }
        rowActions={
          canEdit
            ? (row) => (
                <RowActions
                  items={[
                    {
                      id: 'edit',
                      label: t('manufacturing.uom.actions.edit', 'Edit'),
                      onSelect: () => openEdit(row),
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
        rowClickActionIds={canEdit ? ['edit'] : undefined}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent onKeyDown={handleShortcut}>
          <DialogHeader>
            <DialogTitle>
              {editingRow
                ? t('manufacturing.uom.dialog.editTitle', 'Edit Unit of Measure')
                : t('manufacturing.uom.dialog.createTitle', 'Create Unit of Measure')}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              handleSave()
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="uom-code">
                {t('manufacturing.uom.field.code', 'Code')} *
              </Label>
              <Input
                id="uom-code"
                value={form.code}
                onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
                required
                maxLength={20}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uom-name">
                {t('manufacturing.uom.field.name', 'Name')} *
              </Label>
              <Input
                id="uom-name"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                required
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uom-type">
                {t('manufacturing.uom.field.uomType', 'Type')}
              </Label>
              <Select
                id="uom-type"
                value={form.uomType}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, uomType: event.target.value as UomType }))
                }
              >
                {UOM_TYPES.map((uomType) => (
                  <option key={uomType} value={uomType}>
                    {uomTypeLabels[uomType]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="uom-isActive"
                checked={form.isActive}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, isActive: Boolean(checked) }))
                }
              />
              <Label htmlFor="uom-isActive">
                {t('manufacturing.uom.field.isActive', 'Active')}
              </Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                {t('manufacturing.common.actions.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving
                  ? t('manufacturing.common.loading', 'Loading...')
                  : t('manufacturing.common.actions.save', 'Save')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {ConfirmDialogElement}
    </div>
  )
}
