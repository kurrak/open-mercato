import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['configurator.*'],
    employee: ['configurator.view'],
  },
}

export default setup
