// What the phone may ask the computer to do (review #1). The phone page is the whole app (phone/main.ts loads the
// desktop's interface), so nearly every call is one it really makes. The ones it may not make open something on the
// computer's own screen, take a path on the computer, change where keys, the library or backups go, install software,
// or change the phone link itself. Every AppApi method is in one list or the other: a new one doesn't build until it
// has been placed, and a name in neither list is refused.
import type { ApiMethod } from '@shared/api'

const COMPUTER_ONLY = [
  // The computer's own screen: windows, folders, open and save boxes
  'showWindow', 'flushDone', 'setFullScreen', 'showInFolder', 'showExported', 'showSpeechFolder', 'chooseLibraryFolder',
  'chooseBackupFolder', 'clearBackupFolder', 'chooseManuscript', 'exportStory', 'exportBible', 'exportWorldFile', 'importWorldFile',
  // A path on the computer
  'readDroppedManuscript',
  // Keys and where AI and speech requests go
  'saveProvider', 'deleteProvider', 'restoreProvider', 'setHuggingFaceKey', 'undoRemoveHuggingFaceKey', 'setSpeechServerUrl',
  // Installing software
  'installUpdate', 'installPython', 'downloadSpeech',
  // The phone link itself
  'setPhoneLink', 'newPhoneCode'
] as const satisfies readonly ApiMethod[]

