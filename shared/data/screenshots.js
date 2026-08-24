import * as firebase from '../firebase/screenshots.repo.js'
import * as selfhosted from '../selfhosted/screenshots.repo.js'
import { isSelfHosted } from './backend.js'

const impl = isSelfHosted ? selfhosted : firebase

export const subscribeToScreenshots = impl.subscribeToScreenshots
export const deleteScreenshot = impl.deleteScreenshot
export const markScreenshotDownloaded = impl.markScreenshotDownloaded
export const getScreenshotDownloadURL = impl.getScreenshotDownloadURL
export const getScreenshotFullDownloadURL = impl.getScreenshotFullDownloadURL
