// Story memory step 5: the search model for "Find by meaning" (Settings › Models). It is downloaded once, like the
// speech models, into the app's own data folder; until then the briefing still finds earlier passages by their words.

export type SearchModelState =
  /** Not downloaded (or removed). */
  | 'none'
  | 'downloading'
  /** Downloaded, getting ready (its files read, its check run). */
  | 'starting'
  | 'ready'
  /** Downloaded but not working (its files couldn't be read, or it failed its check): finding by meaning is off. */
  | 'broken'

export interface SearchModelStatus {
  state: SearchModelState
  /** The download's size in megabytes (about 133). */
  sizeMb: number
  /** While downloading: how far it has got, 0 to 1. */
  progress: number | null
  /** What went wrong last (a download that failed, a model that didn't pass its check), in plain words; null if nothing. */
  problem: string | null
  /** For the open world, while the model is ready: how many of its passages have been read for finding by meaning. */
  indexed: { done: number; total: number } | null
  /** Which engine runs it, while it is ready: the fast one (onnxruntime) or the slower one written for AI Write. */
  engine?: 'onnx' | 'ts' | null
  /** It downloads by itself while it isn't here (Adam, 2026-10-08), unless Adam pressed Stop or Remove since Download. */
  auto?: boolean
}

export interface SearchModelApi {
  getSearchModel(): Promise<SearchModelStatus>
  /** Starts the download (or Try again), and lets it download by itself again; progress comes as 'searchModel:status'. */
  downloadSearchModel(): Promise<SearchModelStatus>
  /** Stops a download under way; nothing half-downloaded is kept, and it no longer downloads by itself. */
  stopSearchModelDownload(): Promise<SearchModelStatus>
  /** Removes the downloaded model (finding by meaning then waits for Adam to download it again: never by itself). */
  removeSearchModel(): Promise<SearchModelStatus>
}

export interface SearchModelEvents {
  'searchModel:status': SearchModelStatus
}