const PHONE = [
  'actDeleteNotes', 'answerChapterPlan', 'answerMemoryQuestion', 'answerScenePlan', 'applyRecipeToStory', 'askPlanQuestion',
  'askStoryQuestion', 'askTopicQuestions', 'askWorld', 'askWorldQuestion', 'backupNow', 'buildStoryCodex', 'buildStoryWorld',
  'cancelBeatStart', 'cancelDraftStart', 'cancelRecipe', 'cancelSpeechDownload', 'cancelWorldBuild', 'carryOnRecipe', 'carryOnThisMonth',
  'castVoicelessCharacters', 'chapterWriterNow', 'chapterWriterPlan', 'checkForUpdates', 'checkMemoryAgain', 'checkNewWords',
  'checkSpeech', 'checkWithoutWaiting', 'clearReadAloudCache', 'clearRecovery', 'clearSoundLibrary', 'copyWorld', 'createAct',
  'createBuilderEntry', 'createChange', 'createChapter', 'createChapterAt', 'createEntry', 'createScene', 'createSeries', 'createStory',
  'createStoryAs', 'createWorld', 'declineFollow', 'deleteAct', 'deleteChange', 'deleteChapter', 'deleteDraft', 'deleteEntry',
  'deleteNotes', 'deleteRecipe', 'deleteScene', 'deleteStory', 'deleteWorld', 'directionFavourites', 'directorNote', 'dismissRefusedNote',
  'dismissSpeechDownload', 'downloadSearchModel', 'draftStartingCast', 'dropCritiqueWant', 'duplicateRecipe', 'editSoundCue',
  'emptyDeletedWorlds', 'endFirstSceneGuide', 'estimateCatchUp', 'estimateRecipe', 'estimateReread', 'estimateStoryFill',
  'estimateWorldBuild', 'fillChapterCard', 'fillSceneCard', 'fillTimeGap', 'findInStory', 'finishSetup', 'forgetRecipeSource',
  'getAppInfo', 'getArtChoices', 'getBackupFolderStatus', 'getBeatMarks', 'getBeatsWritten', 'getBoardMarks', 'getCatchUp',
  'getChapterCard', 'getChapterWriterReport', 'getChat', 'getCheckReport', 'getCheckWords', 'getCritique', 'getEntry', 'getEntryAsOf',
  'getEntryReadAloud', 'getEventHomes', 'getGeneration', 'getInterviewProgress', 'getLibrary', 'getMemoryStatus', 'getOutline',
  'getPhoneLink', 'getReadAloudCache', 'getRecall', 'getRecallAt', 'getRecipe', 'getRecipeMaker', 'getRelationshipMap',
  'getRepetitionReport', 'getScene', 'getSceneDate', 'getSceneNames', 'getSceneSounds', 'getSearchModel', 'getSettings', 'getSetup',
  'getSnapshot', 'getSoundsStatus', 'getSpeechStatus', 'getSpeechStorage', 'getSpendState', 'getStoryBrief', 'getStoryDetails',
  'getStoryPlacement', 'getSummary', 'getThreadsBoard', 'getThreadsReport', 'getTimeline', 'getUpdateStatus', 'getUsage', 'getVariantSet',
  'getWorld', 'getWorldBuilder', 'getWritingPrefs', 'giveStudioVoices', 'ignoreIssue', 'ignoreLive', 'importManuscript', 'issueCounts',
  'joinActBack', 'keepEditFromStory', 'keepMemoryChecks', 'keepOutline', 'keepReplacedText', 'keepSuggestedRelationship',
  'keepSuggestions', 'keepTake', 'keepTopicSuggestion', 'laterIssue', 'listAppearances', 'listAsOfStops', 'listBackups', 'listChanges',
  'listChats', 'listCodex', 'listDeleted', 'listDrafts', 'listEntries', 'listEntryHistory', 'listEntryLinks', 'listExistsPoints',
  'listFacts', 'listFirstExists', 'listGenerations', 'listIssues', 'listLiveIgnores', 'listMemoryChecks', 'listMemoryLog', 'listModels',
  'listProviders', 'listReadAloudVoices', 'listRecipePlans', 'listRecipes', 'listRecovery', 'listSceneCards', 'listSceneChanges',
  'listSeries', 'listShelf', 'listSnapshots', 'listSoundLibrary', 'listStories', 'listStoryFlowRuns', 'listStoryFlows', 'listStoryIssues',
  'listStorySummaries', 'listWorlds', 'makeSoundNow', 'markAiIdea', 'markIssueFixed', 'markSceneDone', 'markSceneSounds', 'memoryRefusal',
  'moveChapter', 'moveMapCharacter', 'moveScene', 'muteSceneSounds', 'newDraft', 'newRecipe', 'noteContextWord', 'openSampleWorld',
  'openWorld', 'outlineBlank', 'placeChapter', 'placeEvents', 'planHubFacts', 'planReading', 'planStoryCodex', 'planThread',
  'planUpdateScenes', 'prepareSearch', 'previewBackup', 'previewContext', 'previewMove', 'previewStory', 'readAloudCast',
  'readPastedStory', 'readRecipeAgain', 'recentDirections', 'recipeChat', 'redoCodexItem', 'redoReadingClip', 'redoRecipePart',
  'redoWorldBuild', 'refreshRecall', 'refreshRecallAt', 'removeMemoryCheck', 'removeRecallCharacter', 'removeSearchModel',
  'removeSpeechDownloads', 'renameDraft', 'renameStoryIn', 'renameWorldIn', 'reopenIssue', 'reopenScene', 'repairsApplied',
  'replaceInStory', 'resetMapLayout', 'restoreAct', 'restoreBackup', 'restoreBuilderField', 'restoreChange', 'restoreChapterCard',
  'restoreDeleted', 'restoreDraft', 'restoreEntryVersion', 'restoreRecipe', 'restoreRecipeSource', 'restoreSoundEdits',
  'restoreStudioVoices', 'restoreWorld', 'restored', 'retakeSound', 'sampleReading', 'sampleWorldOpen', 'saveAskNote', 'saveBeatMarks',
  'saveRecipePlan', 'saveSceneText', 'saveStoryBrief', 'saveWorldSummary', 'sceneLeft', 'scenePlansWaiting', 'search', 'searchPlaces',
  'setBlockMode', 'setCurrentDraft', 'setDictationEngine', 'setDirectionFavourite', 'setEntryImage', 'setEntryMotif', 'setEntryReadAloud',
  'setFirstExists', 'setLeadsIn', 'setMonthlyLimit', 'setOptionMark', 'setPin', 'setProposalStatus', 'setRecallValue', 'setSetupStep',
  'setSpeechStartWithApp', 'setStoryBuildsWaiting', 'setStoryCover', 'setStoryPlacement', 'setSummary', 'setWritingPrefs',
  'settleCritiqueNote', 'sortStartChanges', 'soundAudio', 'soundCueTimes', 'speakClip', 'speakerLabels', 'spendToastShown', 'startActAt',
  'startBeat', 'startCatchUp', 'startChapterPlan', 'startChapterWriter', 'startCheck', 'startCritique', 'startDraft', 'startEdit',
  'startFleshOut', 'startInterview', 'startOptions', 'startOutline', 'startOutlineStage', 'startPlanChat', 'startPlanRedo',
  'startPlanUpdate', 'startPolish', 'startQuestions', 'startQuickStart', 'startRecipe', 'startRecipeStory', 'startRelationships',
  'startReread', 'startSceneIdeas', 'startScreenAtLaunch', 'startSetup', 'startStoryFill', 'startStoryOutline', 'startVariants',
  'startWorldBuild', 'stopBuilder', 'stopCatchUp', 'stopChapterWriter', 'stopCheck', 'stopGeneration', 'stopReadingMarks', 'stopReread',
  'stopSearchModelDownload', 'stopStoryFill', 'stopStoryFlow', 'stopTask', 'stopVariants', 'storyBuildsWaiting', 'storyCodexChat',
  'suggestCharacterVoice', 'suggestFromTopic', 'suggestStart', 'switchDraft', 'syncSpelling', 'synonymsOf', 'takeSnapshot', 'testProvider',
  'transcribeDictation', 'unapplyRecipe', 'undoAskNote', 'undoChapterWriter', 'undoClearSoundLibrary', 'undoKeptRelationship',
  'undoMemoryCheck', 'undoMemoryItem', 'undoNewDraft', 'undoRemoveSpeechDownloads', 'undoReplaceInStory', 'undoWorldBuild', 'unignoreLive',
  'unkeepOutline', 'unplaceEvents', 'updateAct', 'updateChange', 'updateChapter', 'updateChapterCard', 'updateEntry',
  'updateMemoryFromIssue', 'updateMemoryNow', 'updateRecipe', 'updateScene', 'updateSceneCard', 'updateSeries', 'updateSettings',
  'updateStory', 'updateWorld', 'warmUpVoices', 'writeRecovery', 'writeStyleSample'
] as const satisfies readonly ApiMethod[]

