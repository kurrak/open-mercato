import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'

export const searchConfig: SearchModuleConfig = {
  defaultStrategies: ['fulltext', 'tokens'],

  entities: [
    {
      entityId: 'bom:bom_header',
      enabled: true,
      priority: 5,

      fieldPolicy: {
        searchable: ['name', 'product_id', 'bom_usage'],
      },

      buildSource: async (ctx: SearchBuildContext) => {
        const record = ctx.record as Record<string, unknown>
        const lines: string[] = []
        if (record.name) lines.push(`BOM: ${record.name}`)
        if (record.bom_usage) lines.push(`Usage: ${record.bom_usage}`)
        if (record.is_phantom) lines.push('Phantom: yes')
        return {
          text: lines,
          presenter: {
            title: (record.name as string) ?? 'Bill of Materials',
            subtitle: record.bom_usage as string,
            icon: 'lucide:layers',
            badge: 'BOM',
          },
          links: [
            { href: `/backend/product_master?tab=bom&id=${record.id}`, label: 'View', kind: 'primary' as const },
          ],
          checksumSource: { record },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        const record = ctx.record as Record<string, unknown>
        return {
          title: (record.name as string) ?? 'Bill of Materials',
          subtitle: record.bom_usage as string,
          icon: 'lucide:layers',
          badge: 'BOM',
        }
      },

      resolveUrl: async (ctx) => `/backend/product_master?tab=bom&id=${ctx.record.id}`,
    },
  ],
}

export const config = searchConfig
export default searchConfig
