// The phone on this network (Settings › About and updates › On your phone).
import type { PhoneApi } from '@shared/contracts/phone'
import type { Handlers } from './index'
import { currentPhoneLink, newPhoneCode, setPhoneLink } from '../phone/runtime'

export const phoneHandlers: Handlers<keyof PhoneApi> = {
  getPhoneLink: () => currentPhoneLink(),
  setPhoneLink: (on) => setPhoneLink(on),
  newPhoneCode: () => newPhoneCode()
}
