import { z } from 'zod'

const uuid = () => z.string().uuid()

const numericString = () =>
  z.string().refine((v) => !isNaN(Number(v)) && v.trim().length > 0, {
    message: 'Must be a numeric value',
  })

const positiveNumericString = () =>
  z.string().refine((v) => { const n = Number(v); return !isNaN(n) && n > 0 && isFinite(n) }, {
    message: 'Must be a positive numeric value',
  })

const scopedSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

// ---------------------------------------------------------------------------
// UnitOfMeasure
// ---------------------------------------------------------------------------

const uomTypes = ['piece', 'length', 'area', 'weight', 'volume', 'time'] as const

export const unitOfMeasureCreateSchema = scopedSchema.extend({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  uomType: z.enum(uomTypes),
  isActive: z.boolean().optional(),
})

export const unitOfMeasureUpdateSchema = z.object({ id: uuid() }).merge(
  scopedSchema
    .extend({
      code: z.string().trim().min(1).max(20),
      name: z.string().trim().min(1).max(100),
      uomType: z.enum(uomTypes),
      isActive: z.boolean(),
    })
    .partial(),
)

export type UnitOfMeasureCreateInput = z.infer<typeof unitOfMeasureCreateSchema>
export type UnitOfMeasureUpdateInput = z.infer<typeof unitOfMeasureUpdateSchema>

// ---------------------------------------------------------------------------
// ProductManufacturingExtension
// ---------------------------------------------------------------------------

const configurationTypes = ['none', 'variant_based', 'rule_based'] as const
const procurementTypes = ['buy', 'make', 'buy_and_make'] as const

export const productMfgExtensionUpdateSchema = z.object({ id: uuid() }).merge(
  scopedSchema
    .extend({
      configurationType: z.enum(configurationTypes),
      procurementType: z.enum(procurementTypes),
      baseUomId: uuid(),
    })
    .partial(),
)

export type ProductMfgExtensionUpdateInput = z.infer<typeof productMfgExtensionUpdateSchema>

// ---------------------------------------------------------------------------
// ProductionMethod
// ---------------------------------------------------------------------------

const lifecycleStates = ['draft', 'active', 'superseded', 'archived'] as const

export const productionMethodCreateSchema = scopedSchema.extend({
  productId: uuid(),
  name: z.string().trim().min(1).max(255),
  bomHeaderId: uuid().nullable().optional(),
  routingTemplateId: uuid().nullable().optional(),
  isDefault: z.boolean().optional(),
  variantCondition: z.record(z.string(), z.unknown()).nullable().optional(),
  version: z.number().int().min(1).optional(),
  validFrom: z.coerce.date().nullable().optional(),
  validTo: z.coerce.date().nullable().optional(),
  lifecycleState: z.enum(lifecycleStates).optional(),
})

export const productionMethodUpdateSchema = z.object({ id: uuid() }).merge(
  scopedSchema
    .extend({
      name: z.string().trim().min(1).max(255),
      bomHeaderId: uuid().nullable(),
      routingTemplateId: uuid().nullable(),
      isDefault: z.boolean(),
      variantCondition: z.record(z.string(), z.unknown()).nullable(),
      version: z.number().int().min(1),
      validFrom: z.coerce.date().nullable(),
      validTo: z.coerce.date().nullable(),
      lifecycleState: z.enum(lifecycleStates),
    })
    .partial(),
)

export type ProductionMethodCreateInput = z.infer<typeof productionMethodCreateSchema>
export type ProductionMethodUpdateInput = z.infer<typeof productionMethodUpdateSchema>

// ---------------------------------------------------------------------------
// SupplierInfo
// ---------------------------------------------------------------------------

export const supplierInfoCreateSchema = scopedSchema.extend({
  productId: uuid(),
  supplierName: z.string().trim().min(1).max(255),
  supplierId: uuid().nullable().optional(),
  supplierSku: z.string().trim().max(100).nullable().optional(),
  price: numericString().nullable().optional(),
  currency: z.string().trim().length(3).nullable().optional(),
  minQty: numericString().nullable().optional(),
  orderMultiple: numericString().nullable().optional(),
  leadTimeDays: z.number().int().min(0).nullable().optional(),
  isPreferred: z.boolean().optional(),
  validFrom: z.coerce.date().nullable().optional(),
  validTo: z.coerce.date().nullable().optional(),
  variantId: uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export const supplierInfoUpdateSchema = z.object({ id: uuid() }).merge(
  scopedSchema
    .extend({
      supplierName: z.string().trim().min(1).max(255),
      supplierId: uuid().nullable(),
      supplierSku: z.string().trim().max(100).nullable(),
      price: numericString().nullable(),
      currency: z.string().trim().length(3).nullable(),
      minQty: numericString().nullable(),
      orderMultiple: numericString().nullable(),
      leadTimeDays: z.number().int().min(0).nullable(),
      isPreferred: z.boolean(),
      validFrom: z.coerce.date().nullable(),
      validTo: z.coerce.date().nullable(),
      variantId: uuid().nullable(),
      notes: z.string().nullable(),
    })
    .partial(),
)

export type SupplierInfoCreateInput = z.infer<typeof supplierInfoCreateSchema>
export type SupplierInfoUpdateInput = z.infer<typeof supplierInfoUpdateSchema>

// ---------------------------------------------------------------------------
// UomConversion
// ---------------------------------------------------------------------------

export const uomConversionCreateSchema = scopedSchema.extend({
  productId: uuid(),
  fromUomId: uuid(),
  toUomId: uuid(),
  factor: positiveNumericString(),
})

export const uomConversionUpdateSchema = z.object({ id: uuid() }).merge(
  scopedSchema
    .extend({
      fromUomId: uuid(),
      toUomId: uuid(),
      factor: z.string().min(1),
    })
    .partial(),
)

export type UomConversionCreateInput = z.infer<typeof uomConversionCreateSchema>
export type UomConversionUpdateInput = z.infer<typeof uomConversionUpdateSchema>
