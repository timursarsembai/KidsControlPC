import dotenv from 'dotenv'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../../.env') })

// Firebase config — same project as parent app
export const firebaseConfig = {
  apiKey:            process.env.VITE_FIREBASE_API_KEY,
  authDomain:        process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.VITE_FIREBASE_APP_ID,
  measurementId:     process.env.VITE_FIREBASE_MEASUREMENT_ID
}

// Pairing state file — stores linked parentUid + deviceId after first setup
export const PAIRING_FILE = join(__dirname, '..', 'pairing.json')

// How often to send heartbeat to Firebase (ms)
export const HEARTBEAT_INTERVAL_MS = 30_000   // 30 sec

// How often to check and enforce rules (ms)
export const ENFORCE_INTERVAL_MS = 5_000      // 5 sec

// Hosts file path on Windows
export const HOSTS_FILE = 'C:\\Windows\\System32\\drivers\\etc\\hosts'

// Marker comments in hosts file
export const HOSTS_BLOCK_START = '# KidsControlPC-START'
export const HOSTS_BLOCK_END   = '# KidsControlPC-END'
