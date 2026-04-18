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

type CatalogOption = { id: string; label: string }

type VariantListItem = {
  id?: string
  product_id?: string
  name?: string | null
  sku?: string | null
}

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
  const [productOptions, setProductOptions] = React.useState<Record<string, CatalogOption[]>>({})
  const [productLoading, setProductLoading] = React.useState<Record<string, boolean>>({})
  // For product_variant attributes only: which product is currently picked (step 1).
  // UI-only — not emitted in the submitted snapshot.
  const [productSelections, setProductSelections] = React.useState<Record<string, string>>({})
  const [variantOptions, setVariantOptions] = React.useState<Record<string, CatalogOption[]>>({})
  const [variantLoading, setVariantLoading] = React.useState<Record<string, boolean>>({})

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

  // Step 1: load product options for each 'product' / 'product_variant' attribute
  // scoped by product_filter_id. Shared across both branches.
  React.useEffect(() => {
    const dynamicAttrs = attributes.filter(
      (a) =>
        (a.attribute_type === 'product' || a.attribute_type === 'product_variant') &&
        a.product_filter_id,
    )
    if (dynamicAttrs.length === 0) return

    let cancelled = false
    for (const attr of dynamicAttrs) {
      const categoryId = attr.product_filter_id as string
      setProductLoading((prev) => ({ ...prev, [attr.key]: true }))
      readApiResultOrThrow<{ items?: Array<{ id: string; title?: string; name?: string; sku?: string }> }>(
        `/api/catalog/products?categoryIds=${encodeURIComponent(categoryId)}&pageSize=100&isActive=true`,
        undefined,
        { errorMessage: '' },
      )
        .then((data) => {
          if (cancelled) return
          setProductOptions((prev) => ({
            ...prev,
            [attr.key]: (data?.items ?? []).map((item) => ({
              id: item.id,
              label: item.title ?? item.name ?? item.sku ?? item.id,
            })),
          }))
        })
        .catch((err) => {
          if (cancelled) return
          console.warn(`[configurator] failed to load product options for ${attr.key}`, err)
          setProductOptions((prev) => ({ ...prev, [attr.key]: [] }))
        })
        .finally(() => {
          if (!cancelled) setProductLoading((prev) => ({ ...prev, [attr.key]: false }))
        })
    }
    return () => { cancelled = true }
  }, [attributes])

  // Hydration: for 'product_variant' attributes pre-filled from default_value
  // (snapshot holds only the variant UUID), recover the owning product UUID
  // so step 1 of the two-step picker can display it.
  React.useEffect(() => {
    const needsHydration = attributes.filter((a) => {
      if (a.attribute_type !== 'product_variant') return false
      const current = values[a.key]
      return typeof current === 'string' && current.length > 0 && !productSelections[a.key]
    })
    if (needsHydration.length === 0) return

    let cancelled = false
    for (const attr of needsHydration) {
      const variantId = values[attr.key] as string
      readApiResultOrThrow<{ items?: VariantListItem[] }>(
        `/api/catalog/variants?id=${encodeURIComponent(variantId)}&pageSize=1`,
        undefined,
        { errorMessage: '' },
      )
        .then((data) => {
          if (cancelled) return
          const ownerId = data?.items?.[0]?.product_id
          if (ownerId) {
            setProductSelections((prev) => ({ ...prev, [attr.key]: ownerId }))
          }
        })
        .catch((err) => {
          // Non-fatal: hydration failure leaves step 1 unselected, user can re-pick.
          console.warn(`[configurator] failed to hydrate product for variant ${variantId}`, err)
        })
    }
    return () => { cancelled = true }
  }, [attributes, values, productSelections])

  // Step 2: load variant options for any 'product_variant' attribute whose
  // step-1 product has been picked (directly by the user, or via hydration).
  React.useEffect(() => {
    const pendingFetches = attributes.filter(
      (a) =>
        a.attribute_type === 'product_variant' &&
        typeof productSelections[a.key] === 'string' &&
        productSelections[a.key].length > 0 &&
        variantOptions[a.key] === undefined,
    )
    if (pendingFetches.length === 0) return

    let cancelled = false
    for (const attr of pendingFetches) {
      const pickedProductId = productSelections[attr.key]
      setVariantLoading((prev) => ({ ...prev, [attr.key]: true }))
      readApiResultOrThrow<{ items?: VariantListItem[] }>(
        `/api/catalog/variants?productId=${encodeURIComponent(pickedProductId)}&pageSize=100&isActive=true`,
        undefined,
        { errorMessage: '' },
      )
        .then((data) => {
          if (cancelled) return
          setVariantOptions((prev) => ({
            ...prev,
            [attr.key]: (data?.items ?? []).map((item) => ({
              id: item.id as string,
              label: item.name ?? item.sku ?? (item.id as string),
            })),
          }))
        })
        .catch((err) => {
          if (cancelled) return
          console.warn(`[configurator] failed to load variants for ${attr.key}`, err)
          setVariantOptions((prev) => ({ ...prev, [attr.key]: [] }))
        })
        .finally(() => {
          if (!cancelled) setVariantLoading((prev) => ({ ...prev, [attr.key]: false }))
        })
    }
    return () => { cancelled = true }
  }, [attributes, productSelections, variantOptions])

  const setValue = React.useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleProductPick = React.useCallback((key: string, pickedProductId: string | undefined) => {
    setProductSelections((prev) => {
      const next = { ...prev }
      if (pickedProductId) next[key] = pickedProductId
      else delete next[key]
      return next
    })
    // Picking a new product invalidates the current variant choice + any cached variant list.
    setValues((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    setVariantOptions((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
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

  const renderField = (attr: ConfigAttributeRow) => (
    <AttributeField
      key={attr.key}
      attribute={attr}
      value={values[attr.key]}
      onChange={(v) => setValue(attr.key, v)}
      pickedProductId={productSelections[attr.key]}
      onProductPick={(v) => handleProductPick(attr.key, v)}
      productOptions={productOptions[attr.key]}
      productLoading={productLoading[attr.key] ?? false}
      variantOptions={variantOptions[attr.key]}
      variantLoading={variantLoading[attr.key] ?? false}
      disabled={disabled}
      t={t}
    />
  )

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
            {group.attributes.map(renderField)}
          </fieldset>
        ) : (
          <div key="__ungrouped" className="space-y-3">
            {group.attributes.map(renderField)}
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
  pickedProductId?: string
  onProductPick: (productId: string | undefined) => void
  productOptions?: CatalogOption[]
  productLoading: boolean
  variantOptions?: CatalogOption[]
  variantLoading: boolean
  disabled: boolean
  t: (key: string, fallback?: string) => string
}

const selectClassName =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

function AttributeField({
  attribute,
  value,
  onChange,
  pickedProductId,
  onProductPick,
  productOptions,
  productLoading,
  variantOptions,
  variantLoading,
  disabled,
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

      {attribute.attribute_type === 'product' && (
        productLoading ? (
          <select id={fieldId} className={selectClassName} disabled>
            <option>{t('manufacturing.common.loading', 'Loading...')}</option>
          </select>
        ) : productOptions && productOptions.length > 0 ? (
          <ComboboxInput
            value={(value as string) ?? ''}
            onChange={(v) => onChange(v || undefined)}
            placeholder={t('configurator.configForm.productPlaceholder', 'Search products...')}
            suggestions={productOptions.map((p) => ({ value: p.id, label: p.label }))}
            disabled={disabled}
          />
        ) : (
          <div className="text-sm text-muted-foreground py-2">
            {t('configurator.configForm.noProducts', 'No products available — check category configuration')}
          </div>
        )
      )}

      {attribute.attribute_type === 'product_variant' && (
        <div className="space-y-2">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">
              {t('configurator.configForm.productStepLabel', 'Product')}
            </span>
            {productLoading ? (
              <select className={selectClassName} disabled>
                <option>{t('manufacturing.common.loading', 'Loading...')}</option>
              </select>
            ) : productOptions && productOptions.length > 0 ? (
              <ComboboxInput
                value={pickedProductId ?? ''}
                onChange={(v) => onProductPick(v || undefined)}
                placeholder={t('configurator.configForm.productPlaceholder', 'Search products...')}
                suggestions={productOptions.map((p) => ({ value: p.id, label: p.label }))}
                disabled={disabled}
              />
            ) : (
              <div className="text-sm text-muted-foreground py-2">
                {t('configurator.configForm.noProducts', 'No products available — check category configuration')}
              </div>
            )}
          </div>

          {pickedProductId && (
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">
                {t('configurator.configForm.variantStepLabel', 'Variant')}
              </span>
              {variantLoading ? (
                <select className={selectClassName} disabled>
                  <option>{t('manufacturing.common.loading', 'Loading...')}</option>
                </select>
              ) : variantOptions && variantOptions.length > 0 ? (
                <ComboboxInput
                  value={(value as string) ?? ''}
                  onChange={(v) => onChange(v || undefined)}
                  placeholder={t('configurator.configForm.productVariantPlaceholder', 'Search product variants...')}
                  suggestions={variantOptions.map((v) => ({ value: v.id, label: v.label }))}
                  disabled={disabled}
                />
              ) : (
                <div className="text-sm text-muted-foreground py-2">
                  {t(
                    'configurator.configForm.noVariantsForProduct',
                    'No variants on the selected product — pick a different product',
                  )}
                </div>
              )}
            </div>
          )}
        </div>
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