type Unplaced = Exclude<ApiMethod, (typeof COMPUTER_ONLY)[number] | (typeof PHONE)[number]>
// Fails to build while an AppApi method is in neither list; the error names it.
const everyMethodPlaced: [Unplaced] extends [never] ? true : Unplaced = true
void everyMethodPlaced

const phone = new Set<string>(PHONE)
for (const m of COMPUTER_ONLY) phone.delete(m)

// Settings that point the computer somewhere: provider addresses, the library and the second backup folder.
const COMPUTER_SETTINGS = ['providers', 'libraryPath', 'backup']

function pointsSomewhere(patch: unknown): boolean {
  if (!patch || typeof patch !== 'object') return false
  if (COMPUTER_SETTINGS.some((key) => key in patch)) return true
  const speech = (patch as { speech?: unknown }).speech
  return !!speech && typeof speech === 'object' && 'serverUrl' in speech
}

export const COMPUTER_ONLY_MESSAGE = 'That can only be done on the computer. Open AI Write there to do it.'

/** Why the phone may not make this call, or null when it may. */
export function phoneRefusal(method: string, args: readonly unknown[]): string | null {
  if (!phone.has(method)) return COMPUTER_ONLY_MESSAGE
  if (method === 'updateSettings' && pointsSomewhere(args[0])) return COMPUTER_ONLY_MESSAGE
  return null
}
