import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'

export const searchConfig: SearchModuleConfig = {
  defaultStrategies: ['fulltext', 'tokens'],

  entities: [
    {
      entityId: 'configurator:config_attribute',
      enabled: true,
      priority: 5,

      fieldPolicy: {
        searchable: ['key', 'label', 'attribute_group', 'product_id'],
      },

      buildSource: async (ctx: SearchBuildContext) => {
        const record = ctx.record as Record<string, unknown>
        const lines: string[] = []
        if (record.label) lines.push(`Attribute: ${record.label}`)
        if (record.key) lines.push(`Key: ${record.key}`)
        if (record.attribute_group) lines.push(`Group: ${record.attribute_group}`)
        if (record.attribute_type) lines.push(`Type: ${record.attribute_type}`)
        return {
          text: lines,
          presenter: {
            title: (record.label as string) ?? 'Config Attribute',
            subtitle: record.key as string,
            icon: 'lucide:settings-2',
            badge: 'Configurator',
          },
          links: [
            { href: `/backend/product_master?tab=configurator&id=${record.product_id}`, label: 'View', kind: 'primary' as const },
          ],
          checksumSource: { record },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        const record = ctx.record as Record<string, unknown>
        return {
          title: (record.label as string) ?? 'Config Attribute',
          subtitle: record.key as string,
          icon: 'lucide:settings-2',
          badge: 'Configurator',
        }
      },

      resolveUrl: async (ctx) => `/backend/product_master?tab=configurator&id=${ctx.record.product_id}`,
    },
  ],
}

export const config = searchConfig
export default searchConfig
