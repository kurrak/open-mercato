'use client'

import type { BomLineVariantRow } from '../hooks/useBomLineVariants'
import { normalizeVariantCondition } from '../lib/variant-condition-ui'

// Shape of form values — mirrors BomLineVariantCreate/Update with
// UI-friendly string types for empty-to-null conversions.
//
// Spec b §BomLineVariant Constraints requires activation XOR
// (`variant_id` OR `variant_condition`, never both). The UI toggle
// materializes which branch is active; `variantId` / `variantCondition`
// stay tracked so we don't lose user data when they toggle.
export type BomLineVariantFormValues = {
  activation: 'variant' | 'condition'
  variantId: string
  variantCondition: Record<string, string[] | { not: string[] }> | null
  quantityOverride: string
  // Product override pair — when `productOverrideId` is set, the optional
  // `productVariantOverrideId` must refer to a variant OF that product
  // (server-side drift guard enforces via assertBomLineVariantOverride-
  // BelongsToProduct).
  productOverrideId: string
  productVariantOverrideId: string
  unitOverrideId: string
  notes: string
}

export const BOM_LINE_VARIANT_DEFAULT_VALUES: BomLineVariantFormValues = {
  activation: 'variant',
  variantId: '',
  variantCondition: null,
  quantityOverride: '',
  productOverrideId: '',
  productVariantOverrideId: '',
  unitOverrideId: '',
  notes: '',
}

export function bomLineVariantToFormValues(row: BomLineVariantRow): BomLineVariantFormValues {
  // Derive activation from persisted data: whichever of variantId /
  // variantCondition is set wins. The DB CHECK constraint guarantees
  // exactly one is set on saved rows.
  const hasVariant = typeof row.variant_id === 'string' && row.variant_id.length > 0
  return {
    activation: hasVariant ? 'variant' : 'condition',
    variantId: row.variant_id ?? '',
    variantCondition: normalizeVariantCondition(row.variant_condition),
    quantityOverride: row.quantity_override != null ? String(row.quantity_override) : '',
    productOverrideId: row.product_override_id ?? '',
    productVariantOverrideId: row.product_variant_override_id ?? '',
    unitOverrideId: row.unit_override_id ?? '',
    notes: typeof row.notes === 'string' ? row.notes : '',
  }
}

// Build the shared field set (everything except `id` / `bomLineId`).
function buildSharedPayloadFields(values: BomLineVariantFormValues): Record<string, unknown> {
  const base: Record<string, unknown> = {
    quantityOverride: values.quantityOverride.trim() === '' ? null : values.quantityOverride,
    productOverrideId: emptyToNull(values.productOverrideId),
    productVariantOverrideId: emptyToNull(values.productVariantOverrideId),
    unitOverrideId: emptyToNull(values.unitOverrideId),
    notes: values.notes.trim() === '' ? null : values.notes,
  }

  // Activation XOR. The DB CHECK constraint + app-layer invariant reject
  // rows with both or neither; toggling in the UI simply chooses which
  // branch is populated on save.
  if (values.activation === 'variant') {
    base.variantId = emptyToNull(values.variantId)
    base.variantCondition = null
  } else {
    base.variantId = null
    base.variantCondition =
      values.variantCondition && Object.keys(values.variantCondition).length > 0
        ? values.variantCondition
        : null
  }

  // Product override pair: a variant override without its parent product is
  // invalid (drift guard). The UI clears the variant when the product
  // changes; here we defense-in-depth drop a stale variant override when
  // no product override is selected.
  if (base.productOverrideId == null) {
    base.productVariantOverrideId = null
  }

  return base
}

export function buildCreatePayload(
  values: BomLineVariantFormValues,
  bomLineId: string,
): Record<string, unknown> {
  return { bomLineId, ...buildSharedPayloadFields(values) }
}

export function buildUpdatePayload(
  values: BomLineVariantFormValues,
  id: string,
): Record<string, unknown> {
  // `bomLineId` deliberately omitted — update endpoint looks up by id and
  // the command ignores bomLineId on update (the row's parent is
  // immutable).
  return { id, ...buildSharedPayloadFields(values) }
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

// --------------------------------------------------------------------------
// Reactive field-clearing rules — pure helpers consumed by the dialog's
// activation toggle + product-override picker. Same pattern as
// BomLineFormConfig's clearOnLineTypeChange.
// --------------------------------------------------------------------------

export function clearOnActivationChange(next: BomLineVariantFormValues['activation']): string[] {
  // Flipping to 'variant' clears the condition editor state; flipping
  // to 'condition' clears the picked variant id. Keeps the saved
  // payload's XOR exact, not just a side-effect of the builder's branch.
  return next === 'variant' ? ['variantCondition'] : ['variantId']
}

export function clearOnProductOverrideChange(): string[] {
  // When the override product changes, any previously-picked
  // productVariantOverride belongs to the OLD product and would trip
  // the drift guard on save. Clear it.
  return ['productVariantOverrideId']
}
