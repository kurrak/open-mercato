import './commands/bom-header'
import './commands/bom-line'
import './commands/bom-line-variant'
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'bom',
  title: 'Bill of Materials',
  version: '0.1.0',
  description: 'Multi-level BOM with phantom pass-through, variant conditions, and BOM explosion.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: true,
}

export { features } from './acl'
