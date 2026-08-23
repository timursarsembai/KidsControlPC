// Reads everything the self-hosted backend can hold out of Firestore and
// writes it as NDJSON — one line per parent account, with their devices,
// rules, activity and alerts nested inside.
//
// Read-only. It opens the live project with a service account key and never
// writes anything back: the Firebase version has to keep working untouched
// for the whole migration.
//
// Run it wherever the service account key lives — a home PC is fine:
//
//   node export-firestore.mjs --key ./serviceAccount.json --out ./export.ndjson
//
// NDJSON rather than one JSON document: an account with a year of activity is
// large, and a half-written array is unreadable while a half-written NDJSON
// file is simply shorter.

import { createWriteStream, readFileSync } from 'node:fs'
import { argv, exit } from 'node:process'

function arg(name, fallback = null) {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback
}

const keyPath = arg('key')
const outPath = arg('out', './export.ndjson')
// Activity is by far the biggest thing here and the least valuable: a year of
// per-app events is millions of rows nobody will open. Default to the recent
// past, with --activity-days 0 to skip it and a larger number when wanted.
const activityDays = Number(arg('activity-days', '30'))

if (!keyPath) {
  console.error('Usage: node export-firestore.mjs --key <serviceAccount.json> [--out export.ndjson] [--activity-days 30]')
  exit(1)
}

const { initializeApp, cert } = await import('firebase-admin/app')
const { getFirestore } = await import('firebase-admin/firestore')
const { getAuth } = await import('firebase-admin/auth')

initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))) })
const db = getFirestore()
const auth = getAuth()

const activityCutoff = activityDays > 0
  ? new Date(Date.now() - activityDays * 24 * 60 * 60 * 1000)
  : null

// Firestore Timestamps do not survive JSON.stringify in any useful form.
// Everything time-shaped becomes an ISO string; everything else is passed
// through untouched, because rule payloads are free-form and the importer
// stores them as given.
function plain(value) {
  if (value === null || value === undefined) return value
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(plain)
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = plain(v)
    return out
  }
  return value
}

async function readCollection(ref, { limitTo = null } = {}) {
  const snap = limitTo ? await ref.limit(limitTo).get() : await ref.get()
  return snap.docs.map(doc => ({ id: doc.id, ...plain(doc.data()) }))
}

async function exportUser(uid, email) {
  const userRef = db.collection('users').doc(uid)

  const [rootSnap, profileSnap] = await Promise.all([
    userRef.get(),
    userRef.collection('profile').doc('data').get()
  ])

  const devices = []
  const deviceSnap = await userRef.collection('devices').get()

  for (const deviceDoc of deviceSnap.docs) {
    const deviceRef = deviceDoc.ref
    const [rules, apps, stats] = await Promise.all([
      readCollection(deviceRef.collection('rules')),
      readCollection(deviceRef.collection('installedApps')),
      readCollection(deviceRef.collection('activityStats'))
    ])

    let logs = []
    if (activityCutoff) {
      const logSnap = await deviceRef.collection('activityLogs')
        .where('ts', '>=', activityCutoff)
        .get()
      logs = logSnap.docs.map(d => ({ id: d.id, ...plain(d.data()) }))
    }

    devices.push({
      id: deviceDoc.id,
      data: plain(deviceDoc.data()),
      rules,
      apps,
      activityStats: stats,
      activityLogs: logs
    })
  }

  const alerts = await readCollection(userRef.collection('alerts'))

  return {
    uid,
    email,
    // pauseAllRules lives in the root document, not the profile.
    root: rootSnap.exists ? plain(rootSnap.data()) : {},
    profile: profileSnap.exists ? plain(profileSnap.data()) : {},
    devices,
    alerts
  }
}

const out = createWriteStream(outPath, { encoding: 'utf8' })
let accounts = 0
let devices = 0
let rules = 0

// Driven by the Auth user list rather than by Firestore documents: an account
// with no data still has to come across, or its owner cannot sign in.
let pageToken
do {
  const page = await auth.listUsers(1000, pageToken)
  for (const user of page.users) {
    // Agents authenticate anonymously or with a custom token and appear here
    // as users with no email. They are not accounts and are re-paired anyway.
    if (!user.email) continue

    const record = await exportUser(user.uid, user.email)
    record.emailVerified = user.emailVerified
    record.createdAt = user.metadata?.creationTime ?? null

    out.write(JSON.stringify(record) + '\n')
    accounts++
    devices += record.devices.length
    rules += record.devices.reduce((n, d) => n + d.rules.length, 0)
    console.log(`  ${user.email}: ${record.devices.length} устройств, ${record.devices.reduce((n, d) => n + d.rules.length, 0)} правил`)
  }
  pageToken = page.pageToken
} while (pageToken)

out.end()
console.log(`\nГотово: ${accounts} аккаунтов, ${devices} устройств, ${rules} правил → ${outPath}`)
console.log('Пароли НЕ экспортируются: их выдаст импорт, владелец передаёт лично.')
