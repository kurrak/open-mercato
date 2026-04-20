'use client'

import type { OperationRow } from '../hooks/useOperationsForRouting'

// Form values shape for OperationDialog. Mirrors OperationCreate/Update
// payload with UI-friendly types (empty strings for numeric inputs; null
// on payload build). `sequence` is not exposed as a direct input — server
// auto-assigns max(sequence)+10 on create; the reorder arrows in the
// operations table handle changes.

export type OperationFormValues = {
  name: string
  workCenterId: string
  setupTimeMinutes: string
  runTimeMinutes: string
  teardownTimeMinutes: string
  waitTimeMinutes: string
  moveTimeMinutes: string
  paymentType: 'hourly' | 'piecework' | 'base_plus_piecework'
  hourlyRate: string
  pieceworkRate: string
  isSubcontracted: boolean
  notes: string
}

export const OPERATION_DEFAULT_VALUES: OperationFormValues = {
  name: '',
  workCenterId: '',
  setupTimeMinutes: '',
  runTimeMinutes: '',
  teardownTimeMinutes: '',
  waitTimeMinutes: '',
  moveTimeMinutes: '',
  paymentType: 'hourly',
  hourlyRate: '',
  pieceworkRate: '',
  isSubcontracted: false,
  notes: '',
}

export function operationRowToFormValues(row: OperationRow): OperationFormValues {
  const payment = row.payment_type === 'hourly' || row.payment_type === 'piecework' || row.payment_type === 'base_plus_piecework'
    ? row.payment_type
    : 'hourly'
  return {
    name: row.name ?? '',
    workCenterId: row.work_center_id ?? '',
    setupTimeMinutes: row.setup_time_minutes ?? '',
    runTimeMinutes: row.run_time_minutes ?? '',
    teardownTimeMinutes: row.teardown_time_minutes ?? '',
    waitTimeMinutes: row.wait_time_minutes ?? '',
    moveTimeMinutes: row.move_time_minutes ?? '',
    paymentType: payment,
    hourlyRate: row.hourly_rate ?? '',
    pieceworkRate: row.piecework_rate ?? '',
    isSubcontracted: row.is_subcontracted === true,
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

// Payment-type-driven rate handling:
// - 'hourly' → keep hourlyRate, clear pieceworkRate
// - 'piecework' → keep pieceworkRate, clear hourlyRate
// - 'base_plus_piecework' → keep both
// Matches the reactive rate fields on the dialog (spec §4 rate column rule:
// render the rate matching payment_type; stacked for base_plus_piecework).
function rateForPaymentType(values: OperationFormValues): { hourlyRate: string | null; pieceworkRate: string | null } {
  if (values.paymentType === 'hourly') {
    return { hourlyRate: emptyToNull(values.hourlyRate), pieceworkRate: null }
  }
  if (values.paymentType === 'piecework') {
    return { hourlyRate: null, pieceworkRate: emptyToNull(values.pieceworkRate) }
  }
  return { hourlyRate: emptyToNull(values.hourlyRate), pieceworkRate: emptyToNull(values.pieceworkRate) }
}

export function buildCreatePayload(
  values: OperationFormValues,
  routingTemplateId: string,
): Record<string, unknown> {
  const { hourlyRate, pieceworkRate } = rateForPaymentType(values)
  return {
    routingTemplateId,
    name: values.name.trim(),
    workCenterId: values.workCenterId.length > 0 ? values.workCenterId : null,
    setupTimeMinutes: emptyToNull(values.setupTimeMinutes),
    runTimeMinutes: emptyToNull(values.runTimeMinutes),
    teardownTimeMinutes: emptyToNull(values.teardownTimeMinutes),
    waitTimeMinutes: emptyToNull(values.waitTimeMinutes),
    moveTimeMinutes: emptyToNull(values.moveTimeMinutes),
    paymentType: values.paymentType,
    hourlyRate,
    pieceworkRate,
    isSubcontracted: values.isSubcontracted,
    notes: emptyToNull(values.notes),
  }
}

export function buildUpdatePayload(
  values: OperationFormValues,
  id: string,
): Record<string, unknown> {
  const { hourlyRate, pieceworkRate } = rateForPaymentType(values)
  return {
    id,
    name: values.name.trim(),
    workCenterId: values.workCenterId.length > 0 ? values.workCenterId : null,
    setupTimeMinutes: emptyToNull(values.setupTimeMinutes),
    runTimeMinutes: emptyToNull(values.runTimeMinutes),
    teardownTimeMinutes: emptyToNull(values.teardownTimeMinutes),
    waitTimeMinutes: emptyToNull(values.waitTimeMinutes),
    moveTimeMinutes: emptyToNull(values.moveTimeMinutes),
    paymentType: values.paymentType,
    hourlyRate,
    pieceworkRate,
    isSubcontracted: values.isSubcontracted,
    notes: emptyToNull(values.notes),
  }
}
