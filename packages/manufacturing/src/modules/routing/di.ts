import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  WorkCenter,
  FactoryZone,
  RoutingTemplate,
  OperationTemplate,
  OperationTemplateVariant,
  OperationDependency,
} from './data/entities'

export function register(container: AppContainer) {
  container.register({
    WorkCenter: asValue(WorkCenter),
    FactoryZone: asValue(FactoryZone),
    RoutingTemplate: asValue(RoutingTemplate),
    OperationTemplate: asValue(OperationTemplate),
    OperationTemplateVariant: asValue(OperationTemplateVariant),
    OperationDependency: asValue(OperationDependency),
  })
}
