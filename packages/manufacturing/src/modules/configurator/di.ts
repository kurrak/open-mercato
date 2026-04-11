import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { ConfigAttribute, ConstraintRule } from './data/entities'

export function register(container: AppContainer) {
  container.register({
    ConfigAttribute: asValue(ConfigAttribute),
    ConstraintRule: asValue(ConstraintRule),
  })
}
