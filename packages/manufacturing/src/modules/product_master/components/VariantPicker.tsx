'use client'

import * as React from 'react'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useCatalogVariantsForProduct } from '../../bom/hooks/useCatalogVariantsForProduct'

export type VariantPickerProps = {
  productId: string
  value: string | null
  onChange: (next: string | null) => void
  disabled?: boolean
  placeholder?: string
}

// Shared searchable CatalogProductVariant picker for variant_based products.
// Spec b §7 (BOM explosion panel) and spec c §7 (routing time rollup) both
// embed this — one component, two consumers. Deliberately thin: the heavy
// lifting (fetch + cache) is in useCatalogVariantsForProduct so a later
// consumer can replace the wrapper without touching catalog call sites.
export function VariantPicker({
  productId,
  value,
  onChange,
  disabled = false,
  placeholder,
}: VariantPickerProps) {
  const t = useT()
  const { options, isLoading, isError } = useCatalogVariantsForProduct(productId)

  const comboOptions = React.useMemo<ComboboxOption[]>(
    () =>
      options.map((opt) => ({
        value: opt.id,
        label: opt.name,
        description: opt.sku ?? undefined,
      })),
    [options],
  )

  const labelById = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const o of options) map.set(o.id, o.name)
    return map
  }, [options])

  const resolvedPlaceholder =
    placeholder ??
    (isLoading
      ? t('manufacturing.variantPicker.loading', 'Loading variants…')
      : isError
        ? t('manufacturing.variantPicker.error', 'Failed to load variants')
        : options.length === 0
          ? t('manufacturing.variantPicker.empty', 'No variants on this product')
          : t('manufacturing.variantPicker.placeholder', 'Pick a variant'))

  return (
    <ComboboxInput
      value={value ?? ''}
      onChange={(next) => onChange(next.length > 0 ? next : null)}
      suggestions={comboOptions}
      placeholder={resolvedPlaceholder}
      disabled={disabled || options.length === 0}
      resolveLabel={(v) => labelById.get(v) ?? v}
      allowCustomValues={false}
    />
  )
}

export default VariantPicker
