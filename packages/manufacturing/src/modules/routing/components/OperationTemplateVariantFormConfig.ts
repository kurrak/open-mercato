'use client'

import type { OperationVariantRow } from '../hooks/useOperationVariants'

// Form values shape for OperationVariantDialog. Mirrors
// OperationTemplateVariantCreate/Update with UI-friendly string types for
// empty-to-null conversions.
//
// Spec c §OperationTemplateVariant requires activation XOR (`variant_id`
// OR `variant_condition`, never both) — the DB CHECK constraint + Zod
// .refine() guarantee the invariant. The UI `activation` toggle decides
// which branch is populated on save.

export type OperationVariantFormValues = {
  activation: 'variant' | 'condition'
  variantId: string
  variantCondition: Record<string, string[] | { not: string[] }> | null
  setupTimeOverride: string
  runTimeOverride: string
  teardownTimeOverride: string
  workCenterOverrideId: string
  hourlyRateOverride: string
  pieceworkRateOverride: string
  notes: string
}

export const OPERATION_VARIANT_DEFAULT_VALUES: OperationVariantFormValues = {
  activation: 'variant',
  variantId: '',
  variantCondition: null,
  setupTimeOverride: '',
  runTimeOverride: '',
  teardownTimeOverride: '',
  workCenterOverrideId: '',
  hourlyRateOverride: '',
  pieceworkRateOverride: '',
  notes: '',
}

function isVariantConditionShape(value: unknown): value is Record<string, string[] | { not: string[] }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  // Shallow validation — deep per-entry check happens on the server
  // (operationTemplateVariantCreateSchema). Here we just gate against
  // obviously broken snapshots like arrays or primitives.
  return true
}

export function operationVariantToFormValues(row: OperationVariantRow): OperationVariantFormValues {
  const hasVariant = typeof row.variant_id === 'string' && row.variant_id.length > 0
  const condition = isVariantConditionShape(row.variant_condition)
    ? (row.variant_condition as Record<string, string[] | { not: string[] }>)
    : null
  return {
    activation: hasVariant ? 'variant' : 'condition',
    variantId: row.variant_id ?? '',
    variantCondition: condition,
    setupTimeOverride: row.setup_time_override ?? '',
    runTimeOverride: row.run_time_override ?? '',
    teardownTimeOverride: row.teardown_time_override ?? '',
    workCenterOverrideId: row.work_center_override_id ?? '',
    hourlyRateOverride: row.hourly_rate_override ?? '',
    pieceworkRateOverride: row.piecework_rate_override ?? '',
    notes: row.notes ?? '',
  }
}

// Accept both strings (text inputs) and numbers (type: 'number' inputs in
// CrudForm round-trip as numbers, not strings). Empty string / null /
// undefined collapse to null; everything else gets stringified so the
// server-side numericString schema can parse it.
function emptyToNull(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return String(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length === 0 ? null : trimmed
  }
  return null
}

function buildSharedPayloadFields(values: OperationVariantFormValues): Record<string, unknown> {
  const base: Record<string, unknown> = {
    setupTimeOverride: emptyToNull(values.setupTimeOverride),
    runTimeOverride: emptyToNull(values.runTimeOverride),
    teardownTimeOverride: emptyToNull(values.teardownTimeOverride),
    workCenterOverrideId: emptyToNull(values.workCenterOverrideId),
    hourlyRateOverride: emptyToNull(values.hourlyRateOverride),
    pieceworkRateOverride: emptyToNull(values.pieceworkRateOverride),
    notes: emptyToNull(values.notes),
  }

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

  return base
}

export function buildCreatePayload(
  values: OperationVariantFormValues,
  operationTemplateId: string,
): Record<string, unknown> {
  return { operationTemplateId, ...buildSharedPayloadFields(values) }
}

export function buildUpdatePayload(
  values: OperationVariantFormValues,
  id: string,
): Record<string, unknown> {
  return { id, ...buildSharedPayloadFields(values) }
}

// Reactive clear rule — flipping activation clears the unused branch so
// the saved payload's XOR is exact, not a side effect of the builder.
export function clearOnActivationChange(next: OperationVariantFormValues['activation']): string[] {
  return next === 'variant' ? ['variantCondition'] : ['variantId']
}
