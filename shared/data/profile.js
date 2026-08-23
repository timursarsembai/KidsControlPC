import * as firebase from '../firebase/profile.repo.js'
import * as selfhosted from '../selfhosted/profile.repo.js'
import { isSelfHosted } from './backend.js'

const impl = isSelfHosted ? selfhosted : firebase

export const DEFAULT_QUOTA_BYTES = impl.DEFAULT_QUOTA_BYTES
export const subscribeToProfile = impl.subscribeToProfile
export const initUserProfile = impl.initUserProfile

export const subscribeToPauseAllRules = impl.subscribeToPauseAllRules
export const setPauseAllRules = impl.setPauseAllRules

// Storage is not part of the self-hosted first version — screenshots and chat
// attachments are the only things that use it, and both are deferred. Calling
// this against the self-hosted backend is a mistake worth failing loudly on
// rather than a no-op that quietly reports the wrong number to a parent.
export const recalcStorageUsed = isSelfHosted
  ? async () => { throw new Error('Storage is not available on the self-hosted backend yet') }
  : firebase.recalcStorageUsed

// Kept working on both: it is the parent's display name in the chat, and the
// chat screens read it even where messaging itself is deferred.
export const updateChatName = impl.updateChatName
