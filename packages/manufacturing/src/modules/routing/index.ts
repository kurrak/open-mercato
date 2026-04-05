import './commands/work-center'
import './commands/factory-zone'
import './commands/routing-template'
import './commands/operation-template'
import './commands/operation-template-variant'
import './commands/operation-dependency'
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'routing',
  title: 'Production Routing',
  version: '0.1.0',
  description: 'Work centers, factory zones, routing templates with DAG-validated operations and time rollup.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: true,
}

export { features } from './acl'
