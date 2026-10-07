// Story memory step 5: the search model for "Find by meaning" (contracts/searchModel.ts, src/main/retrieval/).
import type { Handlers } from './index'
import type { SearchModelApi } from '@shared/contracts/searchModel'
import { downloadSearchModel, removeSearchModel, searchModelStatus, stopSearchModelDownload } from '../retrieval'

export const searchModelHandlers: Handlers<keyof SearchModelApi> = {
  getSearchModel: () => searchModelStatus(),
  downloadSearchModel: () => downloadSearchModel(),
  stopSearchModelDownload: () => stopSearchModelDownload(),
  removeSearchModel: () => removeSearchModel()
}
