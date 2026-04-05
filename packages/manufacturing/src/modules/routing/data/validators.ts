import { z } from 'zod'

const uuid = () => z.string().uuid()
const scopedSchema = z.object({ organizationId: uuid(), tenantId: uuid() })

const numericString = () =>
  z.string().refine((v) => !isNaN(Number(v)) && v.trim().length > 0, { message: 'Must be a numeric value' })

const variantConditionSchema = z.record(
  z.string(),
  z.union([z.array(z.string()), z.object({ not: z.array(z.string()) })]),
)

// ---------------------------------------------------------------------------
// FactoryZone
// ---------------------------------------------------------------------------

export const factoryZoneCreateSchema = scopedSchema.extend({
  name: z.string().trim().min(1).max(255),
  code: z.string().trim().min(1).max(50),
  locationId: uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().nullable().optional(),
})

export const factoryZoneUpdateSchema = z.object({ id: uuid() }).merge(
  scopedSchema.extend({
    name: z.string().trim().min(1).max(255),
    code: z.string().trim().min(1).max(50),
    locationId: uuid().nullable(),
    isActive: z.boolean(),
    notes: z.string().nullable(),
  }).partial(),
)

export type FactoryZoneCreateInput = z.infer<typeof factoryZoneCreateSchema>
export type FactoryZoneUpdateInput = z.infer<typeof factoryZoneUpdateSchema>

// ---------------------------------------------------------------------------
// WorkCenter
// ---------------------------------------------------------------------------

const schedulingModes = ['finite', 'infinite'] as const

export const workCenterCreateSchema = scopedSchema.extend({
  name: z.string().trim().min(1).max(255),
  code: z.string().trim().min(1).max(50),
  factoryZoneId: uuid().nullable().optional(),
  capacity: z.number().int().min(1).optional(),
  efficiencyPercent: z.number().int().min(1).max(200).optional(),
  schedulingMode: z.enum(schedulingModes).optional(),
  shiftCalendarId: uuid().nullable().optional(),
  defaultHourlyRate: numericString().nullable().optional(),
  overheadRatePerHour: numericString().nullable().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().nullable().optional(),
})

export const workCenterUpdateSchema = z.object({ id: uuid() }).merge(
  scopedSchema.extend({
    name: z.string().trim().min(1).max(255),
    code: z.string().trim().min(1).max(50),
    factoryZoneId: uuid().nullable(),
    capacity: z.number().int().min(1),
    efficiencyPercent: z.number().int().min(1).max(200),
    schedulingMode: z.enum(schedulingModes),
    shiftCalendarId: uuid().nullable(),
    defaultHourlyRate: numericString().nullable(),
    overheadRatePerHour: numericString().nullable(),
    isActive: z.boolean(),
    notes: z.string().nullable(),
  }).partial(),
)

export type WorkCenterCreateInput = z.infer<typeof workCenterCreateSchema>
export type WorkCenterUpdateInput = z.infer<typeof workCenterUpdateSchema>

// ---------------------------------------------------------------------------
// RoutingTemplate
// ---------------------------------------------------------------------------

export const routingTemplateCreateSchema = scopedSchema.extend({
  productId: uuid(),
  productionMethodId: uuid().nullable().optional(),
  name: z.string().trim().min(1).max(255),
  isActive: z.boolean().optional(),
  version: z.number().int().min(1).optional(),
  notes: z.string().nullable().optional(),
})

export const routingTemplateUpdateSchema = z.object({ id: uuid() }).merge(
  scopedSchema.extend({
    productionMethodId: uuid().nullable(),
    name: z.string().trim().min(1).max(255),
    isActive: z.boolean(),
    version: z.number().int().min(1),
    notes: z.string().nullable(),
  }).partial(),
)

export type RoutingTemplateCreateInput = z.infer<typeof routingTemplateCreateSchema>
export type RoutingTemplateUpdateInput = z.infer<typeof routingTemplateUpdateSchema>

// ---------------------------------------------------------------------------
// OperationTemplate
// ---------------------------------------------------------------------------

const paymentTypes = ['hourly', 'piecework', 'base_plus_piecework'] as const

