import * as firebase from '../firebase/commands.repo.js'
import * as selfhosted from '../selfhosted/commands.repo.js'
import { isSelfHosted } from './backend.js'

const impl = isSelfHosted ? selfhosted : firebase

export const sendDeviceCommand = impl.sendDeviceCommand

// Firestore had no equivalent: the panel watched the command document through
// the same collection listener it used for everything else. Only the
// self-hosted backend exposes it as its own channel.
export const subscribeToCommands = selfhosted.subscribeToCommands
