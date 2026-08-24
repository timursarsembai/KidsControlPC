import * as firebase from '../firebase/profile.repo.js'
import * as selfhosted from '../selfhosted/profile.repo.js'
import * as selfhostedScreenshots from '../selfhosted/screenshots.repo.js'
import { isSelfHosted } from './backend.js'

const impl = isSelfHosted ? selfhosted : firebase

export const DEFAULT_QUOTA_BYTES = impl.DEFAULT_QUOTA_BYTES
export const subscribeToProfile = impl.subscribeToProfile
export const initUserProfile = impl.initUserProfile

export const subscribeToPauseAllRules = impl.subscribeToPauseAllRules
export const setPauseAllRules = impl.setPauseAllRules

// Recounts what is actually stored. The running total is maintained
// incrementally, and any counter kept that way eventually drifts.
export const recalcStorageUsed = isSelfHosted
  ? selfhostedScreenshots.recalcStorageUsed
  : firebase.recalcStorageUsed

// Kept working on both: it is the parent's display name in the chat, and the
// chat screens read it even where messaging itself is deferred.
export const updateChatName = impl.updateChatName
