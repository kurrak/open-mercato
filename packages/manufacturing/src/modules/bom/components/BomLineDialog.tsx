'use client'

import * as React from 'react'
import { ExternalLink, Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { CrudForm, type CrudField, type CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { VariantConditionEditor } from './VariantConditionEditor'
import {
  BOM_HEADER_DEFAULT_VALUES,
  buildBomHeaderFormFields,
  buildBomHeaderFormGroups,
  type BomHeaderFormValues,
} from './BomHeaderFormConfig'
import {
  BOM_LINE_DEFAULT_VALUES,
  bomLineToFormValues,
  buildBomLineBasicFields,
  buildCreatePayload,
  buildUpdatePayload,
  normalizeVariantCondition,
  type BomLineFormValues,
} from './BomLineFormConfig'
import { useCatalogProductSearch } from '../hooks/useCatalogProductSearch'
import { useCatalogVariantsForProduct } from '../hooks/useCatalogVariantsForProduct'
import { useBomHeadersForProduct } from '../hooks/useBomHeadersForProduct'
import { useUomSearch } from '../hooks/useUomSearch'
import { useUomLookup } from '../hooks/useUomLookup'
import { useOperationTemplatesForProduct } from '../hooks/useOperationTemplatesForProduct'
import type { BomLineRow } from './BomTreeView'
import type { VariantConditionValue } from '../lib/variant-condition-ui'

// ---------------------------------------------------------------------------
// Top-level component
// ---------------------------------------------------------------------------

export type BomLineDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Master product (top-level) — used to scope the VariantConditionEditor's
  // key suggestions. Spec b §5 says the editor uses the BomHeader's product
  // for authoring scope, but from the BomLine dialog we're always in the
  // context of the master's BOM (even when editing a nested line in
  // future). Keep this on the master throughout for authoring consistency
  // with the badges' master-perspective rendering in the tree.
  masterProductId: string
  // Where the line will live. For `+ Add line` this is the header the
  // pseudo-row belongs to; for `Edit` it is the row's current header.
  bomHeaderId: string
  // When editing, preload these values.
  editingLine: BomLineRow | null
  onSuccess: () => void
}

export function BomLineDialog({
  open,
  onOpenChange,
  masterProductId,
  bomHeaderId,
  editingLine,
  onSuccess,
}: BomLineDialogProps) {
  const t = useT()

  const initialValues = React.useMemo<BomLineFormValues>(
    () => (editingLine ? bomLineToFormValues(editingLine) : BOM_LINE_DEFAULT_VALUES),
    [editingLine],
  )

  // Track lineType as local state in addition to CrudForm's internal state
  // so the resolution-group custom renderer (which doesn't have access to
  // CrudForm's `values`) can react to it. CrudForm's CustomField render
  // props give us `values`, so sub-components can read through that too —
  // but we need `lineType` at the group-composition level to swap which
  // custom groups render.
  const [lineType, setLineType] = React.useState<BomLineFormValues['lineType']>(initialValues.lineType)
  React.useEffect(() => {
    setLineType(initialValues.lineType)
  }, [initialValues])

  const builtinFields = React.useMemo(() => buildBomLineBasicFields(t), [t])

  // Inject the custom fields — resolution group (Product + Variant or
  // Child BOM), UoM, Operation, VariantConditionEditor. Each is a
  // `type: 'custom'` CrudField that renders a React subtree with access
  // to CrudForm's setValue / values.
  //
  // `lineType` is also a custom field — wrapping a native <select> lets
  // us mirror its onChange into outer `lineType` state, which drives the
  // conditional group composition (Product+Variant vs Product+ChildBOM,
  // isPhantom visibility). Without this mirror, changing the select
  // would update CrudForm's internal state but never re-render
  // composedGroups.
  const customFields: CrudField[] = React.useMemo(
    () => [
      {
        id: 'lineType',
        label: t('bom.lineForm.field.lineType', 'Line type'),
        type: 'custom',
        component: (props) => (
          <LineTypeSelectField
            {...props}
            onExternalChange={(next) => setLineType(next)}
          />
        ),
      },
      {
        id: 'productId',
        label: t('bom.lineForm.field.product', 'Product'),
        type: 'custom',
        component: (props) => <ProductPickerField {...props} />,
      },
      {
        id: 'productVariantId',
        label: t('bom.lineForm.field.productVariant', 'Product variant'),
        type: 'custom',
        component: (props) => (
          <ProductVariantPickerField
            {...props}
            productId={(props.values?.productId as string) ?? ''}
          />
        ),
      },
      {
        id: 'childBomHeaderId',
        label: t('bom.lineForm.field.childBom', 'Child BOM'),
        type: 'custom',
        component: (props) => (
          <ChildBomPickerField
            {...props}
            productId={(props.values?.productId as string) ?? ''}
          />
        ),
      },
      {
        id: 'uomId',
        label: t('bom.lineForm.field.uom', 'Unit of measure'),
        type: 'custom',
        component: (props) => <UomPickerField {...props} />,
      },
      {
        id: 'operationTemplateId',
        label: t('bom.lineForm.field.operationTemplate', 'Operation'),
        type: 'custom',
        component: (props) => <OperationPickerField {...props} productId={masterProductId} />,
      },
      {
        id: 'variantCondition',
        label: t('bom.lineForm.field.variantCondition', 'Variant condition'),
        type: 'custom',
        component: (props) => (
          <VariantConditionEditorField {...props} productId={masterProductId} />
        ),
      },
      // Date-effective fields — custom-rendered with an enable checkbox so
      // "no constraint" is the obvious default (matches server-side null).
      // Browser's builtin `type: 'date'` placeholder / autofill behavior
      // made the raw inputs feel pre-filled even though the model was empty.
      {
        id: 'validFrom',
        label: t('bom.lineForm.field.validFrom', 'Valid from'),
        type: 'custom',
        component: (props) => (
          <ToggleDateField
            {...props}
            enableLabel={t('bom.lineForm.field.validFromEnable', 'Constrain start date')}
          />
        ),
      },
      {
        id: 'validTo',
        label: t('bom.lineForm.field.validTo', 'Valid to'),
        type: 'custom',
        component: (props) => (
          <ToggleDateField
            {...props}
            enableLabel={t('bom.lineForm.field.validToEnable', 'Constrain end date')}
          />
        ),
      },
    ],
    [t, masterProductId],
  )

  // Compose groups + inline the custom fields so CrudForm renders them in
  // the right sections. CrudFormGroup.fields can mix field ids with full
  // field configs; we slot the custom fields by id into the right groups.
  const composedGroups = React.useMemo(() => {
    const byId = new Map<string, CrudField>(customFields.map((f) => [f.id, f]))
    return [
      {
        id: 'identity',
        title: t('bom.lineForm.group.identity', 'Line identity'),
        fields: [byId.get('lineType')!],
      },
      {
        id: 'resolution',
        title: t('bom.lineForm.group.resolution', 'Resolution'),
        description: t(
          'bom.lineForm.group.resolutionHelp',
          'Static mode is the current default. Dynamic resolve-key authoring lands in a follow-up.',
        ),
        fields: lineType === 'semi_product'
          ? [byId.get('productId')!, byId.get('childBomHeaderId')!]
          : [byId.get('productId')!, byId.get('productVariantId')!],
      },
      {
        id: 'quantities',
        title: t('bom.lineForm.group.quantities', 'Quantities'),
        fields: ['netQuantity', 'grossQuantity', 'scrapPercentage', byId.get('uomId')!],
      },
      {
        id: 'operation',
        title: t('bom.lineForm.group.operation', 'Operation'),
        fields: [byId.get('operationTemplateId')!],
      },
      {
        id: 'variantCondition',
        title: t('bom.lineForm.group.variantCondition', 'Variant condition'),
        description: t(
          'bom.lineForm.group.variantConditionHelp',
          'Keys are validated against this product\'s ConfigAttributes. Free-text keys are allowed (Graceful Incompleteness).',
        ),
        fields: [byId.get('variantCondition')!],
      },
      {
        id: 'dates',
        title: t('bom.lineForm.group.dates', 'Effective dates'),
        description: t(
          'bom.lineForm.group.datesHelp',
          'Date-effective filtering. Disable both to make the line always active.',
        ),
        fields: [byId.get('validFrom')!, byId.get('validTo')!],
      },
      {
        id: 'flags',
        title: t('bom.lineForm.group.flags', 'Flags'),
        fields: ['isConsumable'],
      },
      {
        id: 'notes',
        title: t('bom.lineForm.group.notes', 'Notes'),
        fields: ['notes'],
      },
    ]
  }, [customFields, lineType, t])

  const handleSubmit = React.useCallback(
    async (values: BomLineFormValues) => {
      // Errors propagate — CrudForm surfaces them via mapCrudServerErrorToFormErrors.
      if (editingLine) {
        const payload = buildUpdatePayload(values, editingLine.id)
        await updateCrud('bom/bom-line', payload)
        flash(t('bom.lineForm.updateSuccess', 'BOM line updated.'), 'success')
      } else {
        const payload = buildCreatePayload(values, bomHeaderId)
        await createCrud('bom/bom-line', payload)
        flash(t('bom.lineForm.createSuccess', 'BOM line created.'), 'success')
      }
      onOpenChange(false)
      onSuccess()
    },
    [editingLine, bomHeaderId, onSuccess, onOpenChange, t],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl [&_.grid]:!grid-cols-1">
        <DialogHeader>
          <DialogTitle>
            {editingLine
              ? t('bom.lineForm.title.edit', 'Edit BOM line')
              : t('bom.lineForm.title.create', 'Add BOM line')}
          </DialogTitle>
        </DialogHeader>
        <CrudForm<BomLineFormValues>
          fields={[...builtinFields, ...customFields]}
          groups={composedGroups}
          initialValues={initialValues}
          submitLabel={
            editingLine
              ? t('bom.lineForm.submit.update', 'Save changes')
              : t('bom.lineForm.submit.create', 'Add line')
          }
          embedded
          onSubmit={async (values) => {
            // Keep our local lineType mirror in sync before submit so the
            // payload builder sees the latest choice.
            setLineType(values.lineType)
            await handleSubmit(values)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Custom field: Line type select — mirrors CrudForm's internal value into
// the outer React state so composedGroups recomputes on every change
// (drives which pickers show in the resolution group + isPhantom visibility).
// ---------------------------------------------------------------------------

type LineTypeSelectFieldProps = CrudCustomFieldRenderProps & {
  onExternalChange: (next: BomLineFormValues['lineType']) => void
}

function LineTypeSelectField({ value, setValue, disabled, onExternalChange }: LineTypeSelectFieldProps) {
  const t = useT()
  const current: BomLineFormValues['lineType'] = value === 'semi_product' ? 'semi_product' : 'material'
  return (
    <select
      className="h-9 w-full rounded border bg-background px-2 text-sm"
      value={current}
      disabled={disabled}
      onChange={(e) => {
        const next = (e.target.value === 'semi_product' ? 'semi_product' : 'material') as BomLineFormValues['lineType']
        setValue(next)
        onExternalChange(next)
      }}
    >
      <option value="material">{t('bom.lineForm.lineType.material', 'Material')}</option>
      <option value="semi_product">{t('bom.lineForm.lineType.semi_product', 'Sub-assembly')}</option>
    </select>
  )
}

// ---------------------------------------------------------------------------
// Custom field: Product picker
// ---------------------------------------------------------------------------

function ProductPickerField({ value, setValue, setFormValue, disabled }: CrudCustomFieldRenderProps) {
  const t = useT()
  const { options, isLoading, isError } = useCatalogProductSearch()
  const current = typeof value === 'string' ? value : ''

  const resolveLabel = React.useCallback(
    (id: string) => {
      const hit = options.find((o) => o.id === id)
      return hit?.title ?? id
    },
    [options],
  )

  const suggestions = React.useMemo<ComboboxOption[]>(
    () => options.map((o) => ({ value: o.id, label: o.title, description: o.sku ?? undefined })),
    [options],
  )

  const handleOpenCreateTab = React.useCallback(() => {
    window.open('/backend/catalog/products/create', '_blank', 'noopener')
  }, [])

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <ComboboxInput
            value={current}
            onChange={(next) => {
              setValue(next)
              // When product changes, clear any variant selection tied to
              // the previous product — the variants picker's options change
              // and holding a stale id would submit a mismatched pair.
              // `setFormValue` is typed optional on CrudCustomFieldRenderProps
              // even though CrudForm always supplies it; the chain is a
              // concession to the type, not a real null check.
              setFormValue?.('productVariantId', '')
              setFormValue?.('childBomHeaderId', '')
            }}
            placeholder={t('bom.lineForm.product.placeholder', 'Search for a product…')}
            suggestions={suggestions}
            resolveLabel={resolveLabel}
            allowCustomValues={false}
            disabled={disabled}
          />
        </div>
        <SimpleTooltip content={t('bom.lineForm.product.createTooltip', 'Open Catalog → create a product in a new tab. Return here; the list refreshes automatically.')}>
          <IconButton
            type="button"
            variant="outline"
            size="sm"
            onClick={handleOpenCreateTab}
            disabled={disabled}
            aria-label={t('bom.lineForm.product.create', 'Create product')}
          >
            <ExternalLink className="size-4" />
          </IconButton>
        </SimpleTooltip>
      </div>
      {isLoading && options.length === 0 && !isError ? (
        <p className="text-xs text-muted-foreground">
          {t('bom.lineForm.loading', 'Loading…')}
        </p>
      ) : null}
      {isError ? (
        <Notice variant="error" compact>
          {t('bom.lineForm.fetchFailed', 'Failed to load options — check your connection and retry.')}
        </Notice>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Custom field: ProductVariant picker (material lines only)
// ---------------------------------------------------------------------------

type ProductVariantPickerFieldProps = CrudCustomFieldRenderProps & { productId: string }

function ProductVariantPickerField({ value, setValue, productId, disabled }: ProductVariantPickerFieldProps) {
  const t = useT()
  const { options, isLoading, isError } = useCatalogVariantsForProduct(productId)
  const current = typeof value === 'string' ? value : ''

  if (!productId) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('bom.lineForm.variant.noProduct', 'Pick a product first to select a variant.')}
      </p>
    )
  }

  if (!isLoading && options.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {t('bom.lineForm.variant.none', 'This product has no variants.')}
        </span>
        <SimpleTooltip content={t('bom.lineForm.variant.createTooltip', 'Open the product\'s catalog page in a new tab to add variants. Return here to pick one.')}>
          <IconButton
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.open(`/backend/catalog/products/${productId}`, '_blank', 'noopener')}
            disabled={disabled}
            aria-label={t('bom.lineForm.variant.create', 'Add variant')}
          >
            <ExternalLink className="size-4" />
          </IconButton>
        </SimpleTooltip>
      </div>
    )
  }

  const suggestions: ComboboxOption[] = options.map((v) => ({
    value: v.id,
    label: v.name,
    description: v.sku ?? undefined,
  }))

  const resolveLabel = (id: string) => options.find((v) => v.id === id)?.name ?? id

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <ComboboxInput
            value={current}
            onChange={setValue}
            placeholder={t('bom.lineForm.variant.placeholder', 'Optional — pick a specific variant')}
            suggestions={suggestions}
            resolveLabel={resolveLabel}
            allowCustomValues={false}
            disabled={disabled}
          />
        </div>
        <SimpleTooltip content={t('bom.lineForm.variant.createTooltip', 'Open the product\'s catalog page in a new tab to add variants. Return here to pick one.')}>
          <IconButton
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.open(`/backend/catalog/products/${productId}`, '_blank', 'noopener')}
            disabled={disabled}
            aria-label={t('bom.lineForm.variant.create', 'Add variant')}
          >
            <ExternalLink className="size-4" />
          </IconButton>
        </SimpleTooltip>
      </div>
      {isLoading && options.length === 0 && !isError ? (
        <p className="text-xs text-muted-foreground">
          {t('bom.lineForm.loading', 'Loading…')}
        </p>
      ) : null}
      {isError ? (
        <Notice variant="error" compact>
          {t('bom.lineForm.fetchFailed', 'Failed to load options — check your connection and retry.')}
        </Notice>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Custom field: Child BOM picker (semi_product lines only)
// ---------------------------------------------------------------------------

type ChildBomPickerFieldProps = CrudCustomFieldRenderProps & { productId: string }

function ChildBomPickerField({ value, setValue, productId, disabled }: ChildBomPickerFieldProps) {
  const t = useT()
  const { options, isLoading, isError, invalidate } = useBomHeadersForProduct(productId)
  const [createOpen, setCreateOpen] = React.useState(false)
  const current = typeof value === 'string' ? value : ''

  if (!productId) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('bom.lineForm.childBom.noProduct', 'Pick a product first to select or create its BOM.')}
      </p>
    )
  }

  const suggestions: ComboboxOption[] = options.map((h) => ({
    value: h.id,
    label: h.name,
    description: h.bomUsage !== 'production' ? h.bomUsage : undefined,
  }))
  const resolveLabel = (id: string) => options.find((h) => h.id === id)?.name ?? id

  const handleCreateSuccess = React.useCallback(
    (created: { id: string }) => {
      setValue(created.id)
      invalidate()
      setCreateOpen(false)
    },
    [setValue, invalidate],
  )

  return (
    <>
      <div className="space-y-1">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <ComboboxInput
              value={current}
              onChange={setValue}
              placeholder={t('bom.lineForm.childBom.placeholder', 'Pick the sub-assembly\'s BOM')}
              suggestions={suggestions}
              resolveLabel={resolveLabel}
              allowCustomValues={false}
              disabled={disabled}
            />
            {isLoading && options.length === 0 && !isError ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('bom.lineForm.loading', 'Loading…')}
              </p>
            ) : options.length === 0 && !isError ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('bom.lineForm.childBom.emptyHint', 'No BOMs for this product yet — click the + button to create one.')}
              </p>
            ) : null}
          </div>
          <SimpleTooltip content={t('bom.lineForm.childBom.createTooltip', 'Create a BOM for this product without leaving the dialog.')}>
            <IconButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(true)}
              disabled={disabled || !productId}
              aria-label={t('bom.lineForm.childBom.create', 'Create BOM')}
            >
              <Plus className="size-4" />
            </IconButton>
          </SimpleTooltip>
        </div>
        {isError ? (
          <Notice variant="error" compact>
            {t('bom.lineForm.fetchFailed', 'Failed to load options — check your connection and retry.')}
          </Notice>
        ) : null}
      </div>
      <CreateBomHeaderMiniDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        productId={productId}
        onSuccess={handleCreateSuccess}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Custom field: UoM picker
