import * as firebase from '../firebase/apps.repo.js'
import * as selfhosted from '../selfhosted/apps.repo.js'
import { isSelfHosted } from './backend.js'

const impl = isSelfHosted ? selfhosted : firebase

export const subscribeToInstalledApps = impl.subscribeToInstalledApps
export const uploadInstalledApps = impl.uploadInstalledApps
