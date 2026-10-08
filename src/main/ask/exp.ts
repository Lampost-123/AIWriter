import { chatSwitchOn, chatSwitchVar, type ChatSwitch } from '@shared/askIntent'

/**
 * Whether a chat overhaul lab switch is on: on by default, off only with `AIWRITE_EXP_CHAT_<NAME>=off` (the eval's A/B,
 * or a fallback to the old behaviour). Read each time, so tests can flip it.
 */
export const chatExp = (name: ChatSwitch): boolean => chatSwitchOn(process.env[chatSwitchVar(name)])
