/* global __KIDSCONTROL_ENV__ */

import { join } from 'path'

// Current version of the agent
export const AGENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.1.44'

const buildEnvironment = typeof __KIDSCONTROL_ENV__ !== 'undefined' ? __KIDSCONTROL_ENV__ : null

export const APP_ENV = buildEnvironment || process.env.KIDSCONTROL_ENV || 'production'

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

// How often to send heartbeat to Firebase (ms)
export const HEARTBEAT_INTERVAL_MS = 30_000   // 30 sec

// How often to check and enforce rules (ms)
export const ENFORCE_INTERVAL_MS = 5_000      // 5 sec

// Hosts file path on Windows
export const HOSTS_FILE = 'C:\\Windows\\System32\\drivers\\etc\\hosts'

// Marker comments in hosts file
export const HOSTS_BLOCK_START = '# KidsControlPC-START'
export const HOSTS_BLOCK_END   = '# KidsControlPC-END'
