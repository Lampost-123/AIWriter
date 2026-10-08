// Vitest settings for the chat eval only (npm run chat-eval): the trap harness's settings (the app's code as
// '@app/...' from TRAPS_ROOT or this checkout, 'electron' as the stand-in, ?nodeWorker imports as real worker threads),
// with this harness's run file in place of the trap run's.
import { defineConfig, type UserConfig } from 'vitest/config'
import traps from '../traps/vitest.traps.config'

const base = traps as UserConfig

export default defineConfig({
  ...base,
  test: { ...base.test, include: ['tests/chat-eval/chatEval.run.ts'], env: { AIWRITE_SEARCH_MODEL_AUTO: 'off' } }
})
