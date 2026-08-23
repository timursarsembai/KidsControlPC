// Devices, from whichever backend is configured.
//
// Both implementations are imported statically on purpose: they have to be
// resolvable at build time, and the bundler cannot pick between them from a
// runtime value anyway. The Firebase half disappears from the bundle when its
// implementation is deleted at the end of the migration.

import * as firebase from '../firebase/devices.repo.js'
import * as selfhosted from '../selfhosted/devices.repo.js'
import { isSelfHosted } from './backend.js'

const impl = isSelfHosted ? selfhosted : firebase

export const subscribeToDevices = impl.subscribeToDevices
export const updateDeviceAlias = impl.updateDeviceAlias
export const removeDevice = impl.removeDevice
export const updateDeviceSettings = impl.updateDeviceSettings
