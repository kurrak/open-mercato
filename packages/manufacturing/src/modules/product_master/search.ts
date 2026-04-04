import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'

export const searchConfig: SearchModuleConfig = {
  defaultStrategies: ['fulltext', 'tokens'],

  entities: [
    {
      entityId: 'product_master:production_method',
      enabled: true,
      priority: 5,

      fieldPolicy: {
        searchable: ['name', 'product_id', 'lifecycle_state'],
      },

      buildSource: async (ctx: SearchBuildContext) => {
        const record = ctx.record as Record<string, unknown>
        const lines: string[] = []
        if (record.name) lines.push(`Production Method: ${record.name}`)
        if (record.lifecycle_state) lines.push(`State: ${record.lifecycle_state}`)
        return {
          text: lines,
          presenter: {
            title: (record.name as string) ?? 'Production Method',
            subtitle: record.lifecycle_state as string,
            icon: 'lucide:factory',
            badge: 'Production Method',
          },
          links: [
            { href: `/backend/product_master?tab=production-methods&id=${record.id}`, label: 'View', kind: 'primary' as const },
          ],
          checksumSource: { record },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        const record = ctx.record as Record<string, unknown>
        return {
          title: (record.name as string) ?? 'Production Method',
          subtitle: record.lifecycle_state as string,
          icon: 'lucide:factory',
          badge: 'Production Method',
        }
      },

      resolveUrl: async (ctx) => `/backend/product_master?tab=production-methods&id=${ctx.record.id}`,
    },

    {
      entityId: 'product_master:supplier_info',
      enabled: true,
      priority: 3,

      fieldPolicy: {
        searchable: ['supplier_name', 'supplier_sku'],
      },

      buildSource: async (ctx: SearchBuildContext) => {
        const record = ctx.record as Record<string, unknown>
        const lines: string[] = []
        if (record.supplier_name) lines.push(`Supplier: ${record.supplier_name}`)
        if (record.supplier_sku) lines.push(`SKU: ${record.supplier_sku}`)
        return {
          text: lines,
          presenter: {
            title: (record.supplier_name as string) ?? 'Supplier',
            subtitle: record.supplier_sku as string,
            icon: 'lucide:truck',
            badge: 'Supplier Info',
          },
          links: [],
          checksumSource: { record },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        const record = ctx.record as Record<string, unknown>
        return {
          title: (record.supplier_name as string) ?? 'Supplier',
          subtitle: record.supplier_sku as string,
          icon: 'lucide:truck',
          badge: 'Supplier Info',
        }
      },
    },

    {
      entityId: 'product_master:unit_of_measure',
      enabled: true,
      priority: 2,

      fieldPolicy: {
        searchable: ['code', 'name'],
      },

      buildSource: async (ctx: SearchBuildContext) => {
        const record = ctx.record as Record<string, unknown>
        const lines: string[] = []
        if (record.name) lines.push(`UoM: ${record.name}`)
        if (record.code) lines.push(`Code: ${record.code}`)
        return {
          text: lines,
          presenter: {
            title: (record.name as string) ?? 'Unit of Measure',
            subtitle: record.code as string,
            icon: 'lucide:ruler',
            badge: 'UoM',
          },
          links: [],
          checksumSource: { record },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        const record = ctx.record as Record<string, unknown>
        return {
          title: (record.name as string) ?? 'Unit of Measure',
          subtitle: record.code as string,
          icon: 'lucide:ruler',
          badge: 'UoM',
        }
      },
    },
  ],
}

export const config = searchConfig
export default searchConfig
