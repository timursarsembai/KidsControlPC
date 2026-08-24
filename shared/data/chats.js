import * as firebase from '../firebase/chats.repo.js'
import * as selfhosted from '../selfhosted/chats.repo.js'
import { isSelfHosted } from './backend.js'

const impl = isSelfHosted ? selfhosted : firebase

export const subscribeToChats = impl.subscribeToChats
export const subscribeToMessages = impl.subscribeToMessages
export const createChat = impl.createChat
export const updateChat = impl.updateChat
export const deleteChat = impl.deleteChat
export const sendMessage = impl.sendMessage
export const markMessagesRead = impl.markMessagesRead
export const markMessagesDelivered = impl.markMessagesDelivered
export const markFileDeleted = impl.markFileDeleted

// Only the self-hosted backend needs this: on Firebase the message already
// carries a download URL from Storage.
export const getAttachmentURL = selfhosted.getAttachmentURL
