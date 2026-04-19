'use client'

import * as React from 'react'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useFeatureFlag } from '../../../../lib/useFeatureFlag'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Check, Circle, ExternalLink, Plus, Pencil, Trash2, Star } from 'lucide-react'
import { useSubmitShortcut } from '../../../../lib/useSubmitShortcut'
import { DetailSection, Select } from '../../../../lib/components'
import { useIsBomReady } from '../../../bom/hooks/useIsBomReady'
import { useBomHeaderNamesByIds } from '../../../bom/hooks/useBomHeaderNamesByIds'

type ManufacturingExtension = {
  id: string
  productId: string
  configurationType: string
  procurementType: string
  baseUomId?: string | null
  isPhantomDefault: boolean
}

type ProductionMethod = {
  id: string
  name: string
  lifecycleState: string
  isDefault: boolean
  bomHeaderId?: string | null
  routingTemplateId?: string | null
  version: number
}

type UomOption = {
  id: string
  code: string
  name: string
}

type ReadinessItem = {
  label: string
  done: boolean
}

type Props = {
  productId: string
  productTitle: string
  productSku?: string | null
  catalogProductId: string
  extension: ManufacturingExtension
  onExtensionUpdated: () => void
}

export default function OverviewTab({
  productId,
  productTitle,
  productSku,
  catalogProductId,
  extension,
  onExtensionUpdated,
}: Props) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: `manufacturing-overview:${productId}`,
  })

  const [procurementType, setProcurementType] = React.useState(extension.procurementType)
  const [configurationType, setConfigurationType] = React.useState(extension.configurationType)
  const [baseUomId, setBaseUomId] = React.useState(extension.baseUomId ?? '')
  const [isPhantomDefault, setIsPhantomDefault] = React.useState(extension.isPhantomDefault)
  const [isSaving, setIsSaving] = React.useState(false)

  const [uomOptions, setUomOptions] = React.useState<UomOption[]>([])
  const [productionMethods, setProductionMethods] = React.useState<ProductionMethod[]>([])
  const [isLoadingPms, setIsLoadingPms] = React.useState(true)
  const [pmReloadToken, setPmReloadToken] = React.useState(0)
  const [configAttrCount, setConfigAttrCount] = React.useState(0)

  const [pmDialogOpen, setPmDialogOpen] = React.useState(false)
  const [editingPm, setEditingPm] = React.useState<ProductionMethod | null>(null)
  const [pmName, setPmName] = React.useState('')
  const [pmLifecycle, setPmLifecycle] = React.useState('draft')
  const [pmIsSaving, setPmIsSaving] = React.useState(false)
  const canEdit = useFeatureFlag('product_master.edit')

  React.useEffect(() => {
    let cancelled = false
    const loadUoms = async () => {
      // The CRUD list endpoint caps pageSize at 100, so fetch every page in
      // sequence rather than silently truncating tenants with >100 UoMs. The
      // dropdown is a native <select> today (spec note "Base UoM picker is a
      // Select, combobox deferred"), so we need the full list in memory to
      // render it. Follow-up in the same section will replace this with a
      // searchable combobox backed by server-side search.
      const PAGE_SIZE = 100
      const collected: UomOption[] = []
      try {
        for (let page = 1; page <= 50; page += 1) {
          const data = await readApiResultOrThrow<{
            items?: UomOption[]
            totalPages?: number
          }>(
            `/api/product_master/manufacturing/unit-of-measure?pageSize=${PAGE_SIZE}&page=${page}&isActive=true`,
            undefined,
            { errorMessage: '' },
          )
          if (cancelled) return
          const items = Array.isArray(data?.items) ? data.items : []
          collected.push(...items)
          const totalPages = typeof data?.totalPages === 'number' ? data.totalPages : 1
          if (items.length < PAGE_SIZE || page >= totalPages) break
        }
        if (!cancelled) setUomOptions(collected)
      } catch {
        // Non-fatal: the UoM dropdown stays empty, user can still save other fields.
        if (!cancelled) setUomOptions([])
      }
    }
    loadUoms()
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => {
    if (extension.configurationType !== 'rule_based') {
      setConfigAttrCount(0)
      return
    }
    let cancelled = false
    const loadAttrCount = async () => {
      try {
        const data = await readApiResultOrThrow<{ total?: number }>(
          `/api/configurator/manufacturing/config-attribute?productId=${productId}&pageSize=1`,
          undefined,
          { errorMessage: '' },
        )
        if (!cancelled) setConfigAttrCount(data?.total ?? 0)
      } catch {
        // Non-fatal: readiness checklist will show "0 attributes" which is the correct
        // fallback when we cannot determine the count.
        if (!cancelled) setConfigAttrCount(0)
      }
    }
    loadAttrCount()
    return () => { cancelled = true }
  }, [productId, extension.configurationType])

  React.useEffect(() => {
    let cancelled = false
    const loadPms = async () => {
      setIsLoadingPms(true)
      try {
        const data = await readApiResultOrThrow<{ items?: ProductionMethod[] }>(
          `/api/product_master/manufacturing/production-method?productId=${productId}&pageSize=100`,
          undefined,
          { errorMessage: '' },
        )
        if (!cancelled) setProductionMethods(data?.items ?? [])
      } catch (err) {
        if (cancelled) return
        setProductionMethods([])
        const message = err instanceof Error && err.message
          ? err.message
          : t('manufacturing.common.error', 'An error occurred')
        flash(message, 'error')
      } finally {
        if (!cancelled) setIsLoadingPms(false)
      }
    }
    loadPms()
    return () => { cancelled = true }
  }, [productId, pmReloadToken, t])

  const handleSaveSettings = React.useCallback(async () => {
    const payload: Record<string, unknown> = { id: extension.id }
    if (procurementType !== extension.procurementType) payload.procurementType = procurementType
    if (configurationType !== extension.configurationType) payload.configurationType = configurationType
    if (baseUomId !== (extension.baseUomId ?? '')) payload.baseUomId = baseUomId
    if (isPhantomDefault !== extension.isPhantomDefault) payload.isPhantomDefault = isPhantomDefault
    if (Object.keys(payload).length === 1) {
      flash(t('manufacturing.products.overview.flash.saved', 'Manufacturing settings saved'), 'success')
      return
    }
    setIsSaving(true)
    try {
      await runMutation({
        operation: () => updateCrud('product_master/manufacturing/product-manufacturing-extension', payload),
        context: {
          formId: `manufacturing-overview:${productId}`,
          productId,
          retryLastMutation,
        },
      })
      flash(t('manufacturing.products.overview.flash.saved', 'Manufacturing settings saved'), 'success')
      onExtensionUpdated()
    } catch {
      flash(t('manufacturing.products.overview.flash.saveError', 'Failed to save manufacturing settings'), 'error')
    } finally {
      setIsSaving(false)
    }
  }, [baseUomId, configurationType, extension, isPhantomDefault, onExtensionUpdated, procurementType, productId, retryLastMutation, runMutation, t])

  const openCreatePm = React.useCallback(() => {
    setEditingPm(null)
    setPmName('')
    setPmLifecycle('draft')
    setPmDialogOpen(true)
  }, [])

  const openEditPm = React.useCallback((pm: ProductionMethod) => {
    setEditingPm(pm)
    setPmName(pm.name)
    setPmLifecycle(pm.lifecycleState)
    setPmDialogOpen(true)
  }, [])

  const handleSavePm = React.useCallback(async () => {
    if (!pmName.trim()) return
    setPmIsSaving(true)
    try {
      if (editingPm) {
        await runMutation({
          operation: () =>
            updateCrud('product_master/manufacturing/production-method', {
              id: editingPm.id,
              name: pmName.trim(),
              lifecycleState: pmLifecycle,
              bomHeaderId: editingPm.bomHeaderId ?? null,
              routingTemplateId: editingPm.routingTemplateId ?? null,
            }),
          context: {
            formId: `manufacturing-pm:${editingPm.id}`,
            productId,
            retryLastMutation,
          },
        })
        flash(t('manufacturing.products.overview.productionMethods.flash.updated', 'Production method updated'), 'success')
      } else {
        await runMutation({
          operation: () => createCrud('product_master/manufacturing/production-method', { productId, name: pmName.trim(), lifecycleState: pmLifecycle }),
          context: {
            formId: `manufacturing-pm:new`,
            productId,
            retryLastMutation,
          },
        })
        flash(t('manufacturing.products.overview.productionMethods.flash.created', 'Production method created'), 'success')
      }
      setPmDialogOpen(false)
      setPmReloadToken((n) => n + 1)
    } catch {
      flash(
        t(
          'manufacturing.products.overview.productionMethods.flash.saveError',
          'Failed to save production method',
        ),
        'error',
      )
    } finally {
      setPmIsSaving(false)
    }
  }, [editingPm, pmLifecycle, pmName, productId, retryLastMutation, runMutation, t])

  const handleDeletePm = React.useCallback(
    async (pm: ProductionMethod) => {
      const confirmed = await confirm({
        title: t(
          'manufacturing.products.overview.productionMethods.deleteConfirm.title',
          'Delete production method?',
        ),
        text: t(
          'manufacturing.products.overview.productionMethods.deleteConfirm.text',
          'Production method "{name}" will be permanently deleted.',
        ).replace('{name}', pm.name),
        variant: 'destructive',
        confirmText: t('manufacturing.common.actions.delete', 'Delete'),
      })
      if (!confirmed) return
      try {
        await runMutation({
          operation: () => deleteCrud('product_master/manufacturing/production-method', pm.id),
          context: {
            formId: `manufacturing-pm:${pm.id}`,
            productId,
            retryLastMutation,
          },
        })
        flash(t('manufacturing.products.overview.productionMethods.flash.deleted', 'Production method deleted'), 'success')
        setPmReloadToken((n) => n + 1)
      } catch {
        flash(
          t(
            'manufacturing.products.overview.productionMethods.flash.deleteError',
            'Failed to delete production method',
          ),
          'error',
        )
      }
    },
    [confirm, productId, retryLastMutation, runMutation, t],
  )

  const handleSetDefault = React.useCallback(
    async (pm: ProductionMethod) => {
      try {
        await runMutation({
          operation: () => updateCrud('product_master/manufacturing/production-method', { id: pm.id, isDefault: true }),
          context: {
            formId: `manufacturing-pm:${pm.id}`,
            productId,
            retryLastMutation,
          },
        })
        flash(t('manufacturing.products.overview.productionMethods.flash.defaultSet', 'Default production method updated'), 'success')
        setPmReloadToken((n) => n + 1)
      } catch {
        flash(
          t(
            'manufacturing.products.overview.productionMethods.flash.setDefaultError',
            'Failed to set default production method',
          ),
          'error',
        )
      }
    },
    [productId, retryLastMutation, runMutation, t],
  )

  const handlePmShortcut = useSubmitShortcut(handleSavePm)

  const selectedUom = uomOptions.find((u) => u.id === baseUomId)
  const activePms = productionMethods.filter((pm) => pm.lifecycleState === 'active')
  // spec b §Readiness checklist integration — "ready" now requires at least
  // one non-deleted BomLine under some active BomHeader, not just a
  // PM-linked BomHeader. Brief false-positive flash on first render (hook
  // starts false while fetching) is acceptable; planning consumers
  // downstream depend on the stricter definition.
  const hasBom = useIsBomReady(productId)
  const hasRouting = productionMethods.some((pm) => pm.routingTemplateId != null)

  // Batch-resolve the PM-linked BomHeader names so each PM card shows the
  // specific BOM it references (rather than every card showing the same
  // "primary" name). Identity-stable ids memo so the hook's React Query
  // cache key is stable across renders.
  const pmBomHeaderIds = React.useMemo(
    () =>
      productionMethods
        .map((pm) => pm.bomHeaderId)
        .filter((id): id is string => typeof id === 'string'),
    [productionMethods],
  )
  const bomHeaderNamesById = useBomHeaderNamesByIds(pmBomHeaderIds)

  const readiness: ReadinessItem[] = [
    { label: t('manufacturing.products.overview.readiness.manufacturingEnabled', 'Manufacturing enabled'), done: true },
    {
      label: selectedUom
        ? t('manufacturing.products.overview.readiness.baseUomSet', 'Base UoM set: {code}').replace('{code}', selectedUom.code)
        : t('manufacturing.products.overview.readiness.baseUomMissing', 'Base UoM not set'),
      done: !!selectedUom,
    },
    {
      label: activePms.length > 0
        ? t('manufacturing.products.overview.readiness.productionMethods', '{count} production method(s) (active)').replace('{count}', String(activePms.length))
        : t('manufacturing.products.overview.readiness.productionMethodsMissing', 'No production methods'),
      done: activePms.length > 0,
    },
    {
      label: hasBom
        ? t('manufacturing.products.overview.readiness.bomLinked', 'BOM linked')
        : t('manufacturing.products.overview.readiness.bomMissing', 'BOM not defined'),
      done: hasBom,
    },
    {
      label: hasRouting
        ? t('manufacturing.products.overview.readiness.routingDefined', 'Routing defined')
        : t('manufacturing.products.overview.readiness.routingMissing', 'Routing not linked'),
      done: hasRouting,
    },
    {
      label: configAttrCount > 0
        ? t('manufacturing.products.overview.readiness.configuratorDefined', 'Configurator: {count} attributes').replace('{count}', String(configAttrCount))
        : t('manufacturing.products.overview.readiness.configuratorMissing', 'Configurator: 0 attributes'),
      done: configAttrCount > 0,
    },
  ]

  const lifecycleLabels = React.useMemo<Record<string, string>>(
    () => ({
      draft: t('manufacturing.enum.lifecycle.draft', 'Draft'),
      active: t('manufacturing.enum.lifecycle.active', 'Active'),
      superseded: t('manufacturing.enum.lifecycle.superseded', 'Superseded'),
      archived: t('manufacturing.enum.lifecycle.archived', 'Archived'),
    }),
    [t],
  )

  return (
    <div className="space-y-6">
      <DetailSection
        variant="muted"
        title={t('manufacturing.products.overview.identity.title', 'Product Identity')}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-semibold">{productTitle}</p>
            {productSku && (
              <p className="text-sm text-muted-foreground">
                {t('manufacturing.products.overview.skuLabel', 'SKU')}: {productSku}
              </p>
            )}
          </div>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={`/backend/catalog/products/${catalogProductId}`}>
              <ExternalLink className="mr-1 size-3" />
              {t('manufacturing.products.detail.editInCatalog', 'Edit in Catalog')}
            </Link>
          </Button>
        </div>
      </DetailSection>

      <DetailSection
        title={t('manufacturing.products.overview.fields.title', 'Manufacturing Settings')}
        contentClassName="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('manufacturing.products.overview.fields.procurementType', 'Procurement Type')}</Label>
            <Select
              value={procurementType}
              onChange={(e) => setProcurementType(e.target.value)}
              disabled={!canEdit}
            >
              <option value="make">{t('manufacturing.enum.procurement.make', 'Make')}</option>
              <option value="buy">{t('manufacturing.enum.procurement.buy', 'Buy')}</option>
              <option value="buy_and_make">{t('manufacturing.enum.procurement.buy_and_make', 'Make + Buy')}</option>
              <option value="service">{t('manufacturing.enum.procurement.service', 'Service')}</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('manufacturing.products.overview.fields.configurationType', 'Configuration Type')}</Label>
            <Select
              value={configurationType}
              onChange={(e) => setConfigurationType(e.target.value)}
              disabled={!canEdit}
            >
              <option value="none">{t('manufacturing.enum.configuration.none', 'None')}</option>
              <option value="variant_based">{t('manufacturing.enum.configuration.variant_based', 'Variant')}</option>
              <option value="rule_based">{t('manufacturing.enum.configuration.rule_based', 'Rule-based')}</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('manufacturing.products.overview.fields.baseUom', 'Base Unit of Measure')}</Label>
            <Select
              value={baseUomId}
              onChange={(e) => setBaseUomId(e.target.value)}
              required
              disabled={!canEdit}
            >
              {uomOptions.map((uom) => (
                <option key={uom.id} value={uom.id}>
                  {uom.code} — {uom.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-3 pt-6">
            <Switch
              checked={isPhantomDefault}
              onCheckedChange={setIsPhantomDefault}
              disabled={!canEdit}
            />
            <Label>{t('manufacturing.products.overview.fields.isPhantomDefault', 'Default to Phantom BOM')}</Label>
          </div>
        </div>
        {canEdit ? (
          <Button type="button" onClick={handleSaveSettings} disabled={isSaving}>
            {t('manufacturing.products.overview.fields.save', 'Save')}
          </Button>
        ) : null}
      </DetailSection>

      <DetailSection
        title={t('manufacturing.products.overview.productionMethods.title', 'Production Methods')}
        actions={
          canEdit ? (
            <Button type="button" variant="outline" size="sm" onClick={openCreatePm}>
              <Plus className="mr-1 size-3" />
              {t('manufacturing.products.overview.productionMethods.add', 'Add Production Method')}
            </Button>
          ) : null
        }
      >
        {isLoadingPms ? (
          <LoadingMessage label={t('manufacturing.common.loading', 'Loading...')} />
        ) : productionMethods.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {t('manufacturing.products.overview.productionMethods.empty', 'No production methods. Add production method →')}
          </p>
        ) : (
          <div className="space-y-2">
            {productionMethods.map((pm) => (
              <div
                key={pm.id}
                className="flex items-center justify-between gap-3 rounded border p-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {pm.isDefault && (
                    <Star className="size-4 text-yellow-500 flex-none" fill="currentColor" />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{pm.name}</p>
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center rounded-full border px-1.5 py-0.5">
                        {lifecycleLabels[pm.lifecycleState] ?? pm.lifecycleState}
                      </span>
                      <span>v{pm.version}</span>
                      <span>
                        {pm.bomHeaderId
                          ? (bomHeaderNamesById.get(pm.bomHeaderId) ?? t('bom.tab.title', 'BOM'))
                          : t('manufacturing.products.overview.productionMethods.noBom', 'No BOM')}
                      </span>
                      <span>
                        {pm.routingTemplateId
                          ? t('routing.tab.title', 'Routing')
                          : t('manufacturing.products.overview.productionMethods.noRouting', 'No routing')}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-none">
                  {canEdit && !pm.isDefault && (
                    <IconButton
                      variant="ghost"
                      size="xs"
                      onClick={() => handleSetDefault(pm)}
                      aria-label={t('manufacturing.products.overview.productionMethods.setDefault', 'Set as Default')}
                    >
                      <Star className="size-3" />
                    </IconButton>
                  )}
                  {canEdit && (
                    <IconButton
                      variant="ghost"
                      size="xs"
                      onClick={() => openEditPm(pm)}
                      aria-label={t('manufacturing.common.actions.edit', 'Edit')}
                    >
                      <Pencil className="size-3" />
                    </IconButton>
                  )}
                  {canEdit && (
                    <IconButton
                      variant="ghost"
                      size="xs"
                      onClick={() => handleDeletePm(pm)}
                      aria-label={t('manufacturing.common.actions.delete', 'Delete')}
                    >
                      <Trash2 className="size-3" />
                    </IconButton>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </DetailSection>

      <DetailSection
        title={t('manufacturing.products.overview.readiness.title', 'Product Readiness')}
        contentClassName="space-y-1"
      >
        {readiness.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-sm">
            {item.done ? (
              <Check className="size-4 text-green-600" />
            ) : (
              <Circle className="size-4 text-muted-foreground" />
            )}
            <span className={item.done ? 'text-foreground' : 'text-muted-foreground'}>
              {item.label}
            </span>
          </div>
        ))}
      </DetailSection>

      <Dialog open={pmDialogOpen} onOpenChange={setPmDialogOpen}>
        <DialogContent onKeyDown={handlePmShortcut}>
          <DialogHeader>
            <DialogTitle>
              {editingPm
                ? t('manufacturing.products.overview.productionMethods.form.editTitle', 'Edit Production Method')
                : t('manufacturing.products.overview.productionMethods.form.createTitle', 'Create Production Method')}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); handleSavePm() }} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>{t('manufacturing.products.overview.productionMethods.form.field.name', 'Name')}</Label>
              <Input
                value={pmName}
                onChange={(e) => setPmName(e.target.value)}
                placeholder={t('manufacturing.products.overview.productionMethods.form.field.namePlaceholder', 'e.g., Standard Assembly')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('manufacturing.products.overview.productionMethods.form.field.lifecycleState', 'Lifecycle State')}</Label>
              <Select
                value={pmLifecycle}
                onChange={(e) => setPmLifecycle(e.target.value)}
              >
                <option value="draft">{lifecycleLabels.draft}</option>
                <option value="active">{lifecycleLabels.active}</option>
                <option value="superseded">{lifecycleLabels.superseded}</option>
                <option value="archived">{lifecycleLabels.archived}</option>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setPmDialogOpen(false)}>
                {t('manufacturing.common.actions.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={pmIsSaving || !pmName.trim()}>
                {editingPm ? t('manufacturing.common.actions.save', 'Save') : t('manufacturing.common.actions.create', 'Create')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {ConfirmDialogElement}
    </div>
  )
}
