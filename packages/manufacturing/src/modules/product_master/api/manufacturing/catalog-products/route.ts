import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { ProductManufacturingExtension, ProductionMethod, UnitOfMeasure } from '../../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['product_master.view'] },
}

const listQuerySchema = z.object({
  enrolled: z
    .union([z.literal('true'), z.literal('false')])
    .default('true'),
  id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).optional(),
  sortBy: z.enum(['title', 'sku', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
})

type ParsedQuery = z.infer<typeof listQuerySchema>

type CatalogProductShape = {
  id: string
  title: string
  sku: string | null
  createdAt: Date
}

const sortFieldMap: Record<NonNullable<ParsedQuery['sortBy']>, keyof CatalogProductShape> = {
  title: 'title',
  sku: 'sku',
  createdAt: 'createdAt',
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      throw new CrudHttpError(401, { error: translate('manufacturing.errors.unauthorized', 'Unauthorized') })
    }
    const organizationId = auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, {
        error: translate('manufacturing.errors.organization_required', 'Organization context is required'),
      })
    }

    const url = new URL(req.url)
    const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
    if (!parsed.success) {
      throw new CrudHttpError(400, {
        error: translate('manufacturing.errors.invalid_query', 'Invalid query parameters'),
      })
    }
    const { enrolled, id: filterId, page, pageSize, search, sortBy, sortOrder } = parsed.data

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()

    // Fetch the full set of manufacturing-enrolled product ids for this tenant/org,
    // scoped by soft-delete. This is an in-module query (ProductManufacturingExtension
    // lives in packages/manufacturing) so it stays within the module's own data layer.
    const extensionRows = await em.find(
      ProductManufacturingExtension,
      { organizationId, tenantId: auth.tenantId, deletedAt: null },
      {
        fields: [
          'id',
          'productId',
          'configurationType',
          'procurementType',
          'baseUom',
          'isPhantomDefault',
        ] as const,
      },
    )

    const enrolledIds = new Set<string>()
    const extensionByProductId = new Map<
      string,
      {
        id: string
        configurationType: string
        procurementType: string
        baseUomId: string | null
        isPhantomDefault: boolean
      }
    >()
    for (const ext of extensionRows) {
      enrolledIds.add(ext.productId)
      const baseUomRef = (ext as unknown as { baseUom?: { id?: string } | string | null }).baseUom
      const baseUomId =
        typeof baseUomRef === 'string'
          ? baseUomRef
          : baseUomRef && typeof baseUomRef === 'object' && 'id' in baseUomRef
            ? (baseUomRef.id ?? null)
            : null
      extensionByProductId.set(ext.productId, {
        id: ext.id,
        configurationType: ext.configurationType,
        procurementType: ext.procurementType,
        baseUomId,
        isPhantomDefault: ext.isPhantomDefault ?? false,
      })
    }

    const uomIds = Array.from(
      new Set(
        Array.from(extensionByProductId.values())
          .map((ext) => ext.baseUomId)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      ),
    )
    const uomCodeById = new Map<string, string>()
    if (uomIds.length > 0) {
      const uomRows = await em.find(
        UnitOfMeasure,
        { id: { $in: uomIds }, deletedAt: null },
        { fields: ['id', 'code'] as const },
      )
      for (const uom of uomRows) {
        uomCodeById.set(uom.id, uom.code)
      }
    }

    const productWhere: FilterQuery<CatalogProduct> = {
      organizationId,
      tenantId: auth.tenantId,
      deletedAt: null,
    } as FilterQuery<CatalogProduct>
    if (enrolled === 'true') {
      if (enrolledIds.size === 0) {
        return NextResponse.json({
          items: [],
          total: 0,
          page,
          pageSize,
          totalPages: 1,
        })
      }
      ;(productWhere as Record<string, unknown>).id = { $in: Array.from(enrolledIds) }
    } else if (enrolledIds.size > 0) {
      // TODO(scale): the picker's $nin list grows linearly with the enrolled-product
      // count. Past ~1k enrolled products the statement size + PG query-plan cache
      // churn become noticeable; at that point switch to a server-side LEFT JOIN /
      // NOT EXISTS anti-join (e.g. via em.getKnex() or a raw subquery) instead of
      // materialising the id set in JS. See spec §"Picker at scale" note.
      ;(productWhere as Record<string, unknown>).id = { $nin: Array.from(enrolledIds) }
    }
    if (filterId) {
      const currentIdFilter = (productWhere as Record<string, unknown>).id as
        | { $in?: string[]; $nin?: string[] }
        | undefined
      if (currentIdFilter && Array.isArray(currentIdFilter.$in)) {
        ;(productWhere as Record<string, unknown>).id = currentIdFilter.$in.includes(filterId)
          ? filterId
          : { $in: [] }
      } else if (currentIdFilter && Array.isArray(currentIdFilter.$nin)) {
        ;(productWhere as Record<string, unknown>).id = currentIdFilter.$nin.includes(filterId)
          ? { $in: [] }
          : filterId
      } else {
        ;(productWhere as Record<string, unknown>).id = filterId
      }
    }
    if (search) {
      const like = `%${escapeLikePattern(search)}%`
      ;(productWhere as Record<string, unknown>).$or = [
        { title: { $ilike: like } },
        { sku: { $ilike: like } },
      ]
    }

    const sortField = sortBy ? sortFieldMap[sortBy] : 'title'
    const sortDir = sortOrder ?? 'asc'
    const orderBy = { [sortField]: sortDir } as Record<string, 'asc' | 'desc'>

    // TODO(encryption): CatalogProduct has no encrypted columns today, so a raw
    // findAndCount is safe. If catalog ever adds encrypted scalars, switch this
    // read to findWithDecryption (or a scoped catalog helper) so encrypted
    // fields decrypt correctly in the manufacturing response.
    const [products, total] = await em.findAndCount(CatalogProduct, productWhere, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy,
      fields: ['id', 'title', 'sku', 'createdAt'] as const,
    })

    const pageProductIds = products
      .map((product) => product.id)
      .filter((productId) => enrolledIds.has(productId))
    const productionMethodCountByProductId = new Map<string, number>()
    if (pageProductIds.length > 0) {
      const pmRows = await em.find(
        ProductionMethod,
        {
          organizationId,
          tenantId: auth.tenantId,
          productId: { $in: pageProductIds },
          deletedAt: null,
        },
        { fields: ['productId'] as const },
      )
      for (const row of pmRows) {
        const current = productionMethodCountByProductId.get(row.productId) ?? 0
        productionMethodCountByProductId.set(row.productId, current + 1)
      }
    }

    const items = products.map((product) => {
      const ext = extensionByProductId.get(product.id)
      return {
        id: product.id,
        title: product.title,
        sku: product.sku ?? null,
        manufacturing_extension_id: ext?.id ?? null,
        _manufacturing: ext
          ? {
              configuration_type: ext.configurationType,
              procurement_type: ext.procurementType,
              base_uom_id: ext.baseUomId,
              base_uom_code: ext.baseUomId ? (uomCodeById.get(ext.baseUomId) ?? null) : null,
              is_phantom_default: ext.isPhantomDefault,
              production_method_count: productionMethodCountByProductId.get(product.id) ?? 0,
            }
          : null,
      }
    })

    return NextResponse.json({
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('manufacturing.catalog-products.get failed', err)
    return NextResponse.json(
      {
        error: translate(
          'manufacturing.errors.internal_server_error',
          'Internal server error',
        ),
      },
      { status: 500 },
    )
  }
}

const itemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  sku: z.string().nullable(),
  manufacturing_extension_id: z.string().uuid().nullable(),
  _manufacturing: z
    .object({
      configuration_type: z.string().nullable(),
      procurement_type: z.string().nullable(),
      base_uom_id: z.string().uuid().nullable(),
      base_uom_code: z.string().nullable(),
      is_phantom_default: z.boolean(),
      production_method_count: z.number().int().nonnegative(),
    })
    .nullable(),
})

const listResponseSchema = z.object({
  items: z.array(itemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing Product Master',
  summary: 'List catalog products enrolled (or not) in manufacturing',
  methods: {
    GET: {
      summary: 'List catalog products joined with manufacturing extension',
      description:
        'Returns a page of catalog products with their manufacturing extension status. Use `?enrolled=true` (default) for the manufacturing products list, or `?enrolled=false` to show catalog products that do not yet have a manufacturing extension (picker). Implementation: reads the manufacturing extension set and then performs a cross-module MikroORM read against `CatalogProduct` narrowed by the resolved id set. This is a deliberate cross-module ORM read (not a federated/enricher round-trip) to keep detail-page load at a single round trip — tenant scoping is enforced on both queries.',
      responses: [
        { status: 200, description: 'Paged catalog products', schema: listResponseSchema },
        { status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
