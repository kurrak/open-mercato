'use client'

import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import type { BomLineRow } from './BomTreeView'
import { parseDisplayEntries } from '../lib/variant-condition-ui'

// Shape of form values — mirrors BomLineCreate/Update payload with UI-
// friendly types (empty string instead of null for text inputs, etc.).
// Kept flat so CrudForm's shallow state management works out-of-the-box.
//
// Note: `isPhantom` deliberately NOT in this shape. It lives on BomHeader,
// not BomLine. Editing the parent header's phantom flag from this dialog
// would require a second mutation against /api/bom/bom and is deferred
// until we revisit semi-product UX (the nested "Create BOM" mini-dialog
// exposes the flag at header-creation time).
export type BomLineFormValues = {
  lineType: 'material' | 'semi_product'
  // Static mode
  productId: string
  productVariantId: string
  // Dynamic mode — wired in a follow-up (toggle/resolve-key picker);
  // carried here so the form shape doesn't re-migrate later.
  productResolveKey: string
  // Semi-product only
  childBomHeaderId: string
  // Common
  netQuantity: string
  grossQuantity: string
  scrapPercentage: string
  uomId: string
  variantCondition: Record<string, string[] | { not: string[] }> | null
  operationTemplateId: string
  validFrom: string
  validTo: string
  isConsumable: boolean
  notes: string
}

export const BOM_LINE_DEFAULT_VALUES: BomLineFormValues = {
  lineType: 'material',
  productId: '',
  productVariantId: '',
  productResolveKey: '',
  childBomHeaderId: '',
  netQuantity: '',
  grossQuantity: '',
  scrapPercentage: '0',
  uomId: '',
  variantCondition: null,
  operationTemplateId: '',
  validFrom: '',
  validTo: '',
  isConsumable: false,
  notes: '',
}

// --------------------------------------------------------------------------
// Record ↔ form conversion — BomLineRow uses snake_case field names while
// the form keeps camelCase for CrudForm consistency.
// --------------------------------------------------------------------------

export function bomLineToFormValues(row: BomLineRow): BomLineFormValues {
  return {
    lineType: row.line_type === 'semi_product' ? 'semi_product' : 'material',
    productId: row.product_id ?? '',
    productVariantId: row.product_variant_id ?? '',
    productResolveKey: row.product_resolve_key ?? '',
    childBomHeaderId: row.child_bom_header_id ?? '',
    netQuantity: row.net_quantity != null ? String(row.net_quantity) : '',
    grossQuantity: row.gross_quantity != null ? String(row.gross_quantity) : '',
    scrapPercentage: row.scrap_percentage != null ? String(row.scrap_percentage) : '0',
    uomId: row.uom_id ?? '',
    variantCondition: normalizeVariantCondition(row.variant_condition),
    operationTemplateId: row.operation_template_id ?? '',
    validFrom: row.valid_from ? row.valid_from.slice(0, 10) : '',
    validTo: row.valid_to ? row.valid_to.slice(0, 10) : '',
    isConsumable: row.is_consumable === true,
    notes: typeof row.notes === 'string' ? row.notes : '',
  }
}

// Normalize a persisted variantCondition payload to the editor's expected
// shape. Rather than blindly casting, we route through the shared
// `parseDisplayEntries` helper so only well-formed entries survive — a
// corrupt nested shape (non-array under a key, wrong `{not: …}` payload)
// is filtered out rather than crashing the editor on mount. The server
// Zod still validates on save; this is a client-side defense-in-depth.
export function normalizeVariantCondition(raw: unknown): Record<string, string[] | { not: string[] }> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entries = parseDisplayEntries(raw as Record<string, string[] | { not: string[] }>)
  if (entries.length === 0) return null
  const out: Record<string, string[] | { not: string[] }> = {}
  for (const entry of entries) {
    out[entry.key] = entry.operator === 'not_in' ? { not: entry.values } : entry.values
  }
  return out
}

// --------------------------------------------------------------------------
// Create / Update payload builders — accept the form values and produce a
// request body for `createCrud('bom/bom-line', ...)` / `updateCrud(...)`.
// Handles string → number / string → null conversions + XOR guards that
// mirror the server-side `.superRefine` invariants (belt-and-braces — the
// server still enforces).
// --------------------------------------------------------------------------

// Build the shared field set (everything except `id` / `bomHeaderId`) —
// that split is what buildCreatePayload and buildUpdatePayload use to
// paste their own scoping fields on top.
function buildSharedPayloadFields(values: BomLineFormValues): Record<string, unknown> {
  const base: Record<string, unknown> = {
    lineType: values.lineType,
    netQuantity: values.netQuantity.trim() === '' ? null : values.netQuantity,
    grossQuantity: values.grossQuantity.trim() === '' ? null : values.grossQuantity,
    scrapPercentage: values.scrapPercentage.trim() === '' ? '0' : values.scrapPercentage,
    uomId: emptyToNull(values.uomId),
    variantCondition: values.variantCondition,
    operationTemplateId: emptyToNull(values.operationTemplateId),
    validFrom: emptyToNull(values.validFrom),
    validTo: emptyToNull(values.validTo),
    isConsumable: !!values.isConsumable,
    notes: values.notes.trim() === '' ? null : values.notes,
  }

  // Static vs Dynamic — XOR. The resolution-mode toggle in the dialog
  // flips which branch runs at UI level by clearing the opposing fields;
  // this builder is the source-of-truth backstop that reads the resulting
  // form state and emits the canonical payload shape regardless.
  if (values.productResolveKey.trim() !== '') {
    base.productId = null
    base.productVariantId = null
    base.productResolveKey = values.productResolveKey.trim()
  } else {
    base.productId = emptyToNull(values.productId)
    base.productVariantId = emptyToNull(values.productVariantId)
    base.productResolveKey = null
  }

  if (values.lineType === 'semi_product') {
    base.childBomHeaderId = emptyToNull(values.childBomHeaderId)
  } else {
    base.childBomHeaderId = null
  }

  return base
}

