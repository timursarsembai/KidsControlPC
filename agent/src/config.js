/* global __KIDSCONTROL_ENV__ */

import { join } from 'path'

// Current version of the agent
export const AGENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.1.105'

const buildEnvironment = typeof __KIDSCONTROL_ENV__ !== 'undefined' ? __KIDSCONTROL_ENV__ : null

export const APP_ENV = buildEnvironment || process.env.KIDSCONTROL_ENV || 'production'

// Sentry DSN is public by design (rate-limited server-side, not a secret) — safe to
// bake into the distributed exe. Empty string disables error tracking.
export const SENTRY_DSN = process.env.SENTRY_DSN || 'https://a6ac288a4027eb7722275fbdc49d8abd@o4511666089951232.ingest.de.sentry.io/4511666124423248'

const firebaseConfigs = {
  production: {
    apiKey: "AIzaSyA" + "FYWqbatuvU0qQOpe7cphvVwN7_hSeui0",
    authDomain: "kidscontrolpc.firebaseapp.com",
    projectId: "kidscontrolpc",
    storageBucket: "kidscontrolpc.firebasestorage.app",
    messagingSenderId: "415574988307",
    appId: "1:415574988307:web:a85c12d2881cff0c4111e6",
    measurementId: "G-QND5RJ7JPH"
  },
  staging: {
    apiKey: "AIzaSyCTqYs0TKZFF2sE6BVkqhaTGabuyKyDDDE",
    authDomain: "kidscontrolpc-dev.firebaseapp.com",
    projectId: "kidscontrolpc-dev",
    storageBucket: "kidscontrolpc-dev.firebasestorage.app",
    messagingSenderId: "956972216736",
    appId: "1:956972216736:web:02a31ceeb0ae610cb6f4c5",
    measurementId: "G-FRPM5FPJYF"
  }
}

export const firebaseConfig = firebaseConfigs[APP_ENV] || firebaseConfigs.production

// Stores linked parentUid + deviceId after first setup.
export const PAIRING_FILE = join(process.cwd(), APP_ENV === 'production' ? 'pairing.json' : `pairing.${APP_ENV}.json`)

// Stores Firebase Auth anonymous session (persists agent UID across restarts).
export const AGENT_AUTH_FILE = join(process.cwd(), APP_ENV === 'production' ? 'agent_auth.json' : `agent_auth.${APP_ENV}.json`)

// Firebase Cloud Functions region.
export const FUNCTIONS_REGION = 'us-central1'

// Shared, user-writable folder for IPC files between the SYSTEM service and the
// interactive ChatTrayApp (which runs as a limited user and cannot write to
// Program Files). Keep this path in sync with ChatTrayApp.cs default.
export const CHAT_DATA_DIR = join(
  process.env.ProgramData || 'C:\\ProgramData',
  APP_ENV === 'production' ? 'KidsControlPC' : 'KidsControlPC-Dev'
)

// How often to send heartbeat to Firebase (ms)
export const HEARTBEAT_INTERVAL_MS = 30_000   // 30 sec

// How often to check and enforce rules (ms)
export const ENFORCE_INTERVAL_MS = 5_000      // 5 sec

// Hosts file path on Windows
export const HOSTS_FILE = 'C:\\Windows\\System32\\drivers\\etc\\hosts'

// Marker comments in hosts file
export const HOSTS_BLOCK_START = '# KidsControlPC-START'
export const HOSTS_BLOCK_END   = '# KidsControlPC-END'
