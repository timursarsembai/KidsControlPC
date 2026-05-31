import { join } from 'path'

// Current version of the agent
export const AGENT_VERSION = '1.1.4'

// Firebase config — same project as parent app
export const firebaseConfig = {
  apiKey:            "AIzaSyA" + "FYWqbatuvU0qQOpe7cphvVwN7_hSeui0",
  authDomain:        "kidscontrolpc.firebaseapp.com",
  projectId:         "kidscontrolpc",
  storageBucket:     "kidscontrolpc.firebasestorage.app",
  messagingSenderId: "415574988307",
  appId:             "1:415574988307:web:a85c12d2881cff0c4111e6",
  measurementId:     "G-QND5RJ7JPH"
}

// Pairing state file — stores linked parentUid + deviceId after first setup
export const PAIRING_FILE = join(process.cwd(), 'pairing.json')

// How often to send heartbeat to Firebase (ms)
export const HEARTBEAT_INTERVAL_MS = 30_000   // 30 sec

// How often to check and enforce rules (ms)
export const ENFORCE_INTERVAL_MS = 5_000      // 5 sec

// Hosts file path on Windows
export const HOSTS_FILE = 'C:\\Windows\\System32\\drivers\\etc\\hosts'

// Marker comments in hosts file
export const HOSTS_BLOCK_START = '# KidsControlPC-START'
export const HOSTS_BLOCK_END   = '# KidsControlPC-END'
