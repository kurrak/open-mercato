'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import {
  CrudForm,
  type CrudField,
  type CrudCustomFieldRenderProps,
} from '@open-mercato/ui/backend/CrudForm'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { VariantConditionEditor } from '../../bom/components/VariantConditionEditor'
import type { VariantConditionValue } from '../../bom/lib/variant-condition-ui'
import { normalizeVariantCondition } from '../../bom/lib/variant-condition-ui'
import { useCatalogVariantsForProduct } from '../../bom/hooks/useCatalogVariantsForProduct'
import { useWorkCenterSearch } from '../hooks/useWorkCenterSearch'
import { useWorkCenterLookup } from '../hooks/useWorkCenterLookup'
import {
  OPERATION_VARIANT_DEFAULT_VALUES,
  buildCreatePayload,
  buildUpdatePayload,
  clearOnActivationChange,
  operationVariantToFormValues,
  type OperationVariantFormValues,
} from './OperationTemplateVariantFormConfig'
import type { OperationVariantRow } from '../hooks/useOperationVariants'

export type OperationVariantDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Master CatalogProduct id — scopes the activation variant picker and
  // the VariantConditionEditor's key suggestions.
  masterProductId: string
  // The OperationTemplate this override belongs to.
  operationTemplateId: string
  editingVariant: OperationVariantRow | null
  onSuccess: () => void
}

