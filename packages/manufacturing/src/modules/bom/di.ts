import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  BomHeader,
  BomLine,
  BomLineVariant,
} from './data/entities'

export function register(container: AppContainer) {
  container.register({
    BomHeader: asValue(BomHeader),
    BomLine: asValue(BomLine),
    BomLineVariant: asValue(BomLineVariant),
  })
}
