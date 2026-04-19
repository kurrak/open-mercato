import { z } from 'zod'

const uuid = () => z.string().uuid()

const scopedSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

const numericString = () =>
  z.string().refine((v) => !isNaN(Number(v)) && v.trim().length > 0, {
    message: 'Must be a numeric value',
  })

const variantConditionSchema = z.record(
  z.string(),
  z.union([
    z.array(z.string()),
    z.object({ not: z.array(z.string()) }),
  ]),
)

// ---------------------------------------------------------------------------
// BomHeader
// ---------------------------------------------------------------------------

export const bomHeaderCreateSchema = scopedSchema.extend({
  productId: uuid(),
  name: z.string().trim().min(1).max(255),
  bomUsage: z.string().trim().min(1).max(20).default('production'),
  isPhantom: z.boolean().optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().min(1).optional(),
  notes: z.string().nullable().optional(),
})

export const bomHeaderUpdateSchema = z.object({ id: uuid() }).merge(
  scopedSchema
    .extend({
      name: z.string().trim().min(1).max(255),
      bomUsage: z.string().trim().min(1).max(20),
      isPhantom: z.boolean(),
      isActive: z.boolean(),
      version: z.number().int().min(1),
      notes: z.string().nullable(),
    })
    .partial(),
)

export type BomHeaderCreateInput = z.infer<typeof bomHeaderCreateSchema>
export type BomHeaderUpdateInput = z.infer<typeof bomHeaderUpdateSchema>

// ---------------------------------------------------------------------------
// BomLine
// ---------------------------------------------------------------------------

const lineTypes = ['material', 'semi_product'] as const

// Pure invariant checks applied to a fully-resolved BomLine state (post-merge
// for updates, raw parsed input for creates). Returns a list of violations
// carrying the offending field path so callers (Zod superRefine, form-error
// factories) can attach the error to the right input. Empty list = valid.
//
// Rules mirror spec b §Data Models — BomLine Constraints.
//
// Intentionally does NOT check the `product_variant.product_id === product_id`
// drift guard — that requires a catalog lookup and lives in the command, not
// in this pure function.
//
// Intentionally does NOT probe `productResolveKey` against ConfigAttribute.key
// — that is a warning-only save-time concern, handled at UI-side pre-save via
// POST /api/manufacturing/configurator/validate-namespace. See the UI TODO
// in commands/bom-line.ts.
export type BomLineInvariantState = {
  lineType?: string | null
  productId?: string | null
  productVariantId?: string | null
  productResolveKey?: string | null
}

export type InvariantViolation = {
  message: string
  path: string[]
}

export function collectBomLineInvariantViolations(state: BomLineInvariantState): InvariantViolation[] {
  const violations: InvariantViolation[] = []

  if (state.productResolveKey && state.productId) {
    violations.push({
      // Attach to productResolveKey — the dynamic-resolution field is the one
      // the user typically clears to unblock a statically-specified line.
      path: ['productResolveKey'],
      message:
        'A BomLine cannot carry both product_id and product_resolve_key — pick static reference or dynamic resolution, not both',
    })
  }
  if (state.productResolveKey && state.productVariantId) {
    violations.push({
      path: ['productVariantId'],
      message:
        'A BomLine with product_resolve_key cannot also pin product_variant_id — the variant is resolved at explosion time',
    })
  }
  if (state.productVariantId && !state.productId) {
    violations.push({
      path: ['productId'],
      message: 'A BomLine with product_variant_id must also set product_id (variant requires parent product)',
    })
  }
  if (state.productResolveKey && state.lineType && state.lineType !== 'material') {
    violations.push({
      path: ['productResolveKey'],
      message: `product_resolve_key is only valid on line_type = 'material' — current line_type is '${state.lineType}'`,
    })
  }

  return violations
}

const bomLineBaseSchema = {
  bomHeaderId: uuid(),
  lineType: z.enum(lineTypes).default('material'),
  productId: uuid().nullable().optional(),
  productVariantId: uuid().nullable().optional(),
  productResolveKey: z.string().trim().min(1).max(100).nullable().optional(),
  childBomHeaderId: uuid().nullable().optional(),
  netQuantity: numericString().nullable().optional(),
  grossQuantity: numericString().nullable().optional(),
  scrapPercentage: numericString().optional(),
  uomId: uuid().nullable().optional(),
  variantCondition: variantConditionSchema.nullable().optional(),
  operationTemplateId: uuid().nullable().optional(),
  sortOrder: z.number().int().optional(),
  validFrom: z.coerce.date().nullable().optional(),
  validTo: z.coerce.date().nullable().optional(),
  isConsumable: z.boolean().optional(),
  notes: z.string().nullable().optional(),
}

export const bomLineCreateSchema = scopedSchema
  .extend(bomLineBaseSchema)
  .superRefine((data, ctx) => {
    for (const violation of collectBomLineInvariantViolations(data)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: violation.message, path: violation.path })
    }
  })

