import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  UnitOfMeasure,
  ProductManufacturingExtension,
  ProductionMethod,
  SupplierInfo,
  UomConversion,
} from './data/entities'

export function register(container: AppContainer) {
  container.register({
    UnitOfMeasure: asValue(UnitOfMeasure),
    ProductManufacturingExtension: asValue(ProductManufacturingExtension),
    ProductionMethod: asValue(ProductionMethod),
    SupplierInfo: asValue(SupplierInfo),
    UomConversion: asValue(UomConversion),
  })
}
