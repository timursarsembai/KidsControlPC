import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'))
const here = path.dirname(fileURLToPath(import.meta.url))

// In a self-hosted build there are no Firebase keys, and the SDK does not take
// that quietly: getAuth() throws auth/invalid-api-key at import time, inside
// shared/firebase/config.js, which the data facade pulls in regardless of the
// selected backend. The build succeeds and the page then dies before it
// renders. Swapping the SDK for a stub removes the failure and, along with it,
// roughly 300 KB of a bundle that has nothing to talk to.
const firebaseStub = path.resolve(here, '../shared/selfhosted/firebase-stub.js')
const FIREBASE_MODULES = ['app', 'auth', 'firestore', 'functions', 'storage']

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  resolve: {
    alias: mode === 'selfhosted'
      ? FIREBASE_MODULES.map(name => ({
        find: new RegExp(`^firebase/${name}$`),
        replacement: firebaseStub
      }))
      : []
  }
}))
