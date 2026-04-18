'use client'

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'

type Translator = (key: string, fallback?: string) => string

export type AttributeFormValues = {
  id?: string
  key: string
  label: string
  attributeType: string
  allowedValues: string[]
  numericMin: string
  numericMax: string
  numericStep: string
  productFilterId: string
  isMandatory: boolean
  displayOrder: number
  defaultValue: string
  attributeGroup: string
  isActive: boolean
}

export type ConfigAttributeRow = {
  id: string
  key: string
  label: string
  attribute_type: string
  allowed_values: unknown
  product_filter_id: string | null
  is_mandatory: boolean
  display_order: number
  default_value: string | null
  attribute_group: string | null
  is_active: boolean
  product_id: string
  created_at: string
  updated_at: string
}

export const ATTRIBUTE_DEFAULT_VALUES: AttributeFormValues = {
  key: '',
  label: '',
  attributeType: 'enum',
  allowedValues: [],
  numericMin: '',
  numericMax: '',
  numericStep: '',
  productFilterId: '',
  isMandatory: true,
  displayOrder: 0,
  defaultValue: '',
  attributeGroup: '',
  isActive: true,
}

export function attributeRecordToFormValues(record: ConfigAttributeRow): AttributeFormValues {
  const rawAllowedValues = record.allowed_values
  let enumValues: string[] = []
  let numericMin = ''
  let numericMax = ''
  let numericStep = ''

  if (record.attribute_type === 'enum' && Array.isArray(rawAllowedValues)) {
    enumValues = rawAllowedValues as string[]
  } else if (
    record.attribute_type === 'numeric_range' &&
    rawAllowedValues &&
    typeof rawAllowedValues === 'object' &&
    !Array.isArray(rawAllowedValues)
  ) {
    const range = rawAllowedValues as { min?: number; max?: number; step?: number }
    numericMin = range.min != null ? String(range.min) : ''
    numericMax = range.max != null ? String(range.max) : ''
    numericStep = range.step != null ? String(range.step) : ''
  }

  return {
    id: record.id,
    key: record.key ?? '',
    label: record.label ?? '',
    attributeType: record.attribute_type ?? 'enum',
    allowedValues: enumValues,
    numericMin,
    numericMax,
    numericStep,
    productFilterId: record.product_filter_id ?? '',
    isMandatory: record.is_mandatory ?? true,
    displayOrder: record.display_order ?? 0,
    defaultValue: record.default_value ?? '',
    attributeGroup: record.attribute_group ?? '',
    isActive: record.is_active ?? true,
  }
}

function buildPayload(
  values: AttributeFormValues,
  productId: string,
  isCreate: boolean,
  t: Translator,
): Record<string, unknown> {
  const key = typeof values.key === 'string' ? values.key.trim() : ''
  if (!key) {
    const message = t('configurator.attributes.form.errors.key', 'Key is required')
    throw createCrudFormError(message, { key: message })
  }
  const label = typeof values.label === 'string' ? values.label.trim() : ''
  if (!label) {
    const message = t('configurator.attributes.form.errors.label', 'Label is required')
    throw createCrudFormError(message, { label: message })
  }

  const attributeType = values.attributeType || 'enum'
  let allowedValues: unknown = null

  if (attributeType === 'enum') {
    const items = (values.allowedValues ?? [])
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean)
    if (items.length > 0) {
      allowedValues = items
    }
  } else if (attributeType === 'numeric_range') {
    const min = Number(values.numericMin)
    const max = Number(values.numericMax)
    const step = Number(values.numericStep)

    const fieldErrors: Record<string, string> = {}
    if (!Number.isFinite(min)) {
      fieldErrors.numericMin = t('configurator.attributes.form.errors.numericRequired', 'Value is required')
    }
    if (!Number.isFinite(max)) {
      fieldErrors.numericMax = t('configurator.attributes.form.errors.numericRequired', 'Value is required')
    }
    if (!Number.isFinite(step) || step <= 0) {
      fieldErrors.numericStep = t('configurator.attributes.form.errors.stepPositive', 'Step must be greater than 0')
    }
    if (Number.isFinite(min) && Number.isFinite(max) && min >= max) {
      fieldErrors.numericMax = t('configurator.attributes.form.errors.maxGreaterThanMin', 'Max must be greater than Min')
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw createCrudFormError(
        t('configurator.attributes.form.errors.numericRange', 'Invalid numeric range'),
        fieldErrors,
      )
    }

    allowedValues = { min, max, step }
  }

  const payload: Record<string, unknown> = {
    productId,
    key,
    label,
    attributeType,
    allowedValues,
    productFilterId:
      (attributeType === 'product' || attributeType === 'product_variant') && values.productFilterId?.trim()
        ? values.productFilterId.trim()
        : null,
    isMandatory: values.isMandatory !== false,
    displayOrder: Number.isFinite(Number(values.displayOrder)) ? Number(values.displayOrder) : 0,
    defaultValue: values.defaultValue?.trim() || null,
    attributeGroup: values.attributeGroup?.trim() || null,
    isActive: values.isActive !== false,
  }

  if (!isCreate) {
    delete payload.productId
  }

  return payload
}

