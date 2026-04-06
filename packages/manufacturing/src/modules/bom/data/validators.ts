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

export const bomLineCreateSchema = scopedSchema.extend({
  bomHeaderId: uuid(),
  lineType: z.enum(lineTypes).default('material'),
  materialId: uuid().nullable().optional(),
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
})

export const bomLineUpdateSchema = z.object({ id: uuid() }).merge(
  scopedSchema
    .extend({
      lineType: z.enum(lineTypes),
      materialId: uuid().nullable(),
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

const bomLineVariantBaseSchema = {
  bomLineId: uuid(),
  variantId: uuid().nullable().optional(),
  variantCondition: variantConditionSchema.nullable().optional(),
  quantityOverride: numericString().nullable().optional(),
  materialOverrideId: uuid().nullable().optional(),
  unitOverrideId: uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
}

export const bomLineVariantCreateSchema = scopedSchema
  .extend(bomLineVariantBaseSchema)
  .refine(
    (data) =>
      (data.variantId != null && data.variantCondition == null) ||
      (data.variantId == null && data.variantCondition != null),
    { message: 'Exactly one of variantId or variantCondition must be provided', path: ['variantId'] },
  )

export const bomLineVariantUpdateSchema = z
  .object({ id: uuid() })
  .merge(
    scopedSchema
      .extend({
        variantId: uuid().nullable(),
        variantCondition: variantConditionSchema.nullable(),
        quantityOverride: numericString().nullable(),
        materialOverrideId: uuid().nullable(),
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
  variantConditions: z.record(z.string(), z.array(z.string())).optional().default({}),
  effectiveDate: z.coerce.date().optional(),
  maxDepth: z.number().int().min(1).max(50).optional().default(10),
})

export type BomExplosionInput = z.infer<typeof bomExplosionInputSchema>
