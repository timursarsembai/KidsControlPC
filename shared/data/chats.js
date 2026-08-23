import * as firebase from '../firebase/chats.repo.js'
import { isSelfHosted } from './backend.js'

// Chat is deferred on the self-hosted backend — parental control without chat
// is a working product, chat without blocking is not, so blocking went first.
// Same rule as screenshots: reads are empty, writes say so out loud.
// async on purpose: callers do sendMessage(...).catch(...), and a synchronous
// throw escapes that entirely — it surfaces as an unhandled TypeError instead
// of the message the parent should see.
const notAvailable = async () => {
  throw new Error('Чат пока недоступен на этом сервере.')
}
const emptySubscription = (...args) => {
  const callback = args.find(a => typeof a === 'function')
  callback?.([])
  return () => {}
}

export const subscribeToChats = isSelfHosted ? emptySubscription : firebase.subscribeToChats
export const subscribeToMessages = isSelfHosted ? emptySubscription : firebase.subscribeToMessages
export const createChat = isSelfHosted ? notAvailable : firebase.createChat
export const updateChat = isSelfHosted ? notAvailable : firebase.updateChat
export const deleteChat = isSelfHosted ? notAvailable : firebase.deleteChat
export const sendMessage = isSelfHosted ? notAvailable : firebase.sendMessage
export const markMessagesRead = isSelfHosted ? async () => {} : firebase.markMessagesRead
export const markFileDeleted = isSelfHosted ? async () => {} : firebase.markFileDeleted
export const markMessagesDelivered = isSelfHosted ? async () => {} : firebase.markMessagesDelivered