// ---------------------------------------------------------------------------

function UomPickerField({ value, setValue, disabled }: CrudCustomFieldRenderProps) {
  const t = useT()
  const { options, isLoading, isError } = useUomSearch()
  const current = typeof value === 'string' ? value : ''

  // Belt-and-braces label resolution — the search list ("all active UoMs",
  // pageSize=100) can miss the currently-saved UoM if the tenant has many
  // UoMs OR the active-filter drifted, so also fetch the current value by
  // id via useUomLookup. Whichever source has the record first wins;
  // falls back to the raw id only if both fail (defensive — shouldn't
  // happen in practice).
  const lookupIds = current ? [current] : []
  const uomsById = useUomLookup(lookupIds)

  const suggestions: ComboboxOption[] = options.map((u) => ({
    value: u.id,
    label: u.name || u.code || u.id,
    description: u.code || undefined,
  }))
  // Prefer `name` across BOTH sources before falling back to `code`,
  // and within each type prefer the lookup's record (fetched by-id,
  // usually fresher) over the search list (which may return an
  // abbreviated projection). This prevents the search returning a
  // code-only projection from masking a name available via lookup.
  const resolveLabel = (id: string) => {
    const fromSearch = options.find((u) => u.id === id)
    const fromLookup = uomsById.get(id)
    const name = fromLookup?.name || fromSearch?.name
    if (name) return name
    const code = fromLookup?.code || fromSearch?.code
    if (code) return code
    return id
  }

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <ComboboxInput
            value={current}
            onChange={setValue}
            placeholder={t('bom.lineForm.uom.placeholder', 'Pick a unit of measure')}
            suggestions={suggestions}
            resolveLabel={resolveLabel}
            allowCustomValues={false}
            disabled={disabled}
          />
        </div>
        <SimpleTooltip content={t('bom.lineForm.uom.createTooltip', 'Open the Units of Measure master page in a new tab. Return here; the list refreshes automatically.')}>
          <IconButton
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.open('/backend/manufacturing/units-of-measure', '_blank', 'noopener')}
            disabled={disabled}
            aria-label={t('bom.lineForm.uom.create', 'Create UoM')}
          >
            <ExternalLink className="size-4" />
          </IconButton>
        </SimpleTooltip>
      </div>
      {isLoading && options.length === 0 && !isError ? (
        <p className="text-xs text-muted-foreground">
          {t('bom.lineForm.loading', 'Loading…')}
        </p>
      ) : null}
      {isError ? (
        <Notice variant="error" compact>
          {t('bom.lineForm.fetchFailed', 'Failed to load options — check your connection and retry.')}
        </Notice>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Custom field: Operation picker (with deferred in-place create)
// ---------------------------------------------------------------------------

type OperationPickerFieldProps = CrudCustomFieldRenderProps & { productId: string }

function OperationPickerField({ value, setValue, productId, disabled }: OperationPickerFieldProps) {
  const t = useT()
  const { options, isLoading, isError } = useOperationTemplatesForProduct(productId)
  const current = typeof value === 'string' ? value : ''

  const suggestions: ComboboxOption[] = options.map((op) => ({
    value: op.id,
    label: op.name,
  }))
  const resolveLabel = (id: string) => options.find((op) => op.id === id)?.name ?? id

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <ComboboxInput
            value={current}
            onChange={setValue}
            placeholder={t('bom.lineForm.operation.placeholder', 'Optional — pick the consuming operation')}
            suggestions={suggestions}
            resolveLabel={resolveLabel}
            allowCustomValues={false}
            disabled={disabled}
          />
        </div>
        {/* Deferred until the routing-tab UI lands. The button stays visible so
            the affordance pattern is uniform across all four comboboxes;
            disabled-with-tooltip signals intent. */}
        <SimpleTooltip content={t('bom.lineForm.operation.createDeferred', 'Operation creation lands with the routing tab UI. Create operations from the Routing tab once available.')}>
          <span>
            <IconButton
              type="button"
              variant="outline"
              size="sm"
              disabled
              aria-label={t('bom.lineForm.operation.create', 'Create operation')}
            >
              <Plus className="size-4" />
            </IconButton>
          </span>
        </SimpleTooltip>
      </div>
      {isLoading && options.length === 0 && !isError ? (
        <p className="text-xs text-muted-foreground">
          {t('bom.lineForm.loading', 'Loading…')}
        </p>
      ) : null}
      {isError ? (
        <Notice variant="error" compact>
          {t('bom.lineForm.fetchFailed', 'Failed to load options — check your connection and retry.')}
        </Notice>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Custom field: Toggle-gated date — the builtin `type: 'date'` input has
// browser-dependent placeholder + autofill behavior that made the raw
// field feel pre-filled even when empty. This wrapper adds an explicit
// enable checkbox; the date input shows only when the checkbox is set.
// Unchecked → empty string → `null` on save (matches server contract).
// ---------------------------------------------------------------------------

type ToggleDateFieldProps = CrudCustomFieldRenderProps & { enableLabel: string }

function ToggleDateField({ value, setValue, disabled, enableLabel }: ToggleDateFieldProps) {
  const current = typeof value === 'string' ? value : ''
  const enabled = current.length > 0

  const todayIso = React.useMemo(() => new Date().toISOString().slice(0, 10), [])

  return (
    <div className="flex flex-col gap-2">
      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={enabled}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.checked) {
              // Default to today on first enable — gives the user a
              // sensible starting point they can then pick from.
              setValue(todayIso)
            } else {
              setValue('')
            }
          }}
        />
        <span>{enableLabel}</span>
      </label>
      {enabled ? (
        <input
          type="date"
          className="h-9 w-full max-w-xs rounded border px-2 text-sm"
          value={current}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Custom field: VariantConditionEditor
// ---------------------------------------------------------------------------

type VariantConditionEditorFieldProps = CrudCustomFieldRenderProps & { productId: string }

function VariantConditionEditorField({ value, setValue, productId, disabled }: VariantConditionEditorFieldProps) {
  // Normalize the incoming value through the shared shape guard so a
  // corrupt / malformed persisted variantCondition doesn't crash the
  // editor on mount.
  const normalized = normalizeVariantCondition(value)
  return (
    <VariantConditionEditor
      value={normalized as VariantConditionValue}
      onChange={(next) => setValue(next)}
      productId={productId}
      disabled={disabled}
    />
  )
}

// ---------------------------------------------------------------------------
// Nested mini-dialog — in-place BomHeader create
// ---------------------------------------------------------------------------

type CreateBomHeaderMiniDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId: string
  onSuccess: (created: { id: string }) => void
}

function CreateBomHeaderMiniDialog({
  open,
  onOpenChange,
  productId,
  onSuccess,
}: CreateBomHeaderMiniDialogProps) {
  const t = useT()
  const fields = React.useMemo(() => buildBomHeaderFormFields(t), [t])
  const groups = React.useMemo(() => buildBomHeaderFormGroups(t), [t])

  const handleSubmit = React.useCallback(
    async (values: BomHeaderFormValues) => {
      // createCrud throws on failure via raiseCrudError, so reaching the
      // next line means the create succeeded. The result.id SHOULD always
      // be a string on success — a missing id signals a server contract
      // bug and we surface it as a user-facing error rather than a silent
      // no-op (the dialog would otherwise stay open with no feedback).
      const result = await createCrud<{ id?: string }>('bom/bom', {
        ...values,
        productId,
      })
      const createdId = result.result?.id
      if (typeof createdId !== 'string' || createdId.length === 0) {
        flash(
          t(
            'bom.lineForm.childBom.createNoId',
            'BOM created but the server response did not include its id — refresh and pick it manually.',
          ),
          'error',
        )
        return
      }
      flash(t('bom.lineForm.childBom.createSuccess', 'BOM created.'), 'success')
      onSuccess({ id: createdId })
    },
    [productId, onSuccess, t],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg [&_.grid]:!grid-cols-1">
        <DialogHeader>
          <DialogTitle>{t('bom.lineForm.childBom.createDialogTitle', 'Create BOM')}</DialogTitle>
        </DialogHeader>
        <Notice variant="info" compact>
          {t(
            'bom.lineForm.childBom.createDialogInfo',
            'Quick create — fill in only the essentials. Refine this BOM\'s lines on the sub-assembly\'s own BOM tab.',
          )}
        </Notice>
        <CrudForm<BomHeaderFormValues>
          fields={fields}
          groups={groups}
          initialValues={BOM_HEADER_DEFAULT_VALUES}
          submitLabel={t('bom.lineForm.childBom.createSubmit', 'Create')}
          embedded
          onSubmit={async (values) => {
            await handleSubmit(values)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
