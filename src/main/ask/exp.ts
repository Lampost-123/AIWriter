import type { ChatSwitch } from '@shared/askIntent'

/** Whether a chat overhaul lab switch is on (`AIWRITE_EXP_CHAT_<NAME>=on`). Read each time, so tests can flip it. */
export const chatExp = (name: ChatSwitch): boolean => process.env[`AIWRITE_EXP_CHAT_${name}`] === 'on'