export async function submitAttributeCreate(
  values: AttributeFormValues,
  productId: string,
  t: Translator,
): Promise<void> {
  const payload = buildPayload(values, productId, true, t)
  await createCrud('configurator/manufacturing/config-attribute', payload)
}

export async function submitAttributeUpdate(
  attributeId: string,
  values: AttributeFormValues,
  productId: string,
  t: Translator,
): Promise<void> {
  const payload = buildPayload(values, productId, false, t)
  await updateCrud('configurator/manufacturing/config-attribute', { id: attributeId, ...payload })
}

const ATTRIBUTE_TYPES = ['enum', 'numeric_range', 'boolean', 'text', 'product', 'product_variant'] as const

export function buildAttributeFormFields(
  t: Translator,
  isEdit: boolean,
  currentType: string,
  onTypeChange?: (newType: string) => void,
): CrudField[] {
  const fields: CrudField[] = [
    ...(isEdit
      ? [
          {
            id: 'key',
            label: t('configurator.attributes.form.field.key', 'Key'),
            type: 'custom' as const,
            component: ({ value }: { value: unknown }) => (
              <code className="text-sm bg-muted px-2 py-1 rounded">{value as string}</code>
            ),
          },
        ]
      : [
          {
            id: 'key',
            label: t('configurator.attributes.form.field.key', 'Key'),
            type: 'text' as const,
            required: true,
            placeholder: t('configurator.attributes.form.field.keyPlaceholder', 'e.g., seat_type'),
            description: t(
              'configurator.attributes.form.field.keyHelp',
              'Snake_case identifier. Cannot be changed after creation.',
            ),
          },
        ]),
    {
      id: 'label',
      label: t('configurator.attributes.form.field.label', 'Label'),
      type: 'text',
      required: true,
      placeholder: t('configurator.attributes.form.field.labelPlaceholder', 'e.g., Seat Type'),
    },
    {
      id: 'attributeGroup',
      label: t('configurator.attributes.form.field.attributeGroup', 'Group'),
      type: 'text',
      placeholder: t('configurator.attributes.form.field.attributeGroupPlaceholder', 'e.g., Construction'),
    },
    {
      id: 'displayOrder',
      label: t('configurator.attributes.form.field.displayOrder', 'Display Order'),
      type: 'number',
    },
    {
      id: 'defaultValue',
      label: t('configurator.attributes.form.field.defaultValue', 'Default Value'),
      type: 'text',
    },
    {
      id: 'isMandatory',
      label: t('configurator.attributes.form.field.isMandatory', 'Mandatory'),
      type: 'checkbox',
    },
    {
      id: 'isActive',
      label: t('configurator.attributes.form.field.isActive', 'Active'),
      type: 'checkbox',
    },
  ]

  // --- Type selector (create) or read-only badge (edit) ---

  if (isEdit) {
    fields.push({
      id: 'attributeType',
      label: t('configurator.attributes.form.field.attributeType', 'Attribute Type'),
      type: 'custom' as const,
      component: ({ value }: { value: unknown }) => (
        <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs bg-secondary/80 text-secondary-foreground">
          {t(`configurator.attributes.enum.type.${value as string}`, value as string)}
        </span>
      ),
    })
  } else if (onTypeChange) {
    fields.push({
      id: 'attributeType',
      label: t('configurator.attributes.form.field.attributeType', 'Attribute Type'),
      type: 'custom' as const,
      required: true,
      component: ({ value, setValue }: { value: unknown; setValue: (v: unknown) => void }) => (
        <select
          value={(value as string) || 'enum'}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onChange={(e) => {
            setValue(e.target.value)
            onTypeChange(e.target.value)
          }}
        >
          {ATTRIBUTE_TYPES.map((v) => (
            <option key={v} value={v}>
              {t(`configurator.attributes.enum.type.${v}`, v)}
            </option>
          ))}
        </select>
      ),
    })
  } else {
    fields.push({
      id: 'attributeType',
      label: t('configurator.attributes.form.field.attributeType', 'Attribute Type'),
      type: 'select',
      required: true,
      options: ATTRIBUTE_TYPES.map((v) => ({
        value: v,
        label: t(`configurator.attributes.enum.type.${v}`, v),
      })),
    })
  }

  // --- Type-specific fields ---

  if (currentType === 'enum') {
    fields.push({
      id: 'allowedValues',
      label: t('configurator.attributes.form.field.allowedValues', 'Allowed Values'),
      type: 'tags',
      allowCustomValues: true,
      description: t(
        'configurator.attributes.form.field.allowedValuesHelp',
        'Type a value and press Enter to add.',
      ),
      placeholder: t('configurator.attributes.form.field.allowedValuesPlaceholder', 'e.g., SD01N'),
    })
  }

  if (currentType === 'numeric_range') {
    fields.push(
      {
        id: 'numericMin',
        label: t('configurator.attributes.form.field.numericMin', 'Min'),
        type: 'number',
        required: true,
        layout: 'third',
      },
      {
        id: 'numericMax',
        label: t('configurator.attributes.form.field.numericMax', 'Max'),
        type: 'number',
        required: true,
        layout: 'third',
      },
      {
        id: 'numericStep',
        label: t('configurator.attributes.form.field.numericStep', 'Step'),
        type: 'number',
        required: true,
        layout: 'third',
      },
    )
  }

  if (currentType === 'product' || currentType === 'product_variant') {
    fields.push({
      id: 'productFilterId',
      label: t('configurator.attributes.form.field.productFilter', 'Product Category'),
      type: 'combobox',
      placeholder: t('configurator.attributes.form.field.productFilterPlaceholder', 'Select a product category'),
      description: (
        <span className="flex items-center gap-1">
          {t(
            'configurator.attributes.form.field.productFilterHelp',
            'Filter which products or variants appear in the configurator.',
          )}
          {' '}
          <Link
            href="/backend/catalog/categories"
            target="_blank"
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
          >
            {t('configurator.attributes.form.field.manageCategories', 'Manage categories')}
            <ExternalLink className="size-3" />
          </Link>
        </span>
      ),
      loadOptions: async () => {
        try {
          const data = await readApiResultOrThrow<{
            items?: Array<{ id: string; name: string }>
          }>('/api/catalog/categories?pageSize=100&isActive=true', undefined, { errorMessage: '' })
          return [
            { value: '', label: '—' },
            ...(data?.items ?? []).map((cat) => ({ value: cat.id, label: cat.name })),
          ]
        } catch (err) {
          // Non-fatal: combobox falls back to empty. User can still save other fields.
          console.warn('[configurator] failed to load catalog categories', err)
          return [{ value: '', label: '—' }]
        }
      },
    })
  }

  return fields
}

export function buildAttributeFormGroups(t: Translator, currentType: string): CrudFormGroup[] {
  const typeSpecificFields: string[] = ['attributeType']
  if (currentType === 'enum') typeSpecificFields.push('allowedValues')
  if (currentType === 'numeric_range') typeSpecificFields.push('numericMin', 'numericMax', 'numericStep')
  if (currentType === 'product' || currentType === 'product_variant') typeSpecificFields.push('productFilterId')

  return [
    {
      id: 'identity',
      title: t('configurator.attributes.form.group.identity', 'Identity'),
      column: 1,
      fields: ['key', 'label'],
    },
    {
      id: 'typeConfig',
      title: t('configurator.attributes.form.group.typeConfig', 'Type Configuration'),
      column: 1,
      fields: typeSpecificFields,
    },
    {
      id: 'settings',
      title: t('configurator.attributes.form.group.settings', 'Settings'),
      column: 1,
      fields: ['attributeGroup', 'displayOrder', 'defaultValue', 'isMandatory', 'isActive'],
    },
  ]
}
