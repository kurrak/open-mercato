'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Ghost,
  Layers,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useListLoader } from '../../../lib/useListLoader'
import { VariantConditionBadges } from './VariantConditionBadges'
import { BomLineVariantsSection } from './BomLineVariantsSection'
import { useCatalogLookup } from '../hooks/useCatalogLookup'
import { useUomLookup } from '../hooks/useUomLookup'
import { useBomLinesByHeader } from '../hooks/useBomLinesByHeader'
import { useBomLineVariants } from '../hooks/useBomLineVariants'
import type { VariantConditionValue } from '../lib/variant-condition-ui'
import {
  buildDisplayRows,
  type LineDisplayRow as GenericLineDisplayRow,
} from '../lib/bom-tree-flatten'

// ---------------------------------------------------------------------------
// Row / display-row types
// ---------------------------------------------------------------------------

export type BomLineRow = {
  id: string
  bom_header_id: string
  // `(string & {})` admits unknown future enum values without collapsing
  // narrowing on the literal members — switches on 'material' / 'semi_product'
  // retain exhaustiveness + typo checks.
  line_type: 'material' | 'semi_product' | (string & {})
  product_id: string | null
  product_variant_id: string | null
  product_resolve_key: string | null
  child_bom_header_id: string | null
  net_quantity: string | number | null
  gross_quantity: string | number | null
  scrap_percentage: string | number
  uom_id: string | null
  variant_condition: unknown
  operation_template_id: string | null
  sort_order: number
  valid_from: string | null
  valid_to: string | null
  is_consumable: boolean
}

type LineDisplayRow = GenericLineDisplayRow<BomLineRow>

export type BomTreeViewProps = {
  // Top-level master product — used as the scope for all variant_condition
  // pills at every depth (master-perspective pattern, see spec b §4).
  productId: string
  // Top-level BomHeader id currently selected.
  bomHeaderId: string
  reloadToken: number
  onReload: () => void
  // When the BomLine CRUD dialog lands, the parent swaps these stubs for
  // the real dialog open.
  onEditLine: (row: BomLineRow) => void
  onAddLine: (bomHeaderId: string) => void
  // Map of child BomHeader id → is_phantom, provided by the BomTab for
  // rendering the phantom flag icon without extra fetches.
  childBomPhantomById: ReadonlyMap<string, boolean>
}

const PAGE_SIZE = 100
const COLUMN_COUNT = 11 // keep in sync with the <th> list below

// ---------------------------------------------------------------------------
// Main component — the flatten pass lives in ../lib/bom-tree-flatten.ts for
// unit-test isolation; see buildDisplayRows.
// ---------------------------------------------------------------------------

