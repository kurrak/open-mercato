import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'

export const searchConfig: SearchModuleConfig = {
  defaultStrategies: ['fulltext', 'tokens'],

  entities: [
    {
      entityId: 'routing:work_center',
      enabled: true,
      priority: 5,

      fieldPolicy: {
        searchable: ['name', 'code'],
      },

      buildSource: async (ctx: SearchBuildContext) => {
        const record = ctx.record as Record<string, unknown>
        const lines: string[] = []
        if (record.name) lines.push(`Work Center: ${record.name}`)
        if (record.code) lines.push(`Code: ${record.code}`)
        return {
          text: lines,
          presenter: {
            title: (record.name as string) ?? 'Work Center',
            subtitle: record.code as string,
            icon: 'lucide:cog',
            badge: 'Work Center',
          },
          links: [
            { href: `/backend/routing/work-centers?id=${record.id}`, label: 'View', kind: 'primary' as const },
          ],
          checksumSource: { record },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        const record = ctx.record as Record<string, unknown>
        return {
          title: (record.name as string) ?? 'Work Center',
          subtitle: record.code as string,
          icon: 'lucide:cog',
          badge: 'Work Center',
        }
      },

      resolveUrl: async (ctx) => `/backend/routing/work-centers?id=${ctx.record.id}`,
    },

    {
      entityId: 'routing:routing_template',
      enabled: true,
      priority: 5,

      fieldPolicy: {
        searchable: ['name', 'product_id'],
      },

      buildSource: async (ctx: SearchBuildContext) => {
        const record = ctx.record as Record<string, unknown>
        const lines: string[] = []
        if (record.name) lines.push(`Routing: ${record.name}`)
        return {
          text: lines,
          presenter: {
            title: (record.name as string) ?? 'Routing',
            subtitle: undefined,
            icon: 'lucide:route',
            badge: 'Routing',
          },
          links: [
            { href: `/backend/routing/templates?id=${record.id}`, label: 'View', kind: 'primary' as const },
          ],
          checksumSource: { record },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        const record = ctx.record as Record<string, unknown>
        return {
          title: (record.name as string) ?? 'Routing',
          subtitle: undefined,
          icon: 'lucide:route',
          badge: 'Routing',
        }
      },

      resolveUrl: async (ctx) => `/backend/routing/templates?id=${ctx.record.id}`,
    },
  ],
}

export const config = searchConfig
export default searchConfig
