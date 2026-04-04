import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'

type ProductRecord = Record<string, unknown> & { id: string }

type ManufacturingSummary = {
  configuration_type: string | null
  procurement_type: string | null
  base_uom_code: string | null
  production_method_count: number
  has_suppliers: boolean
}

function getKnex(em: unknown): unknown {
  return (em as Record<string, unknown> & { getConnection: () => { getKnex: () => unknown } }).getConnection().getKnex()
}

const manufacturingEnricher: ResponseEnricher<ProductRecord> = {
  id: 'product_master.manufacturing_summary',
  targetEntity: 'catalog.product',
  features: ['product_master.view'],
  priority: 0,
  timeout: 2000,
  fallback: { _manufacturing: null },
  critical: false,

  async enrichOne(record: ProductRecord, context: EnricherContext): Promise<ProductRecord> {
    const em = context.container?.resolve?.('em')
    if (!em) return { ...record, _manufacturing: null }

    const knex = getKnex(em)
    const orgId = context.organizationId ?? record.organization_id
    const tenId = context.tenantId ?? record.tenant_id

    const ext = await (knex as any)('product_manufacturing_extensions')
      .select('configuration_type', 'procurement_type', 'base_uom_id')
      .where({ product_id: record.id, organization_id: orgId, tenant_id: tenId })
      .whereNull('deleted_at')
      .first()

    if (!ext) {
      return {
        ...record,
        _manufacturing: {
          configuration_type: null,
          procurement_type: null,
          base_uom_code: null,
          production_method_count: 0,
          has_suppliers: false,
        } satisfies ManufacturingSummary,
      }
    }

    let baseUomCode: string | null = null
    if (ext.base_uom_id) {
      const uom = await (knex as any)('manufacturing_units_of_measure')
        .select('code')
        .where({ id: ext.base_uom_id })
        .whereNull('deleted_at')
        .first()
      baseUomCode = uom?.code ?? null
    }

    const [{ count: pmCount }] = await (knex as any)('manufacturing_production_methods')
      .count('* as count')
      .where({ product_id: record.id, organization_id: orgId, tenant_id: tenId })
      .whereNull('deleted_at')

    const [{ count: siCount }] = await (knex as any)('manufacturing_supplier_infos')
      .count('* as count')
      .where({ product_id: record.id, organization_id: orgId, tenant_id: tenId })
      .whereNull('deleted_at')

    return {
      ...record,
      _manufacturing: {
        configuration_type: ext.configuration_type,
        procurement_type: ext.procurement_type,
        base_uom_code: baseUomCode,
        production_method_count: Number(pmCount),
        has_suppliers: Number(siCount) > 0,
      } satisfies ManufacturingSummary,
    }
  },

  async enrichMany(records: ProductRecord[], context: EnricherContext): Promise<ProductRecord[]> {
    const em = context.container?.resolve?.('em')
    if (!em || records.length === 0) return records

    const knex = getKnex(em)
    const productIds = records.map((r) => r.id)
    const orgId = context.organizationId ?? (records[0]?.organization_id as string)
    const tenId = context.tenantId ?? (records[0]?.tenant_id as string)

    const extensions: Array<Record<string, unknown>> = await (knex as any)('product_manufacturing_extensions')
      .select('product_id', 'configuration_type', 'procurement_type', 'base_uom_id')
      .whereIn('product_id', productIds)
      .where({ organization_id: orgId, tenant_id: tenId })
      .whereNull('deleted_at')

    const extMap = new Map<string, Record<string, unknown>>()
    const uomIds = new Set<string>()
    for (const ext of extensions) {
      extMap.set(ext.product_id as string, ext)
      if (ext.base_uom_id) uomIds.add(ext.base_uom_id as string)
    }

    const uomCodeMap = new Map<string, string>()
    if (uomIds.size > 0) {
      const uoms: Array<{ id: string; code: string }> = await (knex as any)('manufacturing_units_of_measure')
        .select('id', 'code')
        .whereIn('id', [...uomIds])
        .whereNull('deleted_at')
      for (const uom of uoms) uomCodeMap.set(uom.id, uom.code)
    }

    const pmCounts: Array<{ product_id: string; count: string }> = await (knex as any)('manufacturing_production_methods')
      .select('product_id')
      .count('* as count')
      .whereIn('product_id', productIds)
      .where({ organization_id: orgId, tenant_id: tenId })
      .whereNull('deleted_at')
      .groupBy('product_id')

    const pmCountMap = new Map<string, number>()
    for (const row of pmCounts) pmCountMap.set(row.product_id, Number(row.count))

    const siCounts: Array<{ product_id: string; count: string }> = await (knex as any)('manufacturing_supplier_infos')
      .select('product_id')
      .count('* as count')
      .whereIn('product_id', productIds)
      .where({ organization_id: orgId, tenant_id: tenId })
      .whereNull('deleted_at')
      .groupBy('product_id')

    const siCountMap = new Map<string, number>()
    for (const row of siCounts) siCountMap.set(row.product_id, Number(row.count))

    return records.map((record) => {
      const ext = extMap.get(record.id)
      const summary: ManufacturingSummary = ext
        ? {
            configuration_type: ext.configuration_type as string,
            procurement_type: ext.procurement_type as string,
            base_uom_code: ext.base_uom_id ? (uomCodeMap.get(ext.base_uom_id as string) ?? null) : null,
            production_method_count: pmCountMap.get(record.id) ?? 0,
            has_suppliers: (siCountMap.get(record.id) ?? 0) > 0,
          }
        : {
            configuration_type: null,
            procurement_type: null,
            base_uom_code: null,
            production_method_count: 0,
            has_suppliers: false,
          }
      return { ...record, _manufacturing: summary }
    })
  },
}

export const enrichers: ResponseEnricher[] = [manufacturingEnricher]
