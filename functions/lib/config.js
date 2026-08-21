const { HttpsError } = require('firebase-functions/v2/https')

const REGION = process.env.FUNCTIONS_REGION || 'us-central1'
// Storage triggers must be deployed in the same region as the bucket.
const STORAGE_REGION = process.env.FUNCTIONS_STORAGE_REGION || 'us-east1'

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in first.')
  }
  return request.auth.uid
}

function normalizeEmail(email) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new HttpsError('invalid-argument', 'Enter a valid parent email.')
  }
  return normalized
}

function getAppBaseUrl() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '')
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || ''
  return projectId.endsWith('-dev')
    ? 'https://kidscontrolpc-dev.web.app'
    : 'https://kidscontrolpc.web.app'
}

module.exports = { REGION, STORAGE_REGION, requireAuth, normalizeEmail, getAppBaseUrl }
