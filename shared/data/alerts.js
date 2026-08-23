import * as firebase from '../firebase/alerts.repo.js'
import * as selfhosted from '../selfhosted/alerts.repo.js'
import { isSelfHosted } from './backend.js'

const impl = isSelfHosted ? selfhosted : firebase

export const subscribeToAlerts = impl.subscribeToAlerts
export const acknowledgeAlert = impl.acknowledgeAlert
export const acknowledgeAllAlerts = impl.acknowledgeAllAlerts
