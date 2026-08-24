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

/**
 * The address to show an attachment from.
 *
 * On Firebase the message already carries a public download URL from Storage.
 * On the self-hosted backend the file is behind the ordinary access token, so
 * it gets fetched and turned into an object URL — an <img> cannot send a
 * header, and a URL that carried its own access would end up in logs and in
 * forwarded links.
 */
export const getAttachmentURL = isSelfHosted
  ? selfhosted.getAttachmentURL
  : async (message) => message?.fileUrl ?? null
