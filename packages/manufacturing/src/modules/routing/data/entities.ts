import {
  Entity,
  PrimaryKey,
  Property,
  Index,
  Unique,
  ManyToOne,
  OneToMany,
  Collection,
  OptionalProps,
  Check,
} from '@mikro-orm/core'

// ---------------------------------------------------------------------------
// FactoryZone
// ---------------------------------------------------------------------------

@Entity({ tableName: 'manufacturing_factory_zones' })
@Unique({
  name: 'manufacturing_fz_code_scope_unique',
  properties: ['organizationId', 'tenantId', 'code'],
})
export class FactoryZone {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'varchar', length: 255 })
  name!: string

  @Property({ type: 'varchar', length: 50 })
  code!: string

  @Property({ name: 'location_id', type: 'uuid', nullable: true })
  locationId?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ---------------------------------------------------------------------------
// WorkCenter
// ---------------------------------------------------------------------------

export type SchedulingMode = 'finite' | 'infinite'

@Entity({ tableName: 'manufacturing_work_centers' })
@Unique({
  name: 'manufacturing_wc_code_scope_unique',
  properties: ['organizationId', 'tenantId', 'code'],
})
@Index({
  name: 'manufacturing_wc_org_zone_idx',
  properties: ['organizationId', 'factoryZone'],
})
export class WorkCenter {
  [OptionalProps]?: 'capacity' | 'efficiencyPercent' | 'schedulingMode' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'varchar', length: 255 })
  name!: string

  @Property({ type: 'varchar', length: 50 })
  code!: string

  @ManyToOne(() => FactoryZone, {
    name: 'factory_zone_id',
    fieldName: 'factory_zone_id',
    referenceColumnName: 'id',
    nullable: true,
  })
  factoryZone?: FactoryZone | null

  @Property({ type: 'integer', default: 1 })
  capacity: number = 1

  @Property({ name: 'efficiency_percent', type: 'integer', default: 100 })
  efficiencyPercent: number = 100

  @Property({ name: 'scheduling_mode', type: 'text', default: 'infinite' })
  schedulingMode: SchedulingMode = 'infinite'

  @Property({ name: 'shift_calendar_id', type: 'uuid', nullable: true })
  shiftCalendarId?: string | null

  @Property({ name: 'default_hourly_rate', type: 'numeric', precision: 18, scale: 4, nullable: true })
  defaultHourlyRate?: string | null

  @Property({ name: 'overhead_rate_per_hour', type: 'numeric', precision: 18, scale: 4, nullable: true })
  overheadRatePerHour?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ---------------------------------------------------------------------------
// RoutingTemplate
// ---------------------------------------------------------------------------

@Entity({ tableName: 'manufacturing_routing_templates' })
@Index({
  name: 'manufacturing_rt_org_product_idx',
  properties: ['organizationId', 'productId'],
})
@Index({
  name: 'manufacturing_rt_org_pm_idx',
  properties: ['organizationId', 'productionMethodId'],
})
export class RoutingTemplate {
  [OptionalProps]?: 'isActive' | 'version' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'production_method_id', type: 'uuid', nullable: true })
  productionMethodId?: string | null

  @Property({ type: 'varchar', length: 255 })
  name!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ type: 'integer', default: 1 })
  version: number = 1

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => OperationTemplate, (op) => op.routingTemplate)
  operations = new Collection<OperationTemplate>(this)
}

// ---------------------------------------------------------------------------
// OperationTemplate
// ---------------------------------------------------------------------------

export type PaymentType = 'hourly' | 'piecework' | 'base_plus_piecework'

@Entity({ tableName: 'manufacturing_operation_templates' })
@Index({
  name: 'manufacturing_ot_routing_seq_idx',
  properties: ['routingTemplate', 'sequence'],
})
@Index({
  name: 'manufacturing_ot_org_wc_idx',
  properties: ['organizationId', 'workCenter'],
})
export class OperationTemplate {
  [OptionalProps]?: 'sequence' | 'paymentType' | 'isSubcontracted' | 'allowSplitting' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => RoutingTemplate, {
    name: 'routing_template_id',
    fieldName: 'routing_template_id',
    referenceColumnName: 'id',
    nullable: false,
  })
  routingTemplate!: RoutingTemplate

  @ManyToOne(() => WorkCenter, {
    name: 'work_center_id',
    fieldName: 'work_center_id',
    referenceColumnName: 'id',
    nullable: true,
  })
  workCenter?: WorkCenter | null

  @Property({ type: 'integer', default: 10 })
  sequence: number = 10

  @Property({ type: 'varchar', length: 255 })
  name!: string

  @Property({ name: 'setup_time_minutes', type: 'numeric', precision: 10, scale: 2, nullable: true })
  setupTimeMinutes?: string | null

  @Property({ name: 'run_time_minutes', type: 'numeric', precision: 10, scale: 2, nullable: true })
  runTimeMinutes?: string | null

  @Property({ name: 'teardown_time_minutes', type: 'numeric', precision: 10, scale: 2, nullable: true })
  teardownTimeMinutes?: string | null

  @Property({ name: 'queue_time_minutes', type: 'numeric', precision: 10, scale: 2, nullable: true })
  queueTimeMinutes?: string | null

  @Property({ name: 'wait_time_minutes', type: 'numeric', precision: 10, scale: 2, nullable: true })
  waitTimeMinutes?: string | null

  @Property({ name: 'move_time_minutes', type: 'numeric', precision: 10, scale: 2, nullable: true })
  moveTimeMinutes?: string | null

  @Property({ name: 'payment_type', type: 'text', default: 'hourly' })
  paymentType: PaymentType = 'hourly'

  @Property({ name: 'piecework_rate', type: 'numeric', precision: 18, scale: 4, nullable: true })
  pieceworkRate?: string | null

  @Property({ name: 'hourly_rate', type: 'numeric', precision: 18, scale: 4, nullable: true })
  hourlyRate?: string | null

  @Property({ name: 'is_subcontracted', type: 'boolean', default: false })
  isSubcontracted: boolean = false

  @Property({ name: 'allow_splitting', type: 'boolean', default: false })
  allowSplitting: boolean = false

  @Property({ name: 'max_splits', type: 'integer', nullable: true })
  maxSplits?: number | null

  @Property({ name: 'setup_group', type: 'varchar', length: 50, nullable: true })
  setupGroup?: string | null

  @Property({ type: 'text', nullable: true })
  instructions?: string | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => OperationTemplateVariant, (v) => v.operationTemplate)
  variants = new Collection<OperationTemplateVariant>(this)
}

