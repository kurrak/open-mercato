import type { EntityManager } from '@mikro-orm/postgresql'
import {
  ProductManufacturingExtension,
  ProductionMethod,
  SupplierInfo,
  UomConversion,
} from '../data/entities'

export const metadata = {
  event: 'catalog.product.deleted',
  persistent: true,
  id: 'product_master.on-product-deleted',
}

export default async function handle(
  payload: { id?: string; organizationId?: string | null; tenantId?: string | null },
  ctx: { resolve: <T = unknown>(name: string) => T },
) {
  const productId = payload?.id
  if (!productId) return

  const organizationId = payload.organizationId ?? null
  const tenantId = payload.tenantId ?? null

  const em = (ctx.resolve<EntityManager>('em')).fork()
  const now = new Date()

  const baseFilter = {
    productId,
    deletedAt: null,
    ...(organizationId ? { organizationId } : {}),
    ...(tenantId ? { tenantId } : {}),
  }

  await em.nativeUpdate(ProductManufacturingExtension, baseFilter, { deletedAt: now })
  await em.nativeUpdate(ProductionMethod, baseFilter, { deletedAt: now })
  await em.nativeUpdate(SupplierInfo, baseFilter, { deletedAt: now })
  await em.nativeUpdate(UomConversion, baseFilter, { deletedAt: now })
}
