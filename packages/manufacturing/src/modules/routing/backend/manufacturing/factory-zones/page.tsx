'use client'

import * as React from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { CodeCell } from '../../../../../lib/components'
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
import { textareaClassName } from '../../../../../lib/styles'

type FactoryZoneRow = {
  id: string
  name: string
  code: string
  is_active: boolean
  notes?: string | null
  location_id?: string | null
}

type FormData = {
  name: string
  code: string
  notes: string
  isActive: boolean
}

const PAGE_SIZE = 25

const EMPTY_FORM: FormData = { name: '', code: '', notes: '', isActive: true }

export default function FactoryZonesPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'manufacturing-factory-zones',
  })

  const [page, setPage] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [search, setSearch] = React.useState('')
  const [reloadToken, setReloadToken] = React.useState(0)

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingRow, setEditingRow] = React.useState<FactoryZoneRow | null>(null)
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
    return `/api/routing/factory-zone?${params.toString()}`
  }, [page, search, sorting])

  const { rows, total, totalPages, isLoading } = useListLoader<FactoryZoneRow>({
    url,
    reloadKey: `${reloadToken}:${scopeVersion}`,
    errorMessage: t('manufacturing.common.error', 'An error occurred'),
  })

  const openCreate = React.useCallback(() => {
    setEditingRow(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }, [])

  const openEdit = React.useCallback((row: FactoryZoneRow) => {
    setEditingRow(row)
    setForm({
      name: row.name,
      code: row.code,
      notes: row.notes ?? '',
      isActive: row.is_active,
    })
    setDialogOpen(true)
  }, [])

  const handleSave = React.useCallback(async () => {
    setIsSaving(true)
    try {
      if (editingRow) {
        await runMutation({
          operation: () => updateCrud('routing/factory-zone', {
            id: editingRow.id,
            name: form.name,
            code: form.code,
            notes: form.notes || undefined,
            isActive: form.isActive,
          }),
          context: {
            formId: 'manufacturing-factory-zones',
            zoneId: editingRow.id,
            retryLastMutation,
          },
        })
        flash(t('manufacturing.factoryZones.flash.updated', 'Factory zone updated'), 'success')
      } else {
        await runMutation({
          operation: () => createCrud('routing/factory-zone', {
            name: form.name,
            code: form.code,
            notes: form.notes || undefined,
            isActive: form.isActive,
          }),
          context: {
            formId: 'manufacturing-factory-zones',
            retryLastMutation,
          },
        })
        flash(t('manufacturing.factoryZones.flash.created', 'Factory zone created'), 'success')
      }
      setDialogOpen(false)
      reload()
    } catch {
      flash(t('manufacturing.factoryZones.flash.saveError', 'Failed to save factory zone'), 'error')
    } finally {
      setIsSaving(false)
    }
  }, [editingRow, form, reload, retryLastMutation, runMutation, t])

  const handleShortcut = useSubmitShortcut(handleSave)

  const handleDelete = React.useCallback(
    async (row: FactoryZoneRow) => {
      const confirmed = await confirm({
        title: t('manufacturing.factoryZones.deleteConfirm.title', 'Delete Factory Zone?'),
        text: t(
          'manufacturing.factoryZones.deleteConfirm.text',
          'This factory zone will be permanently deleted.',
        ),
        variant: 'destructive',
        confirmText: t('manufacturing.common.actions.delete', 'Delete'),
      })
      if (!confirmed) return
      try {
        await runMutation({
          operation: () => deleteCrud('routing/factory-zone', row.id),
          context: {
            formId: 'manufacturing-factory-zones',
            zoneId: row.id,
            retryLastMutation,
          },
        })
        flash(t('manufacturing.factoryZones.flash.deleted', 'Factory zone deleted'), 'success')
        reload()
      } catch {
        flash(t('manufacturing.factoryZones.flash.deleteError', 'Failed to delete factory zone'), 'error')
      }
    },
    [confirm, reload, retryLastMutation, runMutation, t],
  )

  const columns = React.useMemo<ColumnDef<FactoryZoneRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('manufacturing.factoryZones.table.name', 'Name'),
        meta: { truncate: true, maxWidth: 240 },
      },
      {
        accessorKey: 'code',
        header: t('manufacturing.factoryZones.table.code', 'Code'),
        cell: ({ row }) => <CodeCell value={row.original.code} />,
        meta: { maxWidth: 140 },
      },
      {
        id: 'isActive',
        header: t('manufacturing.factoryZones.table.active', 'Active'),
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
    [t],
  )

  return (
    <div className="space-y-4">
      <DataTable<FactoryZoneRow>
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
          <Button type="button" onClick={openCreate}>
            {t('manufacturing.factoryZones.actions.add', 'Add Factory Zone')}
          </Button>
        }
        rowActions={(row) => (
          <RowActions
            items={[
              {
                id: 'edit',
                label: t('manufacturing.factoryZones.actions.edit', 'Edit'),
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
        )}
        rowClickActionIds={['edit']}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent onKeyDown={handleShortcut}>
          <DialogHeader>
            <DialogTitle>
              {editingRow
                ? t('manufacturing.factoryZones.dialog.editTitle', 'Edit Factory Zone')
                : t('manufacturing.factoryZones.dialog.createTitle', 'Create Factory Zone')}
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
              <Label htmlFor="fz-name">
                {t('manufacturing.factoryZones.field.name', 'Name')} *
              </Label>
              <Input
                id="fz-name"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fz-code">
                {t('manufacturing.factoryZones.field.code', 'Code')} *
              </Label>
              <Input
                id="fz-code"
                value={form.code}
                onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fz-notes">
                {t('manufacturing.factoryZones.field.notes', 'Notes')}
              </Label>
              <textarea
                id="fz-notes"
                className={textareaClassName}
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="fz-isActive"
                checked={form.isActive}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, isActive: Boolean(checked) }))
                }
              />
              <Label htmlFor="fz-isActive">
                {t('manufacturing.factoryZones.field.isActive', 'Active')}
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
