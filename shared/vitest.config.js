import { defineConfig } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))

// Mirrors the alias in web/vite.config.js. Without it the self-hosted suite
// would import the real Firebase SDK — which throws auth/invalid-api-key with
// no keys configured — and test something the shipped bundle never does.
const firebaseStub = path.resolve(here, 'selfhosted/firebase-stub.js')
const FIREBASE_MODULES = ['app', 'auth', 'firestore', 'functions', 'storage']

const selfHosted = process.env.KIDSCONTROL_BACKEND === 'selfhosted'

export default defineConfig({
  resolve: {
    alias: selfHosted
      ? FIREBASE_MODULES.map(name => ({
        find: new RegExp(`^firebase/${name}$`),
        replacement: firebaseStub
      }))
      : []
  },
  test: {
    // The Firebase suite instantiates the SDK on import, and getAuth() refuses
    // an empty apiKey. These are placeholders that let it initialise — nothing
    // here talks to Firebase, and the real keys live in the build environment.
    env: selfHosted ? {} : {
      VITE_FIREBASE_API_KEY: 'test-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'test-project',
      VITE_FIREBASE_STORAGE_BUCKET: 'test.appspot.com',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '0',
      VITE_FIREBASE_APP_ID: 'test-app-id'
    }
  }
})
