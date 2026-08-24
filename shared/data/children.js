// Профили детей, из того хранилища, которое настроено.

import * as firebase from '../firebase/children.repo.js'
import * as selfhosted from '../selfhosted/children.repo.js'
import { isSelfHosted } from './backend.js'

const impl = isSelfHosted ? selfhosted : firebase

// Панель спрашивает об этом, чтобы не показывать кнопку, которая на
// Firebase-версии могла бы только выбросить ошибку.
export const supportsChildren = isSelfHosted

export const subscribeToChildren = impl.subscribeToChildren
export const createChild = impl.createChild
export const updateChild = impl.updateChild
export const deleteChild = impl.deleteChild
export const assignDevice = impl.assignDevice
