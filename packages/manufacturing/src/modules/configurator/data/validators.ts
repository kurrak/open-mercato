import { z } from 'zod'

const uuid = () => z.string().uuid()

const scopedSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

const attributeTypes = ['enum', 'numeric_range', 'boolean', 'text', 'product', 'product_variant'] as const
const actionTypes = ['restrict_values', 'exclude_combination', 'require_value', 'set_default'] as const

const variantConditionSchema = z.record(
  z.string(),
  z.union([
    z.array(z.string()),
    z.object({ not: z.array(z.string()) }),
  ]),
)

// ---------------------------------------------------------------------------
// ConfigAttribute
// ---------------------------------------------------------------------------

export const configAttributeCreateSchema = scopedSchema.extend({
  productId: uuid(),
  key: z.string().trim().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, {
    message: 'Key must be snake_case (lowercase letters, digits, underscores)',
  }),
  label: z.string().trim().min(1).max(255),
  attributeType: z.enum(attributeTypes).default('enum'),
  allowedValues: z.unknown().nullable().optional(),
  productFilterId: uuid().nullable().optional(),
  isMandatory: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
  defaultValue: z.string().max(255).nullable().optional(),
  attributeGroup: z.string().max(100).nullable().optional(),
  isActive: z.boolean().optional(),
})

export const configAttributeUpdateSchema = z.object({ id: uuid() }).merge(
  scopedSchema
    .extend({
      key: z.string().trim().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, {
        message: 'Key must be snake_case (lowercase letters, digits, underscores)',
      }),
      label: z.string().trim().min(1).max(255),
      attributeType: z.enum(attributeTypes),
      allowedValues: z.unknown().nullable(),
      productFilterId: uuid().nullable(),
      isMandatory: z.boolean(),
      displayOrder: z.number().int().min(0),
      defaultValue: z.string().max(255).nullable(),
      attributeGroup: z.string().max(100).nullable(),
      isActive: z.boolean(),
    })
    .partial(),
)

export type ConfigAttributeCreateInput = z.infer<typeof configAttributeCreateSchema>
export type ConfigAttributeUpdateInput = z.infer<typeof configAttributeUpdateSchema>

// ---------------------------------------------------------------------------
// ConstraintRule
// ---------------------------------------------------------------------------

export const constraintRuleCreateSchema = scopedSchema.extend({
  productId: uuid(),
  conditionJson: variantConditionSchema,
  actionType: z.enum(actionTypes),
  actionData: z.record(z.string(), z.unknown()),
  priority: z.number().int().min(0).optional(),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
})

export const constraintRuleUpdateSchema = z.object({ id: uuid() }).merge(
  scopedSchema
    .extend({
      conditionJson: variantConditionSchema,
      actionType: z.enum(actionTypes),
      actionData: z.record(z.string(), z.unknown()),
      priority: z.number().int().min(0),
      description: z.string().nullable(),
      isActive: z.boolean(),
    })
    .partial(),
)

export type ConstraintRuleCreateInput = z.infer<typeof constraintRuleCreateSchema>
export type ConstraintRuleUpdateInput = z.infer<typeof constraintRuleUpdateSchema>

// ---------------------------------------------------------------------------
// Configuration Resolution
// ---------------------------------------------------------------------------

export const configResolutionInputSchema = scopedSchema.extend({
  productId: uuid(),
  configSnapshot: z.record(z.string(), z.string()),
})

export type ConfigResolutionInput = z.infer<typeof configResolutionInputSchema>

// ---------------------------------------------------------------------------
// Namespace Validation
// ---------------------------------------------------------------------------

export const namespaceValidationInputSchema = scopedSchema.extend({
  productId: uuid(),
  variantCondition: z.record(z.string(), z.unknown()),
})

export type NamespaceValidationInput = z.infer<typeof namespaceValidationInputSchema>
