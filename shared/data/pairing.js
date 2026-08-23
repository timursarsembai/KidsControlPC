import * as firebase from '../firebase/pairing.repo.js'
import * as selfhosted from '../selfhosted/pairing.repo.js'
import { isSelfHosted } from './backend.js'

const impl = isSelfHosted ? selfhosted : firebase

export const createPairingCode = impl.createPairingCode
export const createRepairPairingCode = impl.createRepairPairingCode