export function buildCreatePayload(values: BomLineFormValues, bomHeaderId: string): Record<string, unknown> {
  return { bomHeaderId, ...buildSharedPayloadFields(values) }
}

export function buildUpdatePayload(values: BomLineFormValues, id: string): Record<string, unknown> {
  // `bomHeaderId` deliberately omitted — it's immutable on update (the
  // server-side command ignores it anyway) and the update endpoint looks
  // up the row by `id`.
  return { id, ...buildSharedPayloadFields(values) }
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

// --------------------------------------------------------------------------
// Reactive field-clearing rules — pure helpers consumed by the dialog's
// lineType select + resolution-mode toggle. Kept here so the rules are
// unit-testable under the node-env jest config (the dialog's RTL coverage
// would require a jsdom-env migration, out of scope for this phase).
// --------------------------------------------------------------------------

/**
 * When the user flips lineType, which form fields must be cleared so the
 * saved payload stays valid? Without this, a Dynamic material line with a
 * stale `productResolveKey` would be submitted as `semi_product` + the
 * leftover resolve-key, which the server rejects via
 * `validators.ts` ("Resolve-key scope: semi_product lines cannot use
 * dynamic resolution").
 */
export function clearOnLineTypeChange(next: BomLineFormValues['lineType']): string[] {
  if (next === 'semi_product') {
    // semi_product does not carry a resolve-key or a pinned ProductVariant.
    return ['productResolveKey', 'productVariantId']
  }
  // material lines never reference a child BomHeader.
  return ['childBomHeaderId']
}

/**
 * When the user flips the Static / Dynamic resolution-mode toggle, which
 * form fields must be cleared so the payload-builder's XOR branch emits
 * the intended shape? (buildSharedPayloadFields already self-corrects
 * from the `productResolveKey` truthy check — this is for UI consistency.)
 */
export function clearOnResolutionModeChange(next: 'static' | 'dynamic'): string[] {
  return next === 'dynamic'
    ? ['productId', 'productVariantId', 'childBomHeaderId']
    : ['productResolveKey']
}

// --------------------------------------------------------------------------
// CrudForm field / group builders — the dialog owns most inputs via custom
// renderers (because combobox + in-place create + focus-refetch don't map
// cleanly onto the builtin `type: 'combobox'`). We expose the simple ones
// as builtin fields and let the dialog compose the rest around them.
// --------------------------------------------------------------------------

/**
 * Build the non-custom ("builtin") CrudForm fields for a BomLine dialog.
 * The dialog composes its own groups inline around these plus the
 * dialog-owned custom fields (Product / Variant / ChildBOM / UoM /
 * Operation / VariantConditionEditor / ToggleDateField).
 */
export function buildBomLineBasicFields(
  t: (key: string, fallback: string) => string,
): CrudField[] {
  // `lineType` is not included here — the dialog defines it as a `type: 'custom'`
  // field so its onChange can mirror into outer React state, which drives the
  // conditional group composition (Product+Variant vs Product+ChildBOM, and
  // the isPhantom flag visibility).
  const fields: CrudField[] = [
    {
      id: 'netQuantity',
      label: t('bom.lineForm.field.netQuantity', 'Net quantity'),
      type: 'text',
      placeholder: t('bom.lineForm.field.quantityPlaceholder', '0.0000'),
    },
    {
      id: 'grossQuantity',
      label: t('bom.lineForm.field.grossQuantity', 'Gross quantity'),
      type: 'text',
      placeholder: t('bom.lineForm.field.quantityPlaceholder', '0.0000'),
      description: t(
        'bom.lineForm.field.grossQuantityHelp',
        'Leave empty to derive from net quantity and scrap percentage.',
      ),
    },
    {
      id: 'scrapPercentage',
      label: t('bom.lineForm.field.scrap', 'Scrap %'),
      type: 'number',
    },
    // `validFrom` / `validTo` are custom-rendered in the dialog with a
    // checkbox gate — the builtin `type: 'date'` is too eager (browsers
    // auto-populate or highlight today) and gives no clear "no date" affordance.
    {
      id: 'isConsumable',
      label: t('bom.lineForm.field.isConsumable', 'Consumable material'),
      type: 'checkbox',
      description: t(
        'bom.lineForm.field.isConsumableHelp',
        'Shared across operations (e.g. glue, staples). Affects inventory reservation.',
      ),
    },
    {
      id: 'notes',
      label: t('bom.lineForm.field.notes', 'Notes'),
      type: 'textarea',
    },
  ]
  // `isPhantom` removed from the BomLine form — it's a BomHeader column,
  // not a BomLine column, so exposing it here was a dead control. The
  // child BomHeader's phantom flag is set via the "Create BOM" mini-dialog
  // or the header's own edit flow; a dedicated affordance on the parent
  // line row can be reintroduced when we wire header editing.
  return fields
}

// Note: group composition for the BomLine dialog lives inline in
// BomLineDialog.tsx — it needs references to the dialog-owned custom
// fields that can't be expressed via string ids alone. A single source
// of truth (this file) would require moving the custom fields here too,
// which would couple the form config to React primitives and break the
// pure-helpers / jest-node-env split the tests rely on.
