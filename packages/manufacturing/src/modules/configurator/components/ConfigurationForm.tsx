'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ConfigAttributeRow } from './AttributeFormConfig'

export type ConfigurationFormProps = {
  productId: string
  onSubmit: (snapshot: Record<string, unknown>) => void
  submitLabel?: string
  disabled?: boolean
}

type GroupedAttributes = {
  group: string | null
  attributes: ConfigAttributeRow[]
}

function groupAttributes(attributes: ConfigAttributeRow[]): GroupedAttributes[] {
  const named = new Map<string, ConfigAttributeRow[]>()
  const ungrouped: ConfigAttributeRow[] = []

  for (const attr of attributes) {
    if (attr.attribute_group) {
      const list = named.get(attr.attribute_group) ?? []
      list.push(attr)
      named.set(attr.attribute_group, list)
    } else {
      ungrouped.push(attr)
    }
  }

  const sortByOrder = (a: ConfigAttributeRow, b: ConfigAttributeRow) =>
    a.display_order - b.display_order

  const result: GroupedAttributes[] = Array.from(named.entries()).map(
    ([group, attrs]) => ({ group, attributes: attrs.sort(sortByOrder) }),
  )

  if (ungrouped.length > 0) {
    result.push({ group: null, attributes: ungrouped.sort(sortByOrder) })
  }

  return result
}

type MaterialOption = { id: string; title: string }

