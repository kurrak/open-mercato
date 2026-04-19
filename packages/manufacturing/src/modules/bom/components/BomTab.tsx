'use client'

import * as React from 'react'
import { Plus, Trash2, Calculator } from 'lucide-react'
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
import { useListLoader } from '../../../lib/useListLoader'
import { BomHeaderSelector, type BomHeaderOption } from './BomHeaderSelector'
import { BomTreeView, type BomLineRow } from './BomTreeView'
import { BomLineDialog } from './BomLineDialog'
import { BomExplosionPanel } from './BomExplosionPanel'
import {
  BOM_HEADER_DEFAULT_VALUES,
  buildBomHeaderFormFields,
  buildBomHeaderFormGroups,
  type BomHeaderFormValues,
} from './BomHeaderFormConfig'

type BomHeaderListRow = {
  id: string
  name: string
  bom_usage: string
  is_active: boolean
  is_phantom: boolean
}

const PAGE_SIZE = 100

// The explosion panel (§7) needs the product's manufacturing extension to
// pick its input mode (none / variant_based / rule_based). The parent page
// always has the extension loaded before rendering this tab, so extension
// is non-optional.
export type BomTabExtension = {
  id: string
  productId: string
  configurationType: string
  procurementType: string
  baseUomId: string | null
  isPhantomDefault: boolean
}

export type BomTabProps = {
  productId: string
  extension: BomTabExtension
}

