import * as firebase from '../firebase/rules.repo.js'
import * as selfhosted from '../selfhosted/rules.repo.js'
import { isSelfHosted } from './backend.js'

const impl = isSelfHosted ? selfhosted : firebase

export const subscribeToRules = impl.subscribeToRules
export const addRule = impl.addRule
export const updateRule = impl.updateRule
export const savePomodoroRule = impl.savePomodoroRule
export const deleteRule = impl.deleteRule
