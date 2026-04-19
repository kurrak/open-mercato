'use client'

import * as React from 'react'
import { ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { CrudForm, type CrudField, type CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { VariantConditionEditor } from './VariantConditionEditor'
import { useCatalogProductSearch } from '../hooks/useCatalogProductSearch'
import { useCatalogVariantsForProduct } from '../hooks/useCatalogVariantsForProduct'
import { useUomSearch } from '../hooks/useUomSearch'
import { useUomLookup } from '../hooks/useUomLookup'
import type { BomLineVariantRow } from '../hooks/useBomLineVariants'
import {
  BOM_LINE_VARIANT_DEFAULT_VALUES,
  bomLineVariantToFormValues,
  buildCreatePayload,
  buildUpdatePayload,
  clearOnActivationChange,
  clearOnProductOverrideChange,
  type BomLineVariantFormValues,
} from './BomLineVariantFormConfig'
import { normalizeVariantCondition } from '../lib/variant-condition-ui'
import type { VariantConditionValue } from '../lib/variant-condition-ui'

export type BomLineVariantDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Top-level master product — drives the activation-variant picker's
  // option scope (CatalogProductVariants of the master are the activation
  // triggers) and the VariantConditionEditor's scope.
  masterProductId: string
  // The BomLine this override belongs to.
  bomLineId: string
  // When editing, preload these values.
  editingVariant: BomLineVariantRow | null
  onSuccess: () => void
}

export function BomLineVariantDialog({
  open,
  onOpenChange,
  masterProductId,
  bomLineId,
  editingVariant,
  onSuccess,
}: BomLineVariantDialogProps) {
  const t = useT()

  const initialValues = React.useMemo<BomLineVariantFormValues>(
    () =>
      editingVariant ? bomLineVariantToFormValues(editingVariant) : BOM_LINE_VARIANT_DEFAULT_VALUES,
    [editingVariant],
  )

  // Outer state for the activation toggle — mirrors what's in CrudForm so
  // composedGroups can swap which picker renders. Same pattern as
  // BomLineDialog's resolutionMode state.
  const [activation, setActivation] = React.useState<BomLineVariantFormValues['activation']>(
    initialValues.activation,
  )
  React.useEffect(() => {
    setActivation(initialValues.activation)
  }, [initialValues])

  const customFields: CrudField[] = React.useMemo(
    () => [
      {
        // Phantom field — never writes to form state; exists so the
        // toggle participates in CrudForm's group layout. The outer
        // `activation` state is the source of truth for branch swapping.
        id: '__activation',
        label: t('bom.variantForm.field.activation', 'Activation'),
        type: 'custom',
        component: (props) => {
          const variantIdValue = (props.values?.variantId as string) ?? ''
          const conditionValue = props.values?.variantCondition as
            | Record<string, unknown>
            | null
            | undefined
          const branchMissing =
            activation === 'variant'
              ? variantIdValue.trim().length === 0
              : !conditionValue || Object.keys(conditionValue).length === 0
          return (
            <ActivationToggleField
              value={activation}
              branchMissing={branchMissing}
              onChange={(next) => {
                if (next === activation) return
                setActivation(next)
                for (const fieldId of clearOnActivationChange(next)) {
                  props.setFormValue?.(fieldId, fieldId === 'variantCondition' ? null : '')
                }
              }}
            />
          )
        },
      },
      {
        id: 'variantId',
        label: t('bom.variantForm.field.variantId', 'Activating product variant'),
        type: 'custom',
        component: (props) => (
          <ActivationVariantPickerField {...props} masterProductId={masterProductId} />
        ),
      },
      {
        id: 'variantCondition',
        label: t('bom.variantForm.field.variantCondition', 'Activating variant condition'),
        type: 'custom',
        component: (props) => (
          <VariantConditionEditorField {...props} productId={masterProductId} />
        ),
      },
      {
        id: 'quantityOverride',
        label: t('bom.variantForm.field.quantityOverride', 'Quantity override'),
        type: 'text',
        placeholder: t('bom.variantForm.field.quantityPlaceholder', 'Leave empty to inherit from the base line'),
      },
      {
        id: 'productOverrideId',
        label: t('bom.variantForm.field.productOverride', 'Product override'),
        type: 'custom',
        component: (props) => <ProductOverridePickerField {...props} />,
      },
      {
        id: 'productVariantOverrideId',
        label: t('bom.variantForm.field.productVariantOverride', 'Product variant override'),
        type: 'custom',
        component: (props) => (
          <ProductVariantOverridePickerField
            {...props}
            productOverrideId={(props.values?.productOverrideId as string) ?? ''}
          />
        ),
      },
      {
        id: 'unitOverrideId',
        label: t('bom.variantForm.field.unitOverride', 'Unit override'),
        type: 'custom',
        component: (props) => <UnitOverridePickerField {...props} />,
      },
      {
        id: 'notes',
        label: t('bom.variantForm.field.notes', 'Notes'),
        type: 'textarea',
      },
    ],
    [t, masterProductId, activation],
  )

  const composedGroups = React.useMemo(() => {
    const byId = new Map<string, CrudField>(customFields.map((f) => [f.id, f]))
    return [
      {
        id: 'activation',
        title: t('bom.variantForm.group.activation', 'Activation'),
        description: t(
          'bom.variantForm.group.activationHelp',
          'This override fires when the master product\'s configuration matches the activation trigger — either a specific variant, or a condition against ConfigAttribute keys.',
        ),
        fields:
          activation === 'variant'
            ? [byId.get('__activation')!, byId.get('variantId')!]
            : [byId.get('__activation')!, byId.get('variantCondition')!],
      },
      {
        id: 'overrides',
        title: t('bom.variantForm.group.overrides', 'Overrides'),
        description: t(
          'bom.variantForm.group.overridesHelp',
          'All fields are optional. Set only the ones that should differ from the base BomLine when this override fires.',
        ),
        fields: [
          'quantityOverride',
          byId.get('productOverrideId')!,
          byId.get('productVariantOverrideId')!,
          byId.get('unitOverrideId')!,
        ],
      },
      {
        id: 'notes',
        title: t('bom.variantForm.group.notes', 'Notes'),
        fields: ['notes'],
      },
    ]
  }, [customFields, activation, t])

  const handleSubmit = React.useCallback(
    async (values: BomLineVariantFormValues) => {
      // Errors propagate — CrudForm surfaces server validation via
      // mapCrudServerErrorToFormErrors.
      if (editingVariant) {
        const payload = buildUpdatePayload(values, editingVariant.id)
        await updateCrud('bom/bom-line-variant', payload)
        flash(t('bom.variantForm.updateSuccess', 'Override updated.'), 'success')
      } else {
        const payload = buildCreatePayload(values, bomLineId)
        await createCrud('bom/bom-line-variant', payload)
        flash(t('bom.variantForm.createSuccess', 'Override created.'), 'success')
      }
      onOpenChange(false)
      onSuccess()
    },
    [editingVariant, bomLineId, onOpenChange, onSuccess, t],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        `[&_.grid]:!grid-cols-1` forces CrudForm's internal `.grid` wrapper
        into a single column inside this narrow dialog. It's a Tailwind
        arbitrary-selector escape hatch targeting CrudForm's generated
        markup; if CrudForm renames that class the override silently
        reverts to two columns. A `columns={1}` / `layout="stacked"` prop
        on CrudForm would be the clean fix — tracked as a cross-package
        follow-up, out of scope for Phase C.
      */}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl [&_.grid]:!grid-cols-1">
        <DialogHeader>
          <DialogTitle>
            {editingVariant
              ? t('bom.variantForm.title.edit', 'Edit override')
              : t('bom.variantForm.title.create', 'Add override')}
          </DialogTitle>
        </DialogHeader>
        <CrudForm<BomLineVariantFormValues>
          fields={customFields}
          groups={composedGroups}
          initialValues={initialValues}
          submitLabel={
            editingVariant
              ? t('bom.variantForm.submit.update', 'Save changes')
              : t('bom.variantForm.submit.create', 'Add override')
          }
          embedded
          onSubmit={async (values) => {
            await handleSubmit({ ...values, activation })
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Activation toggle — segmented Variant / Condition control
// ---------------------------------------------------------------------------

function ActivationToggleField({
  value,
  onChange,
  branchMissing,
}: {
  value: BomLineVariantFormValues['activation']
  onChange: (next: BomLineVariantFormValues['activation']) => void
  // True when the currently-selected activation branch's value is empty
  // (no variant picked, or empty condition map). Surfaces the required-
  // field state before the server rejects on save.
  branchMissing: boolean
}) {
  const t = useT()
  return (
    <div className="space-y-1">
      <div className="inline-flex overflow-hidden rounded-md border">
        <Button
          type="button"
          variant={value === 'variant' ? 'default' : 'ghost'}
          size="sm"
          className="h-8 rounded-none"
          onClick={() => onChange('variant')}
        >
          {t('bom.variantForm.activation.variant', 'Product variant')}
        </Button>
        <Button
          type="button"
          variant={value === 'condition' ? 'default' : 'ghost'}
          size="sm"
          className="h-8 rounded-none"
          onClick={() => onChange('condition')}
        >
          {t('bom.variantForm.activation.condition', 'Configuration condition')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {value === 'variant'
          ? t(
              'bom.variantForm.activation.variantHelp',
              'Fires when the explosion picks a specific CatalogProductVariant of the master — pick the variant below.',
            )
          : t(
              'bom.variantForm.activation.conditionHelp',
              'Fires when the explosion\'s configuration snapshot matches a set of ConfigAttribute key-value conditions.',
            )}
      </p>
      {branchMissing ? (
        <Notice variant="warning" compact>
          {value === 'variant'
            ? t(
                'bom.variantForm.activation.variantRequired',
                'Required — pick a variant below for this override to fire.',
              )
            : t(
                'bom.variantForm.activation.conditionRequired',
                'Required — add at least one condition below for this override to fire.',
              )}
        </Notice>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Activation variant picker — CatalogProductVariants OF THE MASTER product
// (the activation matches the master's runtime configuration, not the
// BomLine's product)
// ---------------------------------------------------------------------------

type ActivationVariantPickerFieldProps = CrudCustomFieldRenderProps & { masterProductId: string }

function ActivationVariantPickerField({
  value,
  setValue,
  disabled,
  masterProductId,
}: ActivationVariantPickerFieldProps) {
  const t = useT()
  const { options, isLoading, isError } = useCatalogVariantsForProduct(masterProductId)
  const current = typeof value === 'string' ? value : ''

  const suggestions: ComboboxOption[] = options.map((v) => ({
    value: v.id,
    label: v.name,
    description: v.sku ?? undefined,
  }))
  const resolveLabel = (id: string) => options.find((v) => v.id === id)?.name ?? id

  if (!isLoading && options.length === 0 && !isError) {
    return (
      <Notice variant="info" compact>
        {t(
          'bom.variantForm.variantPicker.masterHasNoVariants',
          'This master product has no variants — use "Configuration condition" instead.',
        )}
      </Notice>
    )
  }

  return (
    <div className="space-y-1">
      <ComboboxInput
        value={current}
        onChange={setValue}
        placeholder={t('bom.variantForm.variantPicker.placeholder', 'Pick a master variant')}
        suggestions={suggestions}
        resolveLabel={resolveLabel}
        allowCustomValues={false}
        disabled={disabled}
      />
      {isLoading && options.length === 0 && !isError ? (
        <p className="text-xs text-muted-foreground">{t('bom.variantForm.loading', 'Loading…')}</p>
      ) : null}
      {isError ? (
        <Notice variant="error" compact>
          {t('bom.variantForm.fetchFailed', 'Failed to load options — check your connection and retry.')}
        </Notice>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Variant condition editor (for activation = 'condition')
// ---------------------------------------------------------------------------

function VariantConditionEditorField({
  value,
  setValue,
  disabled,
  productId,
}: CrudCustomFieldRenderProps & { productId: string }) {
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
// Product override picker — any CatalogProduct. On change, clears the
// product_variant_override to avoid drift.
// ---------------------------------------------------------------------------

function ProductOverridePickerField({
  value,
  setValue,
  setFormValue,
  disabled,
}: CrudCustomFieldRenderProps) {
  const t = useT()
  const { options, isLoading, isError } = useCatalogProductSearch()
  const current = typeof value === 'string' ? value : ''

  const suggestions: ComboboxOption[] = options.map((p) => ({
    value: p.id,
    label: p.title,
    description: p.sku ?? undefined,
  }))
  const resolveLabel = (id: string) => options.find((p) => p.id === id)?.title ?? id

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <ComboboxInput
            value={current}
            onChange={(next) => {
              setValue(next)
              for (const fieldId of clearOnProductOverrideChange()) {
                setFormValue?.(fieldId, '')
              }
            }}
            placeholder={t('bom.variantForm.productOverride.placeholder', 'Optional — override the base line\'s product')}
            suggestions={suggestions}
            resolveLabel={resolveLabel}
            allowCustomValues={false}
            disabled={disabled}
          />
        </div>
        <SimpleTooltip content={t('bom.variantForm.productOverride.createTooltip', 'Open Catalog → create a product in a new tab. Return here; the list refreshes automatically.')}>
          <IconButton
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.open('/backend/catalog/products/create', '_blank', 'noopener')}
            disabled={disabled}
            aria-label={t('bom.variantForm.productOverride.create', 'Create product')}
          >
            <ExternalLink className="size-4" />
          </IconButton>
        </SimpleTooltip>
      </div>
      {isLoading && options.length === 0 && !isError ? (
        <p className="text-xs text-muted-foreground">{t('bom.variantForm.loading', 'Loading…')}</p>
      ) : null}
      {isError ? (
        <Notice variant="error" compact>
          {t('bom.variantForm.fetchFailed', 'Failed to load options — check your connection and retry.')}
        </Notice>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProductVariant override picker — scoped to the chosen productOverride.
// Hidden when no product override is picked OR the chosen product has no
// variants.
// ---------------------------------------------------------------------------

function ProductVariantOverridePickerField({
  value,
  setValue,
  productOverrideId,
  disabled,
}: CrudCustomFieldRenderProps & { productOverrideId: string }) {
  const t = useT()
  const { options, isLoading, isError } = useCatalogVariantsForProduct(productOverrideId)
  const current = typeof value === 'string' ? value : ''

  if (!productOverrideId) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('bom.variantForm.productVariantOverride.noProduct', 'Pick a product override first to narrow it to a specific variant.')}
      </p>
    )
  }

  if (!isLoading && options.length === 0 && !isError) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('bom.variantForm.productVariantOverride.noVariants', 'The chosen product override has no variants.')}
      </p>
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
      <ComboboxInput
        value={current}
        onChange={setValue}
        placeholder={t('bom.variantForm.productVariantOverride.placeholder', 'Optional — pin a specific variant of the override product')}
        suggestions={suggestions}
        resolveLabel={resolveLabel}
        allowCustomValues={false}
        disabled={disabled}
      />
      {isLoading && options.length === 0 && !isError ? (
        <p className="text-xs text-muted-foreground">{t('bom.variantForm.loading', 'Loading…')}</p>
      ) : null}
      {isError ? (
        <Notice variant="error" compact>
          {t('bom.variantForm.fetchFailed', 'Failed to load options — check your connection and retry.')}
        </Notice>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Unit override picker
// ---------------------------------------------------------------------------

function UnitOverridePickerField({ value, setValue, disabled }: CrudCustomFieldRenderProps) {
  const t = useT()
  const { options, isLoading, isError } = useUomSearch()
  const current = typeof value === 'string' ? value : ''
  const lookupIds = current ? [current] : []
  const uomsById = useUomLookup(lookupIds)

  const suggestions: ComboboxOption[] = options.map((u) => ({
    value: u.id,
    label: u.name || u.code || u.id,
    description: u.code || undefined,
  }))
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
      <ComboboxInput
        value={current}
        onChange={setValue}
        placeholder={t('bom.variantForm.unitOverride.placeholder', 'Optional — override the base line\'s unit')}
        suggestions={suggestions}
        resolveLabel={resolveLabel}
        allowCustomValues={false}
        disabled={disabled}
      />
      {isLoading && options.length === 0 && !isError ? (
        <p className="text-xs text-muted-foreground">{t('bom.variantForm.loading', 'Loading…')}</p>
      ) : null}
      {isError ? (
        <Notice variant="error" compact>
          {t('bom.variantForm.fetchFailed', 'Failed to load options — check your connection and retry.')}
        </Notice>
      ) : null}
    </div>
  )
}