// ---------------------------------------------------------------------------
// OperationTemplateVariant
// ---------------------------------------------------------------------------

@Entity({ tableName: 'manufacturing_operation_template_variants' })
@Index({
  name: 'manufacturing_otv_op_variant_idx',
  properties: ['operationTemplate', 'variantId'],
})
@Check({
  name: 'manufacturing_otv_variant_xor',
  expression: `("variant_id" IS NOT NULL AND "variant_condition" IS NULL) OR ("variant_id" IS NULL AND "variant_condition" IS NOT NULL)`,
})
export class OperationTemplateVariant {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => OperationTemplate, {
    name: 'operation_template_id',
    fieldName: 'operation_template_id',
    referenceColumnName: 'id',
    nullable: false,
  })
  operationTemplate!: OperationTemplate

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Property({ name: 'variant_condition', type: 'jsonb', nullable: true })
  variantCondition?: Record<string, unknown> | null

  @Property({ name: 'run_time_override', type: 'numeric', precision: 10, scale: 2, nullable: true })
  runTimeOverride?: string | null

  @Property({ name: 'setup_time_override', type: 'numeric', precision: 10, scale: 2, nullable: true })
  setupTimeOverride?: string | null

  @Property({ name: 'teardown_time_override', type: 'numeric', precision: 10, scale: 2, nullable: true })
  teardownTimeOverride?: string | null

  @Property({ name: 'work_center_override_id', type: 'uuid', nullable: true })
  workCenterOverrideId?: string | null

  @Property({ name: 'piecework_rate_override', type: 'numeric', precision: 18, scale: 4, nullable: true })
  pieceworkRateOverride?: string | null

  @Property({ name: 'hourly_rate_override', type: 'numeric', precision: 18, scale: 4, nullable: true })
  hourlyRateOverride?: string | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ---------------------------------------------------------------------------
// OperationDependency
// ---------------------------------------------------------------------------

export type DependencyType = 'finish_to_start' | 'start_to_start' | 'finish_to_finish'
export type LinkStrength = 'required' | 'optional'

@Entity({ tableName: 'manufacturing_operation_dependencies' })
@Unique({
  name: 'manufacturing_od_pred_succ_unique',
  properties: ['organizationId', 'predecessorOperation', 'successorOperation'],
})
@Index({
  name: 'manufacturing_od_pred_idx',
  properties: ['predecessorOperation'],
})
@Index({
  name: 'manufacturing_od_succ_idx',
  properties: ['successorOperation'],
})
@Check({
  name: 'manufacturing_od_overlap_xor',
  expression: `NOT ("overlap_quantity" IS NOT NULL AND "overlap_time_minutes" IS NOT NULL)`,
})
export class OperationDependency {
  [OptionalProps]?: 'dependencyType' | 'linkStrength' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => OperationTemplate, {
    name: 'predecessor_operation_id',
    fieldName: 'predecessor_operation_id',
    referenceColumnName: 'id',
    nullable: false,
  })
  predecessorOperation!: OperationTemplate

  @ManyToOne(() => OperationTemplate, {
    name: 'successor_operation_id',
    fieldName: 'successor_operation_id',
    referenceColumnName: 'id',
    nullable: false,
  })
  successorOperation!: OperationTemplate

  @Property({ name: 'dependency_type', type: 'text', default: 'finish_to_start' })
  dependencyType: DependencyType = 'finish_to_start'

  @Property({ name: 'link_strength', type: 'text', default: 'required' })
  linkStrength: LinkStrength = 'required'

  @Property({ name: 'overlap_quantity', type: 'integer', nullable: true })
  overlapQuantity?: number | null

  @Property({ name: 'overlap_time_minutes', type: 'numeric', precision: 10, scale: 2, nullable: true })
  overlapTimeMinutes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
