import type { Handlers } from './index'
import * as backups from '../services/backups'
import * as updater from '../services/updater'

type MaintenanceMethods = 'listBackups' | 'backupNow' | 'restoreBackup' | 'getUpdateStatus' | 'checkForUpdates' | 'installUpdate'

export const maintenanceHandlers: Handlers<MaintenanceMethods> = {
  listBackups: () => backups.listBackups(),
  backupNow: () => backups.backupNow(),
  restoreBackup: (id) => backups.restoreBackup(id),
  getUpdateStatus: () => updater.getUpdateStatus(),
  checkForUpdates: () => updater.checkForUpdates(),
  installUpdate: () => updater.installUpdate()
}
