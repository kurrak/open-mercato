import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { UnitOfMeasure } from './data/entities'

const DEFAULT_UOMS = [
  { code: 'szt', name: 'Piece', uomType: 'piece' as const },
  { code: 'm', name: 'Meter (linear)', uomType: 'length' as const },
  { code: 'm2', name: 'Square meter', uomType: 'area' as const },
  { code: 'kg', name: 'Kilogram', uomType: 'weight' as const },
  { code: 'l', name: 'Liter', uomType: 'volume' as const },
  { code: 'h', name: 'Hour', uomType: 'time' as const },
  { code: 'mb', name: 'Running meter', uomType: 'length' as const },
]

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['product_master.*'],
    employee: ['product_master.view', 'product_master.supplier_info.view'],
  },

  seedDefaults: async (ctx) => {
    const { em, tenantId, organizationId } = ctx
    for (const uom of DEFAULT_UOMS) {
      const existing = await em.findOne(UnitOfMeasure, {
        organizationId,
        tenantId,
        code: uom.code,
      })
      if (!existing) {
        em.create(UnitOfMeasure, {
          organizationId,
          tenantId,
          ...uom,
        })
      }
    }
    await em.flush()
  },
}

export default setup
