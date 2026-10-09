// Milestone 6: the first-run setup (world, key and test, writer model, basic style guide, the read-aloud download, optional World builder, a guided first scene) and the sample world.
// Owned by the First run part (see docs/ARCHITECTURE.md, "Milestone 6"). Only this part changes this file.
//
// The setup shows in place of the Welcome screen when the library holds no world of Adam's own (the sample
// world doesn't count), and never to someone who has worlds already. Each step saves as it goes: the world is
// made at the first step, the key, model and style are the usual settings, and where the setup stands is one
// small settings field (`Settings.firstRun`), so the next launch resumes there. Finishing it opens the world's
// first scene with a small guide, until that scene is marked done or the guide is closed.
//
// The sample world is made in code (src/main/setup/), through the same SQL helpers as a real world, with its
// memory already read, and goes in the library as its own world. It is found by its meta key `sample_world`,
// so opening it again never makes a second one, and a deleted one is simply made again.

import type { ID, World } from '../types'

/** The setup's screens, in order. The guided first scene follows them, in the workspace. */
export type SetupStep = 'world' | 'connect' | 'model' | 'style' | 'voices' | 'builder'

export const SETUP_STEPS: SetupStep[] = ['world', 'connect', 'model', 'style', 'voices', 'builder']

export interface SetupState {
  /** The step to show now; null when the setup isn't showing. */
  step: SetupStep | null
  /** The world being set up (made at the first step); null before it is made. */
  worldId: ID | null
  /** The sample world, when it is in the library. */
  sampleWorldId: ID | null
}

/** Calls the interface can make. */
export interface SetupApi {
  /** Where the first run stands at launch. When it resumes a world's setup, that world is open. */
  getSetup(): Promise<SetupState>
  /**
   * "Start my own world" (from the sample world): resumes an unfinished setup (opening its world) or starts
   * at the first step. Step null when Adam has worlds of his own already (the New world dialog does then).
   */
  startSetup(): Promise<SetupState>
  /** Remembers the step shown now, with the open world as the one being set up, so the next launch resumes there. */
  setSetupStep(step: SetupStep): Promise<SetupState>
  /** Ends the setup: makes sure the open world has a story, chapter and scene, and gives that scene the guide. */
  finishSetup(): Promise<{ storyId: ID; sceneId: ID }>
  /** The first scene's guide is done or closed: it never shows again. */
  endFirstSceneGuide(): Promise<void>
  /** The open world's id when it is the sample world (opened from the world list, say); else null. */
  sampleWorldOpen(): Promise<ID | null>
  /** Opens the sample world, making it first when it isn't in the library (so there is only ever one). */
  openSampleWorld(): Promise<World>
}

/** Events from the main process. */
export interface SetupEvents {}
