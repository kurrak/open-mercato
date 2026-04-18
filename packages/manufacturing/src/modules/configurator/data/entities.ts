import {
  Entity,
  PrimaryKey,
  Property,
  Index,
  Unique,
  OptionalProps,
} from '@mikro-orm/core'

// ---------------------------------------------------------------------------
// ConfigAttribute
// ---------------------------------------------------------------------------

export type AttributeType = 'enum' | 'numeric_range' | 'boolean' | 'text' | 'product' | 'product_variant'

@Entity({ tableName: 'manufacturing_config_attributes' })
@Index({ name: 'manufacturing_ca_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'manufacturing_ca_key_scope_unique', properties: ['organizationId', 'tenantId', 'productId', 'key'] })
@Index({ name: 'manufacturing_ca_org_product_order_idx', properties: ['organizationId', 'productId', 'displayOrder'] })
export class ConfigAttribute {
  [OptionalProps]?: 'attributeType' | 'isMandatory' | 'displayOrder' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ type: 'varchar', length: 100 })
  key!: string

  @Property({ type: 'varchar', length: 255 })
  label!: string

  @Property({ name: 'attribute_type', type: 'varchar', length: 20, default: "'enum'" })
  attributeType: AttributeType = 'enum'

  @Property({ name: 'allowed_values', type: 'jsonb', nullable: true })
  allowedValues?: unknown | null

  @Property({ name: 'product_filter_id', type: 'uuid', nullable: true })
  productFilterId?: string | null

  @Property({ name: 'is_mandatory', type: 'boolean', default: true })
  isMandatory: boolean = true

  @Property({ name: 'display_order', type: 'integer', default: 0 })
  displayOrder: number = 0

  @Property({ name: 'default_value', type: 'varchar', length: 255, nullable: true })
  defaultValue?: string | null

  @Property({ name: 'attribute_group', type: 'varchar', length: 100, nullable: true })
  attributeGroup?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ---------------------------------------------------------------------------
// ConstraintRule
// ---------------------------------------------------------------------------

export type ActionType = 'restrict_values' | 'exclude_combination' | 'require_value' | 'set_default'

@Entity({ tableName: 'manufacturing_constraint_rules' })
@Index({ name: 'manufacturing_cr_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'manufacturing_cr_org_product_priority_idx', properties: ['organizationId', 'productId', 'priority'] })
@Index({ name: 'manufacturing_cr_org_product_active_idx', properties: ['organizationId', 'productId', 'isActive'] })
export class ConstraintRule {
  [OptionalProps]?: 'priority' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'condition_json', type: 'jsonb' })
  conditionJson!: unknown

  @Property({ name: 'action_type', type: 'varchar', length: 30 })
  actionType!: ActionType

  @Property({ name: 'action_data', type: 'jsonb' })
  actionData!: unknown

  @Property({ type: 'integer', default: 0 })
  priority: number = 0

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