export default function BomTab({ productId, extension }: BomTabProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'bom-tab',
  })

  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  // One-shot counter keyed into BomExplosionPanel to force a fresh mount on
  // each dialog open — wipes any lingering result / picked inputs from a
  // previous explode so the user starts clean.
  const [explosionDialogOpen, setExplosionDialogOpen] = React.useState(false)
  const [explosionDialogKey, setExplosionDialogKey] = React.useState(0)

  const reload = React.useCallback(() => setReloadToken((n) => n + 1), [])

  const headersUrl = React.useMemo(() => {
    const params = new URLSearchParams({
      page: '1',
      pageSize: String(PAGE_SIZE),
      productId,
      sortField: 'createdAt',
      sortDir: 'asc',
    })
    return `/api/bom/bom?${params.toString()}`
  }, [productId])

  const { rows: headerRows, isLoading: headersLoading, hasError: headersError } =
    useListLoader<BomHeaderListRow>({
      url: headersUrl,
      reloadKey: String(reloadToken),
      errorMessage: t('bom.tab.error.loadHeaders', 'Failed to load BOMs.'),
    })

  const headers = React.useMemo<BomHeaderOption[]>(
    () =>
      headerRows.map((h) => ({
        id: h.id,
        name: h.name,
        bomUsage: h.bom_usage,
        isActive: h.is_active,
      })),
    [headerRows],
  )

  // Default selection = first active header (falls back to the first
  // header if none are active). Keeps the current pick if still present.
  // The explosion panel handles snapshot-aware PM resolution independently
  // of this selector.
  React.useEffect(() => {
    if (selectedId && headers.some((h) => h.id === selectedId)) return
    const firstActive = headers.find((h) => h.isActive)
    setSelectedId(firstActive?.id ?? headers[0]?.id ?? null)
  }, [headers, selectedId])

  // Map child BomHeader id → is_phantom for the tree-row flags column.
  // Already-loaded via the header list; no extra fetch.
  const childBomPhantomById = React.useMemo(() => {
    const map = new Map<string, boolean>()
    for (const h of headerRows) {
      map.set(h.id, h.is_phantom === true)
    }
    return map
  }, [headerRows])

  const handleCreateBomHeader = React.useCallback(
    async (values: BomHeaderFormValues) => {
      // createCrud throws on failure (via raiseCrudError). On success we
      // close the dialog, select the new BOM, and reload. Failure
      // propagates up to CrudForm so the form can render inline errors.
      const result = await createCrud<{ id?: string }>('bom/bom', {
        ...values,
        productId,
      })
      flash(t('bom.tab.created', 'BOM created.'), 'success')
      setCreateDialogOpen(false)
      const newId = result.result?.id ?? null
      if (newId) setSelectedId(newId)
      reload()
    },
    [productId, reload, t],
  )

  const handleDeleteBom = React.useCallback(async () => {
    if (!selectedId) return
    const current = headers.find((h) => h.id === selectedId)
    const ok = await confirm({
      title: t('bom.tab.deleteConfirm.title', 'Delete this BOM?'),
      text: t(
        'bom.tab.deleteConfirm.text',
        'The BOM "{name}" will be soft-deleted. Its lines remain in the database but are no longer reachable through this tab.',
      ).replace('{name}', current?.name ?? ''),
      confirmText: t('bom.tab.deleteConfirm.confirm', 'Delete BOM'),
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await runMutation({
        context: { entityId: 'bom:bom_header', operation: 'delete', retryLastMutation },
        operation: async () => {
          await deleteCrud('bom/bom', selectedId)
          flash(t('bom.tab.deleteSuccess', 'BOM deleted.'), 'success')
          // Clear child-line and line-variant caches for this BOM's branch
          // so re-selecting a neighbor (or recreating) doesn't surface stale
          // rows left over from the deleted header.
          queryClient.invalidateQueries({ queryKey: ['manufacturing', 'bom', 'lines-by-header'] })
          queryClient.invalidateQueries({ queryKey: ['manufacturing', 'bom', 'line-variants'] })
          // Drop the now-stale selection so the default-selection effect
          // can pick a replacement (or the empty state can render).
          setSelectedId(null)
          reload()
        },
      })
    } catch (err) {
      console.warn('[bom] delete bom header failed', err)
    }
  }, [confirm, runMutation, retryLastMutation, queryClient, selectedId, headers, reload, t])

  // BomLine dialog state — tracks whether open, which header the new/edited
  // line belongs to, and the line being edited (or null for add). Kept
  // together so the dialog renders once per tab with the right props for
  // both flows.
  const [lineDialogState, setLineDialogState] = React.useState<
    | { mode: 'add'; bomHeaderId: string }
    | { mode: 'edit'; line: BomLineRow }
    | null
  >(null)

  const handleEditLine = React.useCallback((row: BomLineRow) => {
    setLineDialogState({ mode: 'edit', line: row })
  }, [])

  const handleAddLine = React.useCallback((targetHeaderId: string) => {
    setLineDialogState({ mode: 'add', bomHeaderId: targetHeaderId })
  }, [])

  const handleLineDialogSuccess = React.useCallback(() => {
    setLineDialogState(null)
    reload()
  }, [reload])

  if (headersLoading) {
    return <LoadingMessage label={t('bom.tab.loading', 'Loading BOMs…')} />
  }

  if (headersError) {
    return (
      <div className="p-4">
        <p className="text-sm text-destructive">
          {t('bom.tab.error.loadHeaders', 'Failed to load BOMs.')}
        </p>
      </div>
    )
  }

  // Empty + populated branches share one return so BomHeaderCreateDialog
  // mounts exactly once regardless of whether any BomHeaders exist yet.
  const isEmpty = headers.length === 0

  return (
    <TooltipProvider delayDuration={300}>
    <div className="space-y-4 p-4">
      {isEmpty ? (
        <EmptyState
          title={t('bom.tab.empty.title', 'No bill of materials defined')}
          description={t(
            'bom.tab.empty.description',
            'Create a BOM to start listing materials, sub-assemblies, and variant conditions for this product.',
          )}
          action={{
            label: t('bom.tab.empty.createCta', 'Create BOM'),
            onClick: () => setCreateDialogOpen(true),
            icon: <Plus className="size-4" />,
          }}
        />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">{t('bom.tab.title', 'Bill of Materials')}</h3>
            <div className="flex items-center gap-2">
              {selectedId ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDeleteBom}
                  className="text-red-600"
                >
                  <Trash2 className="size-4" />
                  {t('bom.tab.deleteBom', 'Delete BOM')}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCreateDialogOpen(true)}
              >
                <Plus className="size-4" />
                {t('bom.tab.addBom', 'Add BOM')}
              </Button>
              {selectedId ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    // Fresh panel state per open — see explosionDialogKey.
                    setExplosionDialogKey((n) => n + 1)
                    setExplosionDialogOpen(true)
                  }}
                >
                  <Calculator className="size-4" />
                  {t('bom.tab.explodeBom', 'Explode BOM')}
                </Button>
              ) : null}
            </div>
          </div>

          {headers.length > 1 ? (
            <BomHeaderSelector
              headers={headers}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : null}

          {selectedId ? (
            <BomTreeView
              productId={productId}
              bomHeaderId={selectedId}
              reloadToken={reloadToken}
              onReload={reload}
              onEditLine={handleEditLine}
              onAddLine={handleAddLine}
              childBomPhantomById={childBomPhantomById}
            />
          ) : null}
        </>
      )}

      <BomHeaderCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleCreateBomHeader}
      />

      {selectedId ? (
        <Dialog
          open={explosionDialogOpen}
          onOpenChange={(next) => setExplosionDialogOpen(next)}
        >
          <DialogContent className="sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>{t('bom.tab.explodeDialog.title', 'Explode BOM')}</DialogTitle>
            </DialogHeader>
            <BomExplosionPanel
              key={explosionDialogKey}
              productId={productId}
              bomHeaderId={selectedId}
              extension={extension}
            />
          </DialogContent>
        </Dialog>
      ) : null}

      {lineDialogState ? (
        <BomLineDialog
          open
          onOpenChange={(next) => { if (!next) setLineDialogState(null) }}
          masterProductId={productId}
          bomHeaderId={
            lineDialogState.mode === 'add'
              ? lineDialogState.bomHeaderId
              : lineDialogState.line.bom_header_id
          }
          editingLine={lineDialogState.mode === 'edit' ? lineDialogState.line : null}
          onSuccess={handleLineDialogSuccess}
        />
      ) : null}

      {ConfirmDialogElement}
    </div>
    </TooltipProvider>
  )
}

// ---------------------------------------------------------------------------
// Create dialog — minimal CrudForm for BomHeader. A unified
// "Edit BOM details" + "Add BomLine" surface can be hosted here later when
// the BomLine dialog lands.
// ---------------------------------------------------------------------------

function BomHeaderCreateDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: BomHeaderFormValues) => Promise<void>
}) {
  const t = useT()
  const fields = React.useMemo(() => buildBomHeaderFormFields(t), [t])
  const groups = React.useMemo(() => buildBomHeaderFormGroups(t), [t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg [&_.grid]:!grid-cols-1">
        <DialogHeader>
          <DialogTitle>{t('bom.tab.createDialog.title', 'Create BOM')}</DialogTitle>
        </DialogHeader>
        <CrudForm<BomHeaderFormValues>
          fields={fields}
          groups={groups}
          initialValues={BOM_HEADER_DEFAULT_VALUES}
          submitLabel={t('bom.tab.createDialog.submit', 'Create')}
          embedded
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