export function OperationVariantDialog({
  open,
  onOpenChange,
  masterProductId,
  operationTemplateId,
  editingVariant,
  onSuccess,
}: OperationVariantDialogProps) {
  const t = useT()

  const initialValues = React.useMemo<OperationVariantFormValues>(
    () => (editingVariant ? operationVariantToFormValues(editingVariant) : OPERATION_VARIANT_DEFAULT_VALUES),
    [editingVariant],
  )

  const [activation, setActivation] = React.useState<OperationVariantFormValues['activation']>(
    initialValues.activation,
  )
  React.useEffect(() => {
    setActivation(initialValues.activation)
  }, [initialValues])

  const customFields: CrudField[] = React.useMemo(
    () => [
      {
        id: '__activation',
        label: t('routing.operationVariant.form.field.activation', 'Activation'),
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
        label: t('routing.operationVariant.form.field.variantId', 'Activating product variant'),
        type: 'custom',
        component: (props) => (
          <ActivationVariantPickerField {...props} masterProductId={masterProductId} />
        ),
      },
      {
        id: 'variantCondition',
        label: t('routing.operationVariant.form.field.variantCondition', 'Activating variant condition'),
        type: 'custom',
        component: (props) => (
          <VariantConditionEditorField {...props} productId={masterProductId} />
        ),
      },
      {
        id: 'setupTimeOverride',
        label: t('routing.operationVariant.form.field.setupTimeOverride', 'Setup time override (min)'),
        type: 'number',
        placeholder: t('routing.operationVariant.form.field.inheritPlaceholder', 'Leave empty to inherit from the base operation'),
      },
      {
        id: 'runTimeOverride',
        label: t('routing.operationVariant.form.field.runTimeOverride', 'Run time override (min)'),
        type: 'number',
        placeholder: t('routing.operationVariant.form.field.inheritPlaceholder', 'Leave empty to inherit from the base operation'),
      },
      {
        id: 'teardownTimeOverride',
        label: t('routing.operationVariant.form.field.teardownTimeOverride', 'Teardown time override (min)'),
        type: 'number',
        placeholder: t('routing.operationVariant.form.field.inheritPlaceholder', 'Leave empty to inherit from the base operation'),
      },
      {
        id: 'workCenterOverrideId',
        label: t('routing.operationVariant.form.field.workCenterOverride', 'Work center override'),
        type: 'custom',
        component: (props) => <WorkCenterOverridePickerField {...props} />,
      },
      {
        id: 'hourlyRateOverride',
        label: t('routing.operationVariant.form.field.hourlyRateOverride', 'Hourly rate override'),
        type: 'number',
        placeholder: t('routing.operationVariant.form.field.inheritPlaceholder', 'Leave empty to inherit from the base operation'),
      },
      {
        id: 'pieceworkRateOverride',
        label: t('routing.operationVariant.form.field.pieceworkRateOverride', 'Piece rate override'),
        type: 'number',
        placeholder: t('routing.operationVariant.form.field.inheritPlaceholder', 'Leave empty to inherit from the base operation'),
      },
      {
        id: 'notes',
        label: t('routing.operationVariant.form.field.notes', 'Notes'),
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
        title: t('routing.operationVariant.form.group.activation', 'Activation'),
        description: t(
          'routing.operationVariant.form.group.activationHelp',
          'This override fires when the master product\'s configuration matches the activation trigger — either a specific variant, or a condition against ConfigAttribute keys.',
        ),
        fields:
          activation === 'variant'
            ? [byId.get('__activation')!, byId.get('variantId')!]
            : [byId.get('__activation')!, byId.get('variantCondition')!],
      },
      {
        id: 'overrides',
        title: t('routing.operationVariant.form.group.overrides', 'Overrides'),
        description: t(
          'routing.operationVariant.form.group.overridesHelp',
          'All fields are optional. Set only the ones that should differ from the base operation when this override fires.',
        ),
        fields: [
          'setupTimeOverride',
          'runTimeOverride',
          'teardownTimeOverride',
          byId.get('workCenterOverrideId')!,
          'hourlyRateOverride',
          'pieceworkRateOverride',
        ],
      },
      {
        id: 'notes',
        title: t('routing.operationVariant.form.group.notes', 'Notes'),
        fields: ['notes'],
      },
    ]
  }, [customFields, activation, t])

  const handleSubmit = React.useCallback(
    async (rawValues: OperationVariantFormValues) => {
      // Activation lives in outer React state (drives the group swap) and
      // is intentionally not wired through setFormValue on toggle, so the
      // form-state copy of `activation` is frozen at its initial value.
      // Merge the outer state into the submitted values so the payload
      // builder picks the correct branch. Same precedent as
      // BomLineVariantDialog.
      const values: OperationVariantFormValues = { ...rawValues, activation }
      if (editingVariant) {
        await updateCrud('routing/operation-variant', buildUpdatePayload(values, editingVariant.id))
        flash(t('routing.operationVariant.flash.updated', 'Override updated.'), 'success')
      } else {
        await createCrud('routing/operation-variant', buildCreatePayload(values, operationTemplateId))
        flash(t('routing.operationVariant.flash.created', 'Override created.'), 'success')
      }
      onOpenChange(false)
      onSuccess()
    },
    [activation, editingVariant, operationTemplateId, onOpenChange, onSuccess, t],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl [&_.grid]:!grid-cols-1 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingVariant
              ? t('routing.operationVariant.dialog.editTitle', 'Edit variant override')
              : t('routing.operationVariant.dialog.createTitle', 'Add variant override')}
          </DialogTitle>
        </DialogHeader>
        {/*
          stopPropagation guard — this dialog opens from inside the
          OperationVariantsSection, which is rendered inline inside the
          OperationsTable's row. No outer dialog today, but the guard
          stays as defense-in-depth in case the section is later reused
          inside a dialog (and mirrors WorkCenterQuickCreateDialog's
          treatment).
        */}
        <div
          onSubmit={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') e.stopPropagation()
          }}
        >
          <CrudForm<OperationVariantFormValues>
            fields={customFields}
            groups={composedGroups}
            initialValues={initialValues}
            submitLabel={
              editingVariant
                ? t('routing.operationVariant.dialog.submitUpdate', 'Save changes')
                : t('routing.operationVariant.dialog.submitCreate', 'Add override')
            }
            embedded
            onSubmit={handleSubmit}
          />
        </div>
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
  value: OperationVariantFormValues['activation']
  onChange: (next: OperationVariantFormValues['activation']) => void
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
          {t('routing.operationVariant.activation.variant', 'Product variant')}
        </Button>
        <Button
          type="button"
          variant={value === 'condition' ? 'default' : 'ghost'}
          size="sm"
          className="h-8 rounded-none"
          onClick={() => onChange('condition')}
        >
          {t('routing.operationVariant.activation.condition', 'Configuration condition')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {value === 'variant'
          ? t(
              'routing.operationVariant.activation.variantHelp',
              'Fires when the time-rollup picks a specific CatalogProductVariant of the master — pick the variant below.',
            )
          : t(
              'routing.operationVariant.activation.conditionHelp',
              'Fires when the time-rollup\'s configuration snapshot matches a set of ConfigAttribute key-value conditions.',
            )}
      </p>
      {branchMissing ? (
        <Notice variant="warning" compact>
          {value === 'variant'
            ? t(
                'routing.operationVariant.activation.variantRequired',
                'Required — pick a variant below for this override to fire.',
              )
            : t(
                'routing.operationVariant.activation.conditionRequired',
                'Required — add at least one condition below for this override to fire.',
              )}
        </Notice>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Activation variant picker — CatalogProductVariants OF THE MASTER product
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
          'routing.operationVariant.variantPicker.masterHasNoVariants',
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
        placeholder={t('routing.operationVariant.variantPicker.placeholder', 'Pick a master variant')}
        suggestions={suggestions}
        resolveLabel={resolveLabel}
        allowCustomValues={false}
        disabled={disabled}
      />
      {isLoading && options.length === 0 && !isError ? (
        <p className="text-xs text-muted-foreground">{t('routing.operationVariant.form.loading', 'Loading…')}</p>
      ) : null}
      {isError ? (
        <Notice variant="error" compact>
          {t('routing.operationVariant.form.fetchFailed', 'Failed to load options — check your connection and retry.')}
        </Notice>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Variant condition editor
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
// Work center override picker — no inline-create (overrides reference WCs
// already defined on the base operation or master data). If the user
// needs a new WC they add it via the operation dialog or master page.
// ---------------------------------------------------------------------------

function WorkCenterOverridePickerField({ value, setValue, disabled }: CrudCustomFieldRenderProps) {
  const t = useT()
  const { options, isLoading, isError } = useWorkCenterSearch()
  const current = typeof value === 'string' ? value : ''

  const lookupIds = current ? [current] : []
  const wcsById = useWorkCenterLookup(lookupIds)

  const suggestions: ComboboxOption[] = options.map((wc) => ({
    value: wc.id,
    label: wc.name,
    description: wc.code || undefined,
  }))
  const resolveLabel = (id: string) => {
    const fromSearch = options.find((wc) => wc.id === id)
    const fromLookup = wcsById.get(id)
    return fromSearch?.name || fromLookup?.name || id
  }

  return (
    <div className="space-y-1">
      <ComboboxInput
        value={current}
        onChange={setValue}
        placeholder={t('routing.operationVariant.form.field.workCenterOverridePlaceholder', 'Leave empty to inherit from the base operation')}
        suggestions={suggestions}
        resolveLabel={resolveLabel}
        allowCustomValues={false}
        disabled={disabled}
      />
      {isLoading && options.length === 0 && !isError ? (
        <p className="text-xs text-muted-foreground">{t('routing.operationVariant.form.loading', 'Loading…')}</p>
      ) : null}
      {isError ? (
        <Notice variant="error" compact>
          {t('routing.operationVariant.form.fetchFailed', 'Failed to load options — check your connection and retry.')}
        </Notice>
      ) : null}
    </div>
  )
}