// Update schemas accept partial patches — the post-merge state must still
// satisfy the invariants, but the schema alone can't see fields the caller
// didn't send. The command validates the merged state via
// collectBomLineInvariantViolations before persisting.
export const bomLineUpdateSchema = z.object({ id: uuid() }).merge(
  scopedSchema
    .extend({
      lineType: z.enum(lineTypes),
      productId: uuid().nullable(),
      productVariantId: uuid().nullable(),
      productResolveKey: z.string().trim().min(1).max(100).nullable(),
      childBomHeaderId: uuid().nullable(),
      netQuantity: numericString().nullable(),
      grossQuantity: numericString().nullable(),
      scrapPercentage: numericString(),
      uomId: uuid().nullable(),
      variantCondition: variantConditionSchema.nullable(),
      operationTemplateId: uuid().nullable(),
      sortOrder: z.number().int(),
      validFrom: z.coerce.date().nullable(),
      validTo: z.coerce.date().nullable(),
      isConsumable: z.boolean(),
      notes: z.string().nullable(),
    })
    .partial(),
)

export type BomLineCreateInput = z.infer<typeof bomLineCreateSchema>
export type BomLineUpdateInput = z.infer<typeof bomLineUpdateSchema>

// ---------------------------------------------------------------------------
// BomLineVariant
// ---------------------------------------------------------------------------

// Pure invariant checks applied to a fully-resolved BomLineVariant state.
// Mirrors the pre-existing DB CHECK (variant_id XOR variant_condition) plus
// the spec b §BomLineVariant Constraints additions for the override pair.
// Returns violations with path so callers can attach form-level errors.
//
// Does NOT check the product_variant_override.product_id === product_override_id
// drift guard — that requires a catalog lookup and lives in the command.
export type BomLineVariantInvariantState = {
  variantId?: string | null
  variantCondition?: Record<string, unknown> | null
  productOverrideId?: string | null
  productVariantOverrideId?: string | null
}

export function collectBomLineVariantInvariantViolations(
  state: BomLineVariantInvariantState,
): InvariantViolation[] {
  const violations: InvariantViolation[] = []

  const hasVariantId = state.variantId != null
  const hasVariantCondition = state.variantCondition != null
  if (hasVariantId === hasVariantCondition) {
    violations.push({
      // Preserves the path target of the original .refine before superRefine.
      path: ['variantId'],
      message: 'BomLineVariant must set exactly one of variant_id or variant_condition (activation XOR)',
    })
  }

  if (state.productVariantOverrideId && !state.productOverrideId) {
    violations.push({
      path: ['productOverrideId'],
      message:
        'product_variant_override_id requires product_override_id — cannot pin an override variant without its parent product',
    })
  }

  return violations
}

const bomLineVariantBaseSchema = {
  bomLineId: uuid(),
  variantId: uuid().nullable().optional(),
  variantCondition: variantConditionSchema.nullable().optional(),
  quantityOverride: numericString().nullable().optional(),
  productOverrideId: uuid().nullable().optional(),
  productVariantOverrideId: uuid().nullable().optional(),
  unitOverrideId: uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
}

export const bomLineVariantCreateSchema = scopedSchema
  .extend(bomLineVariantBaseSchema)
  .superRefine((data, ctx) => {
    for (const violation of collectBomLineVariantInvariantViolations(data)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: violation.message, path: violation.path })
    }
  })

export const bomLineVariantUpdateSchema = z
  .object({ id: uuid() })
  .merge(
    scopedSchema
      .extend({
        variantId: uuid().nullable(),
        variantCondition: variantConditionSchema.nullable(),
        quantityOverride: numericString().nullable(),
        productOverrideId: uuid().nullable(),
        productVariantOverrideId: uuid().nullable(),
        unitOverrideId: uuid().nullable(),
        notes: z.string().nullable(),
      })
      .partial(),
  )

export type BomLineVariantCreateInput = z.infer<typeof bomLineVariantCreateSchema>
export type BomLineVariantUpdateInput = z.infer<typeof bomLineVariantUpdateSchema>

// ---------------------------------------------------------------------------
// BOM Explosion
// ---------------------------------------------------------------------------

export const bomExplosionInputSchema = scopedSchema.extend({
  bomHeaderId: uuid(),
  variantConditions: z.record(z.string(), z.string()).optional().default({}),
  // Variant-based selection — the picked CatalogProductVariant. When set,
  // Step 3 matches BomLineVariant.variant_id directly (orthogonal path to
  // rule_based variant_condition matching). Nullable per Graceful
  // Incompleteness: `configuration_type='variant_based'` products explode
  // cleanly with no pick (no overrides match; base BomLines flow through).
  variantId: uuid().nullable().optional(),
  effectiveDate: z.coerce.date().optional(),
  maxDepth: z.number().int().min(1).max(50).optional().default(10),
})

export type BomExplosionInput = z.infer<typeof bomExplosionInputSchema>