export const operationTemplateCreateSchema = scopedSchema.extend({
  routingTemplateId: uuid(),
  workCenterId: uuid().nullable().optional(),
  sequence: z.number().int().min(1).optional(),
  name: z.string().trim().min(1).max(255),
  setupTimeMinutes: numericString().nullable().optional(),
  runTimeMinutes: numericString().nullable().optional(),
  teardownTimeMinutes: numericString().nullable().optional(),
  queueTimeMinutes: numericString().nullable().optional(),
  waitTimeMinutes: numericString().nullable().optional(),
  moveTimeMinutes: numericString().nullable().optional(),
  paymentType: z.enum(paymentTypes).optional(),
  pieceworkRate: numericString().nullable().optional(),
  hourlyRate: numericString().nullable().optional(),
  isSubcontracted: z.boolean().optional(),
  allowSplitting: z.boolean().optional(),
  maxSplits: z.number().int().min(1).nullable().optional(),
  setupGroup: z.string().trim().max(50).nullable().optional(),
  instructions: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export const operationTemplateUpdateSchema = z.object({ id: uuid() }).merge(
  scopedSchema.extend({
    workCenterId: uuid().nullable(),
    sequence: z.number().int().min(1),
    name: z.string().trim().min(1).max(255),
    setupTimeMinutes: numericString().nullable(),
    runTimeMinutes: numericString().nullable(),
    teardownTimeMinutes: numericString().nullable(),
    queueTimeMinutes: numericString().nullable(),
    waitTimeMinutes: numericString().nullable(),
    moveTimeMinutes: numericString().nullable(),
    paymentType: z.enum(paymentTypes),
    pieceworkRate: numericString().nullable(),
    hourlyRate: numericString().nullable(),
    isSubcontracted: z.boolean(),
    allowSplitting: z.boolean(),
    maxSplits: z.number().int().min(1).nullable(),
    setupGroup: z.string().trim().max(50).nullable(),
    instructions: z.string().nullable(),
    notes: z.string().nullable(),
  }).partial(),
)

export type OperationTemplateCreateInput = z.infer<typeof operationTemplateCreateSchema>
export type OperationTemplateUpdateInput = z.infer<typeof operationTemplateUpdateSchema>

// ---------------------------------------------------------------------------
// OperationTemplateVariant
// ---------------------------------------------------------------------------

export const operationTemplateVariantCreateSchema = scopedSchema
  .extend({
    operationTemplateId: uuid(),
    variantId: uuid().nullable().optional(),
    variantCondition: variantConditionSchema.nullable().optional(),
    runTimeOverride: numericString().nullable().optional(),
    setupTimeOverride: numericString().nullable().optional(),
    teardownTimeOverride: numericString().nullable().optional(),
    workCenterOverrideId: uuid().nullable().optional(),
    pieceworkRateOverride: numericString().nullable().optional(),
    hourlyRateOverride: numericString().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .refine(
    (data) =>
      (data.variantId != null && data.variantCondition == null) ||
      (data.variantId == null && data.variantCondition != null),
    { message: 'Exactly one of variantId or variantCondition must be provided', path: ['variantId'] },
  )

export const operationTemplateVariantUpdateSchema = z.object({ id: uuid() }).merge(
  scopedSchema.extend({
    variantId: uuid().nullable(),
    variantCondition: variantConditionSchema.nullable(),
    runTimeOverride: numericString().nullable(),
    setupTimeOverride: numericString().nullable(),
    teardownTimeOverride: numericString().nullable(),
    workCenterOverrideId: uuid().nullable(),
    pieceworkRateOverride: numericString().nullable(),
    hourlyRateOverride: numericString().nullable(),
    notes: z.string().nullable(),
  }).partial(),
)

export type OperationTemplateVariantCreateInput = z.infer<typeof operationTemplateVariantCreateSchema>
export type OperationTemplateVariantUpdateInput = z.infer<typeof operationTemplateVariantUpdateSchema>

// ---------------------------------------------------------------------------
// OperationDependency
// ---------------------------------------------------------------------------

const dependencyTypes = ['finish_to_start', 'start_to_start', 'finish_to_finish'] as const
const linkStrengths = ['required', 'optional'] as const

export const operationDependencyCreateSchema = scopedSchema
  .extend({
    predecessorOperationId: uuid(),
    successorOperationId: uuid(),
    dependencyType: z.enum(dependencyTypes).optional(),
    linkStrength: z.enum(linkStrengths).optional(),
    overlapQuantity: z.number().int().min(1).nullable().optional(),
    overlapTimeMinutes: numericString().nullable().optional(),
  })
  .refine(
    (data) => data.predecessorOperationId !== data.successorOperationId,
    { message: 'Predecessor and successor must be different operations', path: ['successorOperationId'] },
  )
  .refine(
    (data) => !(data.overlapQuantity != null && data.overlapTimeMinutes != null),
    { message: 'overlapQuantity and overlapTimeMinutes are mutually exclusive', path: ['overlapQuantity'] },
  )

export const operationDependencyUpdateSchema = z.object({ id: uuid() }).merge(
  scopedSchema.extend({
    dependencyType: z.enum(dependencyTypes),
    linkStrength: z.enum(linkStrengths),
    overlapQuantity: z.number().int().min(1).nullable(),
    overlapTimeMinutes: numericString().nullable(),
  }).partial(),
).refine(
  (data) => !(data.overlapQuantity != null && data.overlapTimeMinutes != null),
  { message: 'overlapQuantity and overlapTimeMinutes are mutually exclusive', path: ['overlapQuantity'] },
)

export type OperationDependencyCreateInput = z.infer<typeof operationDependencyCreateSchema>
export type OperationDependencyUpdateInput = z.infer<typeof operationDependencyUpdateSchema>