export function BomTreeView({
  productId,
  bomHeaderId,
  reloadToken,
  onReload,
  onEditLine,
  onAddLine,
  childBomPhantomById,
}: BomTreeViewProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'bom-tree-view',
  })

  // Invalidate React Query caches for child-lines and per-line variants so
  // nested delete / reorder is reflected without waiting for `staleTime` to
  // expire. Top-level lines are covered by the `useListLoader` reload.
  const invalidateNested = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['manufacturing', 'bom', 'lines-by-header'] })
    queryClient.invalidateQueries({ queryKey: ['manufacturing', 'bom', 'line-variants'] })
  }, [queryClient])

  const [expandedChildrenIds, setExpandedChildrenIds] = React.useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )
  const [expandedVariantsIds, setExpandedVariantsIds] = React.useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )

  // --- Top-level lines load -----------------------------------------------

  const topLevelUrl = React.useMemo(() => {
    const params = new URLSearchParams({
      page: '1',
      pageSize: String(PAGE_SIZE),
      bomHeaderId,
      sortField: 'sortOrder',
      sortDir: 'asc',
    })
    return `/api/bom/bom-line?${params.toString()}`
  }, [bomHeaderId])

  const { rows: topLevelLines, isLoading, hasError } = useListLoader<BomLineRow>({
    url: topLevelUrl,
    reloadKey: String(reloadToken),
    errorMessage: t('bom.tree.error.loadFailed', 'Failed to load BOM lines.'),
  })

  // --- Child lines load (on expand, arbitrary depth) ----------------------
  //
  // Arbitrary-depth recursion is driven by a state-backed set of "header ids
  // we want to fetch". Each render recomputes the desired set from
  // (topLevelLines ∪ already-loaded children) filtered by the user's
  // expansion state; if that differs from the current state, we commit the
  // new set, which triggers the hook to fire additional per-id queries
  // (React Query caches existing entries so previously-loaded levels don't
  // re-fetch). The loop converges in O(depth) renders — once the derived
  // set stops growing, the system is stable.

  const [fetchHeaderIds, setFetchHeaderIds] = React.useState<readonly string[]>([])

  const { linesByHeader: childLinesByHeader, loadingHeaderIds } = useBomLinesByHeader(fetchHeaderIds)

  // Reset the fetch set when the top-level BOM changes — otherwise stale
  // header ids from the previous BOM leak into the new render.
  React.useEffect(() => {
    setFetchHeaderIds([])
  }, [bomHeaderId])

  // Recompute the desired union and commit if it differs. Runs after the
  // hook returns, so `childLinesByHeader` reflects this render's data and
  // next render's derived set will include grandchildren.
  React.useEffect(() => {
    const desired = new Set<string>()
    const visit = (line: BomLineRow) => {
      if (expandedChildrenIds.has(line.id) && line.child_bom_header_id) {
        desired.add(line.child_bom_header_id)
      }
    }
    topLevelLines.forEach(visit)
    for (const lines of childLinesByHeader.values()) {
      lines.forEach(visit)
    }
    const sorted = Array.from(desired).sort()
    const current = [...fetchHeaderIds]
    const changed =
      sorted.length !== current.length ||
      sorted.some((id, i) => id !== current[i])
    if (changed) setFetchHeaderIds(sorted)
  }, [topLevelLines, childLinesByHeader, expandedChildrenIds, fetchHeaderIds])

  // --- Display-row flatten -------------------------------------------------

  const displayRows = React.useMemo(
    () =>
      buildDisplayRows({
        topLevelHeaderId: bomHeaderId,
        topLevelLines,
        childLinesByHeader,
        expandedChildrenIds,
        expandedVariantsIds,
      }),
    [bomHeaderId, topLevelLines, childLinesByHeader, expandedChildrenIds, expandedVariantsIds],
  )

  // Derive the rendered-line list from `displayRows` inside useMemo so
  // downstream memos (productIds / variantIds / uomIds / lineIds) don't
  // recompute on every render (identity-stable input).
  const allRenderedLines = React.useMemo(
    () =>
      displayRows
        .filter((r): r is LineDisplayRow => r.type === 'line')
        .map((r) => r.line),
    [displayRows],
  )

  // --- Cross-cutting lookups ----------------------------------------------

  const productIds = React.useMemo(
    () => allRenderedLines.map((l) => l.product_id).filter((id): id is string => typeof id === 'string'),
    [allRenderedLines],
  )
  const variantIds = React.useMemo(
    () => allRenderedLines.map((l) => l.product_variant_id).filter((id): id is string => typeof id === 'string'),
    [allRenderedLines],
  )
  const uomIds = React.useMemo(
    () => allRenderedLines.map((l) => l.uom_id).filter((id): id is string => typeof id === 'string'),
    [allRenderedLines],
  )
  const lineIds = React.useMemo(() => allRenderedLines.map((l) => l.id), [allRenderedLines])

  const { productsById, variantsById } = useCatalogLookup(productIds, variantIds)
  const uomsById = useUomLookup(uomIds)
  const { variantsByLineId, countsByLineId } = useBomLineVariants(lineIds)

  // --- Handlers -----------------------------------------------------------

  const toggleChildren = React.useCallback((lineId: string) => {
    setExpandedChildrenIds((prev) => {
      const next = new Set(prev)
      if (next.has(lineId)) next.delete(lineId)
      else next.add(lineId)
      return next
    })
  }, [])

  const toggleVariants = React.useCallback((lineId: string) => {
    setExpandedVariantsIds((prev) => {
      const next = new Set(prev)
      if (next.has(lineId)) next.delete(lineId)
      else next.add(lineId)
      return next
    })
  }, [])

  const handleDelete = React.useCallback(
    async (row: BomLineRow) => {
      const ok = await confirm({
        title: t('bom.tree.deleteConfirm.title', 'Delete BOM line?'),
        text: t(
          'bom.tree.deleteConfirm.text',
          'This line will be soft-deleted and will no longer participate in explosion or where-used queries.',
        ),
        confirmText: t('bom.tree.deleteConfirm.confirm', 'Delete'),
        variant: 'destructive',
      })
      if (!ok) return
      try {
        await runMutation({
          context: { entityId: 'bom:bom_line', operation: 'delete', retryLastMutation },
          operation: async () => {
            await deleteCrud('bom/bom-line', row.id)
            flash(t('bom.tree.deleteSuccess', 'BOM line deleted.'), 'success')
            invalidateNested()
            onReload()
          },
        })
      } catch (err) {
        console.warn('[bom] delete failed', err)
      }
    },
    [confirm, runMutation, retryLastMutation, onReload, invalidateNested, t],
  )

  const handleReorder = React.useCallback(
    async (row: BomLineRow, direction: 'up' | 'down', siblings: readonly BomLineRow[]) => {
      const index = siblings.findIndex((r) => r.id === row.id)
      if (index < 0) return
      const neighbor = direction === 'up' ? siblings[index - 1] : siblings[index + 1]
      if (!neighbor) return
      try {
        await runMutation({
          context: { entityId: 'bom:bom_line', operation: 'update', retryLastMutation },
          operation: async () => {
            const mySort = row.sort_order
            const theirSort = neighbor.sort_order
            if (mySort === theirSort) {
              await updateCrud('bom/bom-line', {
                id: neighbor.id,
                sortOrder: theirSort + (direction === 'up' ? 1 : -1),
              })
              await updateCrud('bom/bom-line', { id: row.id, sortOrder: theirSort })
            } else {
              await Promise.all([
                updateCrud('bom/bom-line', { id: row.id, sortOrder: theirSort }),
                updateCrud('bom/bom-line', { id: neighbor.id, sortOrder: mySort }),
              ])
            }
            invalidateNested()
            onReload()
          },
        })
      } catch (err) {
        console.warn('[bom] reorder failed', err)
        flash(t('bom.tree.reorder.error', 'Failed to reorder BOM lines.'), 'error')
      }
    },
    [runMutation, retryLastMutation, onReload, invalidateNested, t],
  )

  // --- Render --------------------------------------------------------------

  if (isLoading) {
    return <LoadingMessage label={t('bom.tree.loading', 'Loading BOM lines…')} />
  }

  if (hasError) {
    return <p className="text-sm text-destructive">{t('bom.tree.error.loadFailed', 'Failed to load BOM lines.')}</p>
  }

  if (topLevelLines.length === 0) {
    // Empty top-level header → tree renders its single "+ Add first line"
    // pseudo-row directly, no header chrome. Keeps the affordance visible.
    return (
      <>
        <div className="overflow-hidden rounded-md border">
          <table className="w-full">
            <TreeTableHeader />
            <tbody>
              <AddLineRow
                depth={0}
                isEmpty
                bomHeaderId={bomHeaderId}
                onAdd={onAddLine}
              />
            </tbody>
          </table>
        </div>
        {ConfirmDialogElement}
      </>
    )
  }

  return (
    <>
      {/*
        Intentional deviation from the packages/ui DataTable default: we render
        raw <table> markup because the tree needs two orthogonal expansion
        kinds (children drill-in + variants inline detail row) plus depth-
        based indentation, and DataTable has no native subRows/expanded-row
        story. Keep this as-is; "fixing" to DataTable would lose semantics.
      */}
      <div className="overflow-hidden rounded-md border">
        <table className="w-full">
          <TreeTableHeader />
          <tbody>
            {displayRows.map((row) => {
              if (row.type === 'line') {
                return (
                  <BomLineTableRow
                    key={`line:${row.line.id}`}
                    row={row}
                    masterProductId={productId}
                    productsById={productsById}
                    variantsById={variantsById}
                    uomsById={uomsById}
                    childBomPhantomById={childBomPhantomById}
                    variantsCount={countsByLineId.get(row.line.id) ?? 0}
                    isChildrenExpanded={expandedChildrenIds.has(row.line.id)}
                    isVariantsExpanded={expandedVariantsIds.has(row.line.id)}
                    isChildrenLoading={
                      !!row.line.child_bom_header_id &&
                      loadingHeaderIds.has(row.line.child_bom_header_id)
                    }
                    onToggleChildren={() => toggleChildren(row.line.id)}
                    onToggleVariants={() => toggleVariants(row.line.id)}
                    onEdit={() => onEditLine(row.line)}
                    onDelete={() => handleDelete(row.line)}
                    onReorder={(direction) => {
                      const siblings =
                        row.bomHeaderId === bomHeaderId
                          ? topLevelLines
                          : childLinesByHeader.get(row.bomHeaderId) ?? []
                      return handleReorder(row.line, direction, siblings)
                    }}
                  />
                )
              }
              if (row.type === 'variants') {
                return (
                  <tr key={`variants:${row.line.id}`} className="bg-muted/5">
                    <td colSpan={COLUMN_COUNT} className="p-3">
                      <div style={{ marginLeft: `${row.depth * 16 + 32}px` }}>
                        <BomLineVariantsSection
                          variants={variantsByLineId.get(row.line.id) ?? []}
                          masterProductId={productId}
                          onReload={onReload}
                        />
                      </div>
                    </td>
                  </tr>
                )
              }
              return (
                <AddLineRow
                  key={`add:${row.bomHeaderId}`}
                  depth={row.depth}
                  isEmpty={row.isEmptyHeader}
                  bomHeaderId={row.bomHeaderId}
                  onAdd={onAddLine}
                />
              )
            })}
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

function TreeTableHeader() {
  const t = useT()
  return (
    <thead className="border-b bg-muted/30">
      <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <th className="w-10 px-2 py-2" aria-label={t('bom.tree.col.expand', 'Expand')} />
        <th className="px-3 py-2 text-left">{t('bom.tree.col.product', 'Product')}</th>
        <th className="px-3 py-2 text-left">{t('bom.tree.col.lineType', 'Type')}</th>
        <th className="px-3 py-2 text-left">{t('bom.tree.col.quantity', 'Qty')}</th>
        <th className="px-3 py-2 text-left">{t('bom.tree.col.uom', 'UoM')}</th>
        <th className="px-3 py-2 text-left">{t('bom.tree.col.scrap', 'Scrap %')}</th>
        <th className="px-3 py-2 text-left">{t('bom.tree.col.variantCondition', 'Variant condition')}</th>
        <th className="px-3 py-2 text-left">{t('bom.tree.col.dateRange', 'Effective')}</th>
        <th className="px-3 py-2 text-left">{t('bom.tree.col.flags', 'Flags')}</th>
        <th className="w-36 px-3 py-2 text-left">{t('bom.tree.col.variants', 'Variants')}</th>
        <th className="w-40 px-3 py-2 text-right">{t('bom.tree.col.actions', '')}</th>
      </tr>
    </thead>
  )
}

// ---------------------------------------------------------------------------
// Line row
// ---------------------------------------------------------------------------

type BomLineTableRowProps = {
  row: LineDisplayRow
  masterProductId: string
  productsById: ReadonlyMap<string, { title: string }>
  variantsById: ReadonlyMap<string, { name: string; productId: string }>
  uomsById: ReadonlyMap<string, { code: string; name: string }>
  childBomPhantomById: ReadonlyMap<string, boolean>
  variantsCount: number
  isChildrenExpanded: boolean
  isVariantsExpanded: boolean
  isChildrenLoading: boolean
  onToggleChildren: () => void
  onToggleVariants: () => void
  onEdit: () => void
  onDelete: () => void
  onReorder: (direction: 'up' | 'down') => void
}

function BomLineTableRow({
  row,
  masterProductId,
  productsById,
  variantsById,
  uomsById,
  childBomPhantomById,
  variantsCount,
  isChildrenExpanded,
  isVariantsExpanded,
  isChildrenLoading,
  onToggleChildren,
  onToggleVariants,
  onEdit,
  onDelete,
  onReorder,
}: BomLineTableRowProps) {
  const t = useT()
  const { line, depth, cycle, isFirst, isLast } = row

  const canExpandChildren = line.line_type === 'semi_product' && !!line.child_bom_header_id
  const uom = line.uom_id ? uomsById.get(line.uom_id) : null

  return (
    <tr className="border-b hover:bg-muted/10">
      {/* 1. Expand (children) */}
      <td className="w-10 px-2 py-2 align-middle">
        {canExpandChildren ? (
          cycle ? (
            <SimpleTooltip content={t('bom.tree.cycle.tooltip', 'Cycle detected — this sub-assembly appears earlier in the tree.')}>
              <span className="inline-flex size-6 items-center justify-center text-muted-foreground/50 cursor-help">
                <RotateCcw className="size-4" />
              </span>
            </SimpleTooltip>
          ) : (
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={onToggleChildren}
              aria-label={isChildrenExpanded ? t('bom.tree.collapseChildren', 'Collapse') : t('bom.tree.expandChildren', 'Expand')}
              aria-expanded={isChildrenExpanded}
            >
              {isChildrenLoading ? (
                <Spinner className="size-3" />
              ) : isChildrenExpanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </IconButton>
          )
        ) : null}
      </td>

      {/* 2. Product */}
      <td className="px-3 py-2 align-middle" style={{ paddingLeft: `${depth * 16 + 12}px` }}>
        <ProductCell line={line} productsById={productsById} variantsById={variantsById} />
      </td>

      {/* 3. Line type */}
      <td className="px-3 py-2 align-middle">
        <Badge variant={line.line_type === 'semi_product' ? 'secondary' : 'outline'}>
          {line.line_type === 'semi_product'
            ? t('bom.tree.lineType.semi_product', 'Sub-assembly')
            : t('bom.tree.lineType.material', 'Material')}
        </Badge>
      </td>

      {/* 4. Quantity */}
      <td className="px-3 py-2 align-middle text-sm">
        <QuantityCell line={line} />
      </td>

      {/* 5. UoM */}
      <td className="px-3 py-2 align-middle text-sm">{uom?.code ?? '—'}</td>

      {/* 6. Scrap % */}
      <td className="px-3 py-2 align-middle text-sm">
        {formatScrap(line.scrap_percentage)}
      </td>

      {/* 7. Variant condition — master-perspective scope (productId is the
          top-level master, not the child header's owning product). */}
      <td className="px-3 py-2 align-middle">
        <VariantConditionBadges
          value={line.variant_condition as VariantConditionValue}
          productId={masterProductId}
          compact
        />
      </td>

      {/* 8. Effective date range */}
      <td className="px-3 py-2 align-middle text-sm">
        <DateRangeCell line={line} />
      </td>

      {/* 9. Flags — consumable C + phantom ghost */}
      <td className="px-3 py-2 align-middle">
        <FlagsCell line={line} childBomPhantomById={childBomPhantomById} />
      </td>

      {/* 10. Variants column — count pill (None / N) + expand toggle.
          Adding a variant happens from inside the expanded section so that
          this column is a single uniform affordance regardless of count. */}
      <td className="w-36 px-3 py-2 align-middle">
        <button
          type="button"
          onClick={onToggleVariants}
          className="inline-flex items-center gap-1 rounded hover:bg-muted/40"
          aria-label={
            isVariantsExpanded
              ? t('bom.tree.variants.collapse', 'Collapse overrides')
              : t('bom.tree.variants.expand', 'Show overrides')
          }
          aria-expanded={isVariantsExpanded}
        >
          <Badge
            variant={variantsCount > 0 ? 'secondary' : 'muted'}
            className="h-5 min-w-[2.25rem] justify-center px-1.5 text-xs"
          >
            {variantsCount > 0 ? variantsCount : t('bom.tree.variants.none', 'None')}
          </Badge>
          {isVariantsExpanded ? (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground" />
          )}
        </button>
      </td>

      {/* 11. Row actions — reorder + edit + delete */}
      <td className="w-40 px-3 py-2 align-middle">
        <div className="flex items-center justify-end gap-0.5">
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onReorder('up')}
            disabled={isFirst}
            aria-label={t('bom.tree.action.moveUp', 'Move up')}
          >
            <ArrowUp className="size-4" />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onReorder('down')}
            disabled={isLast}
            aria-label={t('bom.tree.action.moveDown', 'Move down')}
          >
            <ArrowDown className="size-4" />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={onEdit}
            aria-label={t('bom.tree.action.edit', 'Edit')}
          >
            <Pencil className="size-4" />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            aria-label={t('bom.tree.action.delete', 'Delete')}
          >
            <Trash2 className="size-4 text-red-600" />
          </IconButton>
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Add-line pseudo-row
// ---------------------------------------------------------------------------

function AddLineRow({
  depth,
  isEmpty,
  bomHeaderId,
  onAdd,
}: {
  depth: number
  isEmpty: boolean
  bomHeaderId: string
  onAdd: (bomHeaderId: string) => void
}) {
  const t = useT()
  return (
    <tr className="border-b border-dashed bg-muted/5 hover:bg-muted/10">
      <td className="w-10 px-2 py-2" />
      <td
        className="px-3 py-2"
        colSpan={COLUMN_COUNT - 1}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
      >
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          onClick={() => onAdd(bomHeaderId)}
        >
          <Plus className="size-4" />
          {isEmpty
            ? t('bom.tree.addLine.firstCta', 'Add first line')
            : t('bom.tree.addLine.cta', 'Add line')}
        </button>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Cell renderers
// ---------------------------------------------------------------------------

function ProductCell({
  line,
  productsById,
  variantsById,
}: {
  line: BomLineRow
  productsById: ReadonlyMap<string, { title: string }>
  variantsById: ReadonlyMap<string, { name: string; productId: string }>
}) {
  const t = useT()
  if (line.product_resolve_key) {
    return (
      <Badge variant="secondary" className="inline-flex items-center gap-1">
        <Layers className="size-3" />⟶ {line.product_resolve_key}
      </Badge>
    )
  }
  if (!line.product_id) {
    return (
      <SimpleTooltip content={t('bom.tree.product.noneTooltip', 'This line has no product selected — edit to assign one.')}>
        <span className="inline-flex cursor-help items-center gap-1 text-sm text-amber-600">
          <AlertCircle className="size-4" />
          {t('bom.tree.product.none', 'Product not selected')}
        </span>
      </SimpleTooltip>
    )
  }
  const product = productsById.get(line.product_id)
  const variant = line.product_variant_id ? variantsById.get(line.product_variant_id) : null
  return (
    <Link
      href={`/backend/catalog/products/${line.product_id}`}
      className="text-sm text-primary hover:underline"
    >
      {product?.title ?? line.product_id}
      {variant ? ` / ${variant.name}` : ''}
    </Link>
  )
}

function QuantityCell({ line }: { line: BomLineRow }) {
  const net = line.net_quantity != null ? String(line.net_quantity) : null
  const gross = line.gross_quantity != null ? String(line.gross_quantity) : null
  if (!net && !gross) return <span className="text-muted-foreground">—</span>
  if (net && gross && net !== gross) return <span>{net} <span className="text-muted-foreground">({gross})</span></span>
  return <span>{net ?? gross}</span>
}

function DateRangeCell({ line }: { line: BomLineRow }) {
  const t = useT()
  if (!line.valid_from && !line.valid_to) {
    return <span className="text-muted-foreground">{t('bom.tree.date.always', 'Always')}</span>
  }
  const from = line.valid_from ? line.valid_from.slice(0, 10) : '—'
  const to = line.valid_to ? line.valid_to.slice(0, 10) : '—'
  return <span>{from} – {to}</span>
}

function FlagsCell({
  line,
  childBomPhantomById,
}: {
  line: BomLineRow
  childBomPhantomById: ReadonlyMap<string, boolean>
}) {
  const t = useT()
  const isPhantomChild =
    line.line_type === 'semi_product' &&
    !!line.child_bom_header_id &&
    childBomPhantomById.get(line.child_bom_header_id) === true
  return (
    <div className="flex items-center gap-1.5">
      {line.is_consumable ? (
        <SimpleTooltip content={t('bom.tree.flag.consumable', 'Consumable material — shared across operations')}>
          <Badge variant="outline" className="h-5 cursor-help px-1.5 text-xs">C</Badge>
        </SimpleTooltip>
      ) : null}
      {isPhantomChild ? (
        <SimpleTooltip content={t('bom.tree.flag.phantom', 'Phantom sub-assembly — components float up on explosion')}>
          <Ghost className="size-4 text-muted-foreground cursor-help" />
        </SimpleTooltip>
      ) : null}
    </div>
  )
}

function formatScrap(value: string | number): string {
  const pct = Number(value ?? 0)
  return `${pct.toFixed(2).replace(/\.?0+$/, '')}%`
}

