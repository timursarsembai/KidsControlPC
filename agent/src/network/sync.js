// Which backend this agent talks to.
//
// Both implementations are imported: the Firebase keys are compiled into
// config.js, so evaluating that module is harmless even when it is not the one
// in use, and pkg needs every import resolvable at build time anyway.
//
// The default is Firebase and must stay that way. Agents already installed on
// children's PCs update themselves from GitHub Releases; a build that switched
// backends by accident would leave those machines pointed at a server they
// were never paired with — which is to say, with no rules.

import { IS_SELF_HOSTED } from '../config.js'
import * as firebase from './firebaseSync.js'
import * as selfhosted from './selfhostedSync.js'

const impl = IS_SELF_HOSTED ? selfhosted : firebase

// Same names the agent used when there was only firebaseSync.
export const initSync = IS_SELF_HOSTED ? selfhosted.initSync : firebase.initFirebaseSync
export const stopSync = IS_SELF_HOSTED ? selfhosted.stopSync : firebase.stopFirebaseSync

export const sendHeartbeat = impl.sendHeartbeat
export const sendAlert = impl.sendAlert
export const markCommandCompleted = impl.markCommandCompleted
export const markCommandFailed = impl.markCommandFailed
export const markDeviceOffline = impl.markDeviceOffline
export const publishPomodoroState = impl.publishPomodoroState
export const pushRecentLogs = impl.pushRecentLogs
export const ensureAgentAuth = impl.ensureAgentAuth

// Present only on the self-hosted implementation. On Firebase the services
// write to Firestore directly, which is exactly the coupling this migration is
// undoing — those call sites check IS_SELF_HOSTED and take the old path.
export const sendActivity = selfhosted.sendActivity
export const queueActivityLog = selfhosted.queueActivityLog
export const bumpActivityStat = selfhosted.bumpActivityStat
export const flushActivity = selfhosted.flushActivity
export const uploadInstalledApps = selfhosted.uploadInstalledApps
export const updateRuleStatus = selfhosted.updateRuleStatus
export const updateRule = selfhosted.updateRule
export const uploadScreenshot = selfhosted.uploadScreenshot

export { IS_SELF_HOSTED }
