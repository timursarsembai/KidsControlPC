import * as firebase from '../firebase/parents.repo.js'
import * as selfhosted from '../selfhosted/parents.repo.js'
import { isSelfHosted } from './backend.js'

const impl = isSelfHosted ? selfhosted : firebase

export const subscribeToParentInvitations = impl.subscribeToParentInvitations
export const subscribeToParentAccess = impl.subscribeToParentAccess
export const createParentInvitation = impl.createParentInvitation
export const getParentInvitation = impl.getParentInvitation
export const acceptParentInvitation = impl.acceptParentInvitation
export const declineParentInvitation = impl.declineParentInvitation
export const revokeParentAccess = impl.revokeParentAccess
