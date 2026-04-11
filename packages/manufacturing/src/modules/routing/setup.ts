import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['routing.*'],
    employee: ['routing.view', 'routing.work_center.view', 'routing.factory_zone.view'],
  },
}

export default setup
