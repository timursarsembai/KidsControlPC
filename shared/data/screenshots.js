import * as firebase from '../firebase/screenshots.repo.js'
import { isSelfHosted } from './backend.js'

// Screenshots are deferred on the self-hosted backend: they need object
// storage, which the first version does not have. The panel still mounts the
// screenshot screens, so subscribing has to be harmless — it yields an empty
// list rather than throwing and taking the whole screen down.
//
// Writes throw: a parent who presses "take a screenshot" and gets silence
// would conclude the feature is broken in some deeper way.
// async on purpose: callers do sendMessage(...).catch(...), and a synchronous
// throw escapes that entirely — it surfaces as an unhandled TypeError instead
// of the message the parent should see.
const notAvailable = async () => {
  throw new Error('Скриншоты пока недоступны на этом сервере.')
}

export const subscribeToScreenshots = isSelfHosted
  ? (_uid, _deviceId, callback) => { callback([]); return () => {} }
  : firebase.subscribeToScreenshots

export const deleteScreenshot = isSelfHosted ? notAvailable : firebase.deleteScreenshot
export const markScreenshotDownloaded = isSelfHosted ? async () => {} : firebase.markScreenshotDownloaded
export const getScreenshotDownloadURL = isSelfHosted ? notAvailable : firebase.getScreenshotDownloadURL
export const getScreenshotFullDownloadURL = isSelfHosted ? notAvailable : firebase.getScreenshotFullDownloadURL
