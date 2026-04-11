import './commands/config-attribute'
import './commands/constraint-rule'
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'configurator',
  title: 'Product Configurator',
  version: '0.1.0',
  description: 'Rule-based product configuration with attributes, constraint rules, and configuration resolution.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: true,
}

export { features } from './acl'
