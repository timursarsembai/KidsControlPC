import * as firebase from '../firebase/activity.repo.js'
import * as selfhosted from '../selfhosted/activity.repo.js'
import { isSelfHosted } from './backend.js'

const impl = isSelfHosted ? selfhosted : firebase

export const subscribeToActivityLogs = impl.subscribeToActivityLogs
export const getActivityStats = impl.getActivityStats
export const subscribeToActivityStats = impl.subscribeToActivityStats
export const subscribeToActivityStatsRange = impl.subscribeToActivityStatsRange
