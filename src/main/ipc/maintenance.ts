import type { Handlers } from './index'
import * as backups from '../services/backups'
import * as updater from '../services/updater'

type MaintenanceMethods =
  | 'listBackups' | 'backupNow' | 'restoreBackup' | 'previewBackup' | 'chooseBackupFolder' | 'clearBackupFolder' | 'getBackupFolderStatus'
  | 'getUpdateStatus' | 'checkForUpdates' | 'installUpdate'

export const maintenanceHandlers: Handlers<MaintenanceMethods> = {
  listBackups: () => backups.listBackups(),
  backupNow: () => backups.backupNow(),
  restoreBackup: (id) => backups.restoreBackup(id),
  previewBackup: (id) => backups.previewBackup(id),
  chooseBackupFolder: () => backups.chooseBackupFolder(),
  clearBackupFolder: () => backups.clearBackupFolder(),
  getBackupFolderStatus: () => backups.getBackupFolderStatus(),
  getUpdateStatus: () => updater.getUpdateStatus(),
  checkForUpdates: () => updater.checkForUpdates(),
  installUpdate: () => updater.installUpdate()
}
