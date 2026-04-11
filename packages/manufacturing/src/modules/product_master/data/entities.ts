import {
  Entity,
  PrimaryKey,
  Property,
  Index,
  Unique,
  ManyToOne,
  OptionalProps,
  Enum,
} from '@mikro-orm/core'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type ConfigurationType = 'none' | 'variant_based' | 'rule_based'
export type ProcurementType = 'buy' | 'make' | 'buy_and_make' | 'service'
export type UomType = 'piece' | 'length' | 'area' | 'weight' | 'volume' | 'time'
export type LifecycleState = 'draft' | 'active' | 'superseded' | 'archived'

// ---------------------------------------------------------------------------
// UnitOfMeasure
// ---------------------------------------------------------------------------

@Entity({ tableName: 'manufacturing_units_of_measure' })
@Index({
  name: 'manufacturing_uom_org_tenant_idx',
  properties: ['organizationId', 'tenantId'],
})
@Unique({
  name: 'manufacturing_uom_code_scope_unique',
  properties: ['organizationId', 'tenantId', 'code'],
})
export class UnitOfMeasure {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'varchar', length: 20 })
  code!: string

  @Property({ type: 'varchar', length: 100 })
  name!: string

  @Property({ name: 'uom_type', type: 'text' })
  uomType!: UomType

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
// ProductManufacturingExtension
// ---------------------------------------------------------------------------

@Entity({ tableName: 'product_manufacturing_extensions' })
@Index({
  name: 'product_mfg_ext_org_tenant_idx',
  properties: ['organizationId', 'tenantId'],
})
@Unique({
  name: 'product_mfg_ext_product_unique',
  properties: ['organizationId', 'tenantId', 'productId'],
})
export class ProductManufacturingExtension {
  [OptionalProps]?: 'configurationType' | 'procurementType' | 'isPhantomDefault' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'configuration_type', type: 'text', default: 'none' })
  configurationType: ConfigurationType = 'none'

  @Property({ name: 'procurement_type', type: 'text', default: 'buy' })
  procurementType: ProcurementType = 'buy'

  @ManyToOne(() => UnitOfMeasure, {
    fieldName: 'base_uom_id',

    nullable: false,
  })
  baseUom!: UnitOfMeasure

  @Property({ name: 'is_phantom_default', type: 'boolean', default: false })
  isPhantomDefault: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ---------------------------------------------------------------------------
// ProductionMethod
// ---------------------------------------------------------------------------

@Entity({ tableName: 'manufacturing_production_methods' })
@Index({
  name: 'manufacturing_pm_org_tenant_product_idx',
  properties: ['organizationId', 'tenantId', 'productId'],
})
@Index({
  name: 'manufacturing_pm_org_product_default_idx',
  properties: ['organizationId', 'productId', 'isDefault'],
})
@Index({
  name: 'manufacturing_pm_org_product_lifecycle_idx',
  properties: ['organizationId', 'productId', 'lifecycleState'],
})
export class ProductionMethod {
  [OptionalProps]?: 'isDefault' | 'version' | 'lifecycleState' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ type: 'varchar', length: 255 })
  name!: string

  @Property({ name: 'bom_header_id', type: 'uuid', nullable: true })
  bomHeaderId?: string | null

  @Property({ name: 'routing_template_id', type: 'uuid', nullable: true })
  routingTemplateId?: string | null

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'variant_condition', type: 'jsonb', nullable: true })
  variantCondition?: Record<string, unknown> | null

  @Property({ type: 'integer', default: 1 })
  version: number = 1

  @Property({ name: 'valid_from', type: Date, nullable: true })
  validFrom?: Date | null

  @Property({ name: 'valid_to', type: Date, nullable: true })
  validTo?: Date | null

  @Property({ name: 'lifecycle_state', type: 'text', default: 'draft' })
  lifecycleState: LifecycleState = 'draft'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ---------------------------------------------------------------------------
// SupplierInfo
// ---------------------------------------------------------------------------

@Entity({ tableName: 'manufacturing_supplier_infos' })
@Index({
  name: 'manufacturing_si_org_tenant_product_idx',
  properties: ['organizationId', 'tenantId', 'productId'],
})
@Index({
  name: 'manufacturing_si_org_product_preferred_idx',
  properties: ['organizationId', 'productId', 'isPreferred'],
})
export class SupplierInfo {
  [OptionalProps]?: 'isPreferred' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'supplier_name', type: 'varchar', length: 255 })
  supplierName!: string

  @Property({ name: 'supplier_id', type: 'uuid', nullable: true })
  supplierId?: string | null

  @Property({ name: 'supplier_sku', type: 'varchar', length: 100, nullable: true })
  supplierSku?: string | null

  @Property({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  price?: string | null

  @Property({ type: 'varchar', length: 3, nullable: true })
  currency?: string | null

  @Property({ name: 'min_qty', type: 'numeric', precision: 18, scale: 4, nullable: true })
  minQty?: string | null

  @Property({ name: 'order_multiple', type: 'numeric', precision: 18, scale: 4, nullable: true })
  orderMultiple?: string | null

  @Property({ name: 'lead_time_days', type: 'integer', nullable: true })
  leadTimeDays?: number | null

  @Property({ name: 'is_preferred', type: 'boolean', default: false })
  isPreferred: boolean = false

  @Property({ name: 'valid_from', type: Date, nullable: true })
  validFrom?: Date | null

  @Property({ name: 'valid_to', type: Date, nullable: true })
  validTo?: Date | null

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'last_purchase_price', type: 'numeric', precision: 18, scale: 4, nullable: true })
  lastPurchasePrice?: string | null

  @Property({ name: 'last_purchase_date', type: Date, nullable: true })
  lastPurchaseDate?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ---------------------------------------------------------------------------
// UomConversion
// ---------------------------------------------------------------------------

@Entity({ tableName: 'manufacturing_uom_conversions' })
@Index({
  name: 'manufacturing_uc_org_tenant_product_idx',
  properties: ['organizationId', 'tenantId', 'productId'],
})
@Unique({
  name: 'manufacturing_uc_product_from_to_unique',
  properties: ['organizationId', 'tenantId', 'productId', 'fromUom', 'toUom'],
})
export class UomConversion {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @ManyToOne(() => UnitOfMeasure, {
    fieldName: 'from_uom_id',

    nullable: false,
  })
  fromUom!: UnitOfMeasure

  @ManyToOne(() => UnitOfMeasure, {
    fieldName: 'to_uom_id',

    nullable: false,
  })
  toUom!: UnitOfMeasure

  @Property({ type: 'numeric', precision: 24, scale: 12 })
  factor!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
