'use client'

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useFeatureFlag } from '../../../../../lib/useFeatureFlag'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import ProductPickerDialog from '../../../components/ProductPickerDialog'
import { useListLoader } from '../../../../../lib/useListLoader'

type ManufacturingSummary = {
  configuration_type: string | null
  procurement_type: string | null
  base_uom_code: string | null
  production_method_count: number
}

type ProductRow = {
  id: string
  title: string
  sku?: string | null
  manufacturing_extension_id: string | null
  _manufacturing?: ManufacturingSummary | null
}

const PAGE_SIZE = 25

function ProcurementBadge({ type }: { type: string | null }) {
  const t = useT()
  if (!type) return <span className="text-muted-foreground">—</span>
  const labels: Record<string, string> = {
    make: t('manufacturing.enum.procurement.make', 'Make'),
    buy: t('manufacturing.enum.procurement.buy', 'Buy'),
    buy_and_make: t('manufacturing.enum.procurement.buy_and_make', 'Make + Buy'),
    service: t('manufacturing.enum.procurement.service', 'Service'),
  }
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-secondary/80 text-secondary-foreground">
      {labels[type] ?? type}
    </span>
  )
}

function ConfigBadge({ type }: { type: string | null }) {
  const t = useT()
  if (!type || type === 'none') return <span className="text-muted-foreground">—</span>
  const labels: Record<string, string> = {
    variant_based: t('manufacturing.enum.configuration.variant_based', 'Variant'),
    rule_based: t('manufacturing.enum.configuration.rule_based', 'Rule-based'),
  }
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-secondary/80 text-secondary-foreground">
      {labels[type] ?? type}
    </span>
  )
}

export default function ManufacturingProductsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'manufacturing-products-list',
  })
  const [page, setPage] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [search, setSearch] = React.useState('')
  const [reloadToken, setReloadToken] = React.useState(0)
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const canEdit = useFeatureFlag('product_master.edit')

  const reload = React.useCallback(() => setReloadToken((n) => n + 1), [])

  const url = React.useMemo(() => {
    const params = new URLSearchParams({
      enrolled: 'true',
      page: String(page),
      pageSize: String(PAGE_SIZE),
    })
    if (search.trim()) params.set('search', search.trim())
    if (sorting.length > 0) {
      params.set('sortBy', sorting[0].id)
      params.set('sortOrder', sorting[0].desc ? 'desc' : 'asc')
    }
    return `/api/product_master/manufacturing/catalog-products?${params.toString()}`
  }, [page, search, sorting])

  const { rows, total, totalPages, isLoading } = useListLoader<ProductRow>({
    url,
    reloadKey: `${reloadToken}:${scopeVersion}`,
    errorMessage: t('manufacturing.common.error', 'An error occurred'),
  })

  const handleRemove = React.useCallback(
    async (row: ProductRow) => {
      const confirmed = await confirm({
        title: t('manufacturing.products.removeConfirm.title', 'Remove from Manufacturing?'),
        text: t(
          'manufacturing.products.removeConfirm.text',
          'This will remove the manufacturing extension for this product. Production methods, BOMs, and routings will be preserved but unlinked.',
        ),
        variant: 'destructive',
        confirmText: t('manufacturing.products.actions.removeFromManufacturing', 'Remove from Manufacturing'),
      })
      if (!confirmed) return
      const extId = row.manufacturing_extension_id
      if (!extId) {
        flash(t('manufacturing.products.flash.removeError', 'Failed to remove product'), 'error')
        return
      }
      try {
        await runMutation({
          operation: () => deleteCrud('product_master/manufacturing/product-manufacturing-extension', extId),
          context: {
            formId: 'manufacturing-products-list',
            productId: row.id,
            retryLastMutation,
          },
        })
        flash(t('manufacturing.products.flash.removed', 'Product removed from manufacturing'), 'success')
        reload()
      } catch {
        flash(t('manufacturing.products.flash.removeError', 'Failed to remove product'), 'error')
      }
    },
    [confirm, reload, retryLastMutation, runMutation, t],
  )

  const columns = React.useMemo<ColumnDef<ProductRow>[]>(
    () => [
      {
        accessorKey: 'title',
        header: t('manufacturing.products.table.productName', 'Product'),
        cell: ({ row }) => (
          <Link
            href={`/backend/manufacturing/products/${row.original.id}`}
            className="font-medium text-primary hover:underline"
          >
            {row.original.title || '—'}
          </Link>
        ),
        meta: { truncate: true, maxWidth: 280 },
      },
      {
        accessorKey: 'sku',
        header: t('manufacturing.products.table.sku', 'SKU'),
        cell: ({ row }) => (
          <span className="text-sm">{row.original.sku || '—'}</span>
        ),
        meta: { maxWidth: 140 },
      },
      {
        id: 'procurement_type',
        header: t('manufacturing.products.table.procurementType', 'Procurement'),
        cell: ({ row }) => (
          <ProcurementBadge type={row.original._manufacturing?.procurement_type ?? null} />
        ),
        enableSorting: false,
        meta: { maxWidth: 120 },
      },
      {
        id: 'configuration_type',
        header: t('manufacturing.products.table.configurationType', 'Configuration'),
        cell: ({ row }) => (
          <ConfigBadge type={row.original._manufacturing?.configuration_type ?? null} />
        ),
        enableSorting: false,
        meta: { maxWidth: 120 },
      },
      {
        id: 'production_method_count',
        header: t('manufacturing.products.table.productionMethods', 'Production Methods'),
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original._manufacturing?.production_method_count ?? 0}
          </span>
        ),
        enableSorting: false,
        meta: { maxWidth: 80 },
      },
      {
        id: 'base_uom',
        header: t('manufacturing.products.table.baseUom', 'Base UoM'),
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original._manufacturing?.base_uom_code || '—'}
          </span>
        ),
        enableSorting: false,
        meta: { maxWidth: 80 },
      },
    ],
    [t],
  )

  return (
    <div className="space-y-4">
      <DataTable<ProductRow>
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
            <Button type="button" onClick={() => setPickerOpen(true)}>
              {t('manufacturing.products.actions.addProduct', 'Add Product')}
            </Button>
          ) : undefined
        }
        rowActions={(row) => (
          <RowActions
            items={[
              {
                id: 'edit',
                label: t('manufacturing.products.actions.edit', 'Edit'),
                href: `/backend/manufacturing/products/${row.id}`,
              },
              ...(canEdit
                ? [
                    {
                      id: 'delete',
                      label: t(
                        'manufacturing.products.actions.removeFromManufacturing',
                        'Remove from Manufacturing',
                      ),
                      destructive: true,
                      onSelect: () => handleRemove(row),
                    },
                  ]
                : []),
            ]}
          />
        )}
        rowClickActionIds={['edit']}
      />

      <ProductPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onProductAdded={reload}
      />

      {ConfirmDialogElement}
    </div>
  )
}
