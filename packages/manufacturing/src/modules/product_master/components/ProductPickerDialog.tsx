'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useListLoader } from '../../../lib/useListLoader'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'

type CatalogProduct = {
  id: string
  title: string
  sku?: string | null
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onProductAdded: () => void
}

const PAGE_SIZE = 25

export default function ProductPickerDialog({ open, onOpenChange, onProductAdded }: Props) {
  const t = useT()
  const router = useRouter()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'manufacturing-product-picker',
  })
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [isCreating, setIsCreating] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setPage(1)
      setSearch('')
    }
  }, [open])

  const url = React.useMemo(() => {
    const params = new URLSearchParams({
      enrolled: 'false',
      page: String(page),
      pageSize: String(PAGE_SIZE),
    })
    if (search.trim()) params.set('search', search.trim())
    return `/api/product_master/manufacturing/catalog-products?${params.toString()}`
  }, [page, search])

  const { rows, total, totalPages, isLoading } = useListLoader<CatalogProduct>({
    url,
    enabled: open,
    errorMessage: t('manufacturing.common.error', 'An error occurred'),
  })

  const handleSelect = React.useCallback(
    async (product: CatalogProduct) => {
      if (isCreating) return
      setIsCreating(true)
      try {
        await runMutation({
          operation: () => createCrud('product_master/manufacturing/product-manufacturing-extension', {
            productId: product.id,
            procurementType: 'make',
            configurationType: 'none',
          }),
          context: {
            formId: 'manufacturing-product-picker',
            productId: product.id,
            retryLastMutation,
          },
        })
        flash(t('manufacturing.products.flash.added', 'Product added to manufacturing'), 'success')
        onOpenChange(false)
        onProductAdded()
        router.push(`/backend/manufacturing/products/${product.id}`)
      } catch {
        flash(t('manufacturing.products.flash.addError', 'Failed to add product to manufacturing'), 'error')
      } finally {
        setIsCreating(false)
      }
    },
    [isCreating, onOpenChange, onProductAdded, retryLastMutation, router, runMutation, t],
  )

  const columns = React.useMemo<ColumnDef<CatalogProduct>[]>(
    () => [
      {
        accessorKey: 'title',
        header: t('manufacturing.products.table.productName', 'Product'),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.title || '—'}</span>
        ),
      },
      {
        accessorKey: 'sku',
        header: t('manufacturing.products.table.sku', 'SKU'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.sku || '—'}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        size: 100,
        cell: ({ row }) => (
          <Button
            type="button"
            size="sm"
            onClick={() => handleSelect(row.original)}
            disabled={isCreating}
          >
            {t('manufacturing.products.picker.select', 'Select')}
          </Button>
        ),
      },
    ],
    [handleSelect, isCreating, t],
  )

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setSearch('')
        setPage(1)
      }
      onOpenChange(nextOpen)
    },
    [onOpenChange],
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('manufacturing.products.picker.title', 'Add Product to Manufacturing')}
          </DialogTitle>
        </DialogHeader>

        {isCreating ? (
          <LoadingMessage label={t('manufacturing.common.loading', 'Loading...')} />
        ) : (
          <DataTable<CatalogProduct>
            columns={columns}
            data={rows}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder={t('manufacturing.products.picker.search', 'Search products...')}
            isLoading={isLoading}
            pagination={{
              page,
              pageSize: PAGE_SIZE,
              total,
              totalPages,
              onPageChange: setPage,
            }}
            emptyState={
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t(
                  'manufacturing.products.picker.empty',
                  'No products available. All catalog products are already enabled for manufacturing.',
                )}
              </p>
            }
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
