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
// BomHeader
// ---------------------------------------------------------------------------

@Entity({ tableName: 'manufacturing_bom_headers' })
@Index({
  name: 'manufacturing_bom_org_product_active_idx',
  properties: ['organizationId', 'productId', 'isActive'],
})
export class BomHeader {
  [OptionalProps]?: 'bomUsage' | 'isPhantom' | 'isActive' | 'version' | 'createdAt' | 'updatedAt' | 'deletedAt'

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

  @Property({ name: 'bom_usage', type: 'varchar', length: 20, default: 'production' })
  bomUsage: string = 'production'

  @Property({ name: 'is_phantom', type: 'boolean', default: false })
  isPhantom: boolean = false

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

  @OneToMany(() => BomLine, (line) => line.bomHeader)
  lines = new Collection<BomLine>(this)
}

// ---------------------------------------------------------------------------
// BomLine
// ---------------------------------------------------------------------------

export type BomLineType = 'material' | 'semi_product'

@Entity({ tableName: 'manufacturing_bom_lines' })
@Index({
  name: 'manufacturing_bl_header_sort_idx',
  properties: ['bomHeader', 'sortOrder'],
})
@Index({
  name: 'manufacturing_bl_org_material_idx',
  properties: ['organizationId', 'materialId'],
})
@Index({
  name: 'manufacturing_bl_header_dates_idx',
  properties: ['bomHeader', 'validFrom', 'validTo'],
})
export class BomLine {
  [OptionalProps]?: 'lineType' | 'scrapPercentage' | 'sortOrder' | 'isConsumable' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => BomHeader, {
    name: 'bom_header_id',
    fieldName: 'bom_header_id',
    referenceColumnName: 'id',
    nullable: false,
  })
  bomHeader!: BomHeader

  @Property({ name: 'line_type', type: 'text', default: 'material' })
  lineType: BomLineType = 'material'

  @Property({ name: 'material_id', type: 'uuid', nullable: true })
  materialId?: string | null

  @Property({ name: 'child_bom_header_id', type: 'uuid', nullable: true })
  childBomHeaderId?: string | null

  @Property({ name: 'net_quantity', type: 'numeric', precision: 18, scale: 4, nullable: true })
  netQuantity?: string | null

  @Property({ name: 'gross_quantity', type: 'numeric', precision: 18, scale: 4, nullable: true })
  grossQuantity?: string | null

  @Property({ name: 'scrap_percentage', type: 'numeric', precision: 5, scale: 2, default: 0 })
  scrapPercentage: string = '0'

  @Property({ name: 'uom_id', type: 'uuid', nullable: true })
  uomId?: string | null

  @Property({ name: 'variant_condition', type: 'jsonb', nullable: true })
  variantCondition?: Record<string, unknown> | null

  @Property({ name: 'operation_template_id', type: 'uuid', nullable: true })
  operationTemplateId?: string | null

  @Property({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'valid_from', type: 'date', nullable: true })
  validFrom?: Date | null

  @Property({ name: 'valid_to', type: 'date', nullable: true })
  validTo?: Date | null

  @Property({ name: 'is_consumable', type: 'boolean', default: false })
  isConsumable: boolean = false

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => BomLineVariant, (v) => v.bomLine)
  variants = new Collection<BomLineVariant>(this)
}

// ---------------------------------------------------------------------------
// BomLineVariant
// ---------------------------------------------------------------------------

@Entity({ tableName: 'manufacturing_bom_line_variants' })
@Index({
  name: 'manufacturing_blv_line_variant_idx',
  properties: ['bomLine', 'variantId'],
})
@Index({
  name: 'manufacturing_blv_line_idx',
  properties: ['bomLine'],
})
@Check({
  name: 'manufacturing_blv_variant_xor',
  expression: `("variant_id" IS NOT NULL AND "variant_condition" IS NULL) OR ("variant_id" IS NULL AND "variant_condition" IS NOT NULL)`,
})
export class BomLineVariant {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => BomLine, {
    name: 'bom_line_id',
    fieldName: 'bom_line_id',
    referenceColumnName: 'id',
    nullable: false,
  })
  bomLine!: BomLine

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Property({ name: 'variant_condition', type: 'jsonb', nullable: true })
  variantCondition?: Record<string, unknown> | null

  @Property({ name: 'quantity_override', type: 'numeric', precision: 18, scale: 4, nullable: true })
  quantityOverride?: string | null

  @Property({ name: 'material_override_id', type: 'uuid', nullable: true })
  materialOverrideId?: string | null

  @Property({ name: 'unit_override_id', type: 'uuid', nullable: true })
  unitOverrideId?: string | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