export default function ConfigurationForm({
  productId,
  onSubmit,
  submitLabel,
  disabled = false,
}: ConfigurationFormProps) {
  const t = useT()
  const [attributes, setAttributes] = React.useState<ConfigAttributeRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [values, setValues] = React.useState<Record<string, unknown>>({})
  const [materialOptions, setMaterialOptions] = React.useState<Record<string, MaterialOption[]>>({})
  const [materialLoading, setMaterialLoading] = React.useState<Record<string, boolean>>({})

  // Load config attributes for the product
  React.useEffect(() => {
    if (!productId) return
    let cancelled = false
    setIsLoading(true)
    readApiResultOrThrow<{ items?: ConfigAttributeRow[] }>(
      `/api/configurator/manufacturing/config-attribute?productId=${encodeURIComponent(productId)}&pageSize=100&isActive=true&sortField=displayOrder&sortDir=asc`,
      undefined,
      { errorMessage: '' },
    )
      .then((data) => {
        if (cancelled) return
        const items = data?.items ?? []
        setAttributes(items)
        const defaults: Record<string, unknown> = {}
        for (const attr of items) {
          if (attr.default_value != null) {
            if (attr.attribute_type === 'numeric_range') {
              const num = Number(attr.default_value)
              defaults[attr.key] = Number.isFinite(num) ? num : undefined
            } else {
              defaults[attr.key] = attr.default_value
            }
          } else if (attr.attribute_type === 'boolean') {
            defaults[attr.key] = false
          }
        }
        setValues(defaults)
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[configurator] failed to load config attributes', err)
        setAttributes([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [productId])

  // Load material options for material-type attributes
  React.useEffect(() => {
    const materialAttrs = attributes.filter(
      (a) => a.attribute_type === 'material' && a.material_filter_id,
    )
    if (materialAttrs.length === 0) return

    let cancelled = false
    for (const attr of materialAttrs) {
      const categoryId = attr.material_filter_id as string
      setMaterialLoading((prev) => ({ ...prev, [attr.key]: true }))
      readApiResultOrThrow<{ items?: Array<{ id: string; title: string }> }>(
        `/api/catalog/products?categoryIds=${encodeURIComponent(categoryId)}&pageSize=100&isActive=true`,
        undefined,
        { errorMessage: '' },
      )
        .then((data) => {
          if (cancelled) return
          setMaterialOptions((prev) => ({
            ...prev,
            [attr.key]: (data?.items ?? []).map((p) => ({ id: p.id, title: p.title })),
          }))
        })
        .catch((err) => {
          if (cancelled) return
          console.warn(`[configurator] failed to load materials for ${attr.key}`, err)
          setMaterialOptions((prev) => ({ ...prev, [attr.key]: [] }))
        })
        .finally(() => {
          if (!cancelled) setMaterialLoading((prev) => ({ ...prev, [attr.key]: false }))
        })
    }
    return () => { cancelled = true }
  }, [attributes])

  const setValue = React.useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      onSubmit(values)
    },
    [onSubmit, values],
  )

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        onSubmit(values)
      }
    },
    [onSubmit, values],
  )

  if (isLoading) {
    return <LoadingMessage label={t('manufacturing.common.loading', 'Loading...')} />
  }

  if (attributes.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        {t('configurator.configForm.empty', 'No configuration attributes defined')}
      </div>
    )
  }

  const groups = groupAttributes(attributes)

  return (
    <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="space-y-6">
      {groups.map((group) =>
        group.group ? (
          <fieldset
            key={group.group}
            className="rounded-lg border bg-card p-4 space-y-3"
          >
            <legend className="px-2 text-sm font-medium text-muted-foreground">
              {group.group}
            </legend>
            {group.attributes.map((attr) => (
              <AttributeField
                key={attr.key}
                attribute={attr}
                value={values[attr.key]}
                onChange={(v) => setValue(attr.key, v)}
                disabled={disabled}
                materialOptions={materialOptions[attr.key]}
                materialLoading={materialLoading[attr.key] ?? false}
                t={t}
              />
            ))}
          </fieldset>
        ) : (
          <div key="__ungrouped" className="space-y-3">
            {group.attributes.map((attr) => (
              <AttributeField
                key={attr.key}
                attribute={attr}
                value={values[attr.key]}
                onChange={(v) => setValue(attr.key, v)}
                disabled={disabled}
                materialOptions={materialOptions[attr.key]}
                materialLoading={materialLoading[attr.key] ?? false}
                t={t}
              />
            ))}
          </div>
        ),
      )}

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={disabled}>
          {submitLabel ?? t('configurator.configForm.submit', 'Resolve')}
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Per-attribute field renderer
// ---------------------------------------------------------------------------

type AttributeFieldProps = {
  attribute: ConfigAttributeRow
  value: unknown
  onChange: (value: unknown) => void
  disabled: boolean
  materialOptions?: MaterialOption[]
  materialLoading: boolean
  t: (key: string, fallback?: string) => string
}

const selectClassName =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

function AttributeField({
  attribute,
  value,
  onChange,
  disabled,
  materialOptions,
  materialLoading,
  t,
}: AttributeFieldProps) {
  const fieldId = `config-${attribute.key}`

  return (
    <div className="space-y-1">
      <label htmlFor={fieldId} className="text-sm font-medium leading-none">
        {attribute.label}
        {attribute.is_mandatory && <span className="text-destructive ml-0.5">*</span>}
      </label>

      {attribute.attribute_type === 'enum' && (
        <select
          id={fieldId}
          className={selectClassName}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          disabled={disabled}
        >
          <option value="">
            {t('configurator.configForm.selectPlaceholder', '— Select —')}
          </option>
          {Array.isArray(attribute.allowed_values) &&
            (attribute.allowed_values as string[]).map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
        </select>
      )}

      {attribute.attribute_type === 'numeric_range' && (
        <NumericRangeInput
          fieldId={fieldId}
          allowedValues={attribute.allowed_values}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      )}

      {attribute.attribute_type === 'boolean' && (
        <div className="flex items-center gap-2 pt-1">
          <Switch
            id={fieldId}
            checked={value === true || value === 'true'}
            onCheckedChange={(checked) => onChange(checked)}
            disabled={disabled}
          />
          <span className="text-sm text-muted-foreground">
            {(value === true || value === 'true')
              ? t('configurator.configForm.booleanYes', 'Yes')
              : t('configurator.configForm.booleanNo', 'No')}
          </span>
        </div>
      )}

      {attribute.attribute_type === 'text' && (
        <Input
          id={fieldId}
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          disabled={disabled}
        />
      )}

      {attribute.attribute_type === 'material' && (
        materialLoading ? (
          <select id={fieldId} className={selectClassName} disabled>
            <option>{t('manufacturing.common.loading', 'Loading...')}</option>
          </select>
        ) : materialOptions && materialOptions.length > 0 ? (
          <ComboboxInput
            value={(value as string) ?? ''}
            onChange={(v) => onChange(v || undefined)}
            placeholder={t('configurator.configForm.materialPlaceholder', 'Search materials...')}
            suggestions={materialOptions.map((p) => ({ value: p.id, label: p.title }))}
            disabled={disabled}
          />
        ) : (
          <div className="text-sm text-muted-foreground py-2">
            {t('configurator.configForm.noMaterials', 'No materials available — check category configuration')}
          </div>
        )
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Numeric range input — extracted to avoid IIFE in JSX
// ---------------------------------------------------------------------------

function NumericRangeInput({
  fieldId,
  allowedValues,
  value,
  onChange,
  disabled,
}: {
  fieldId: string
  allowedValues: unknown
  value: unknown
  onChange: (v: unknown) => void
  disabled: boolean
}) {
  const range =
    allowedValues && typeof allowedValues === 'object' && !Array.isArray(allowedValues)
      ? (allowedValues as { min?: number; max?: number; step?: number })
      : { min: 0, max: 100, step: 1 }

  return (
    <Input
      id={fieldId}
      type="number"
      min={range.min ?? 0}
      max={range.max ?? 100}
      step={range.step ?? 1}
      value={value != null ? String(value) : ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
      disabled={disabled}
    />
  )
}
