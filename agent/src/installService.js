/**
 * KidsControlPC Agent — Windows Service Installer
 * Registers the agent.js script as a background Windows Service.
 * MUST be run from an elevated PowerShell/CMD command prompt (Administrator).
 */

import { Service } from 'node-windows'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const svc = new Service({
  name: 'KidsControlPCAgent',
  description: 'KidsControlPC — Child background monitoring and blocking agent.',
  script: join(__dirname, 'agent.js'),
  env: [
    {
      name: "NODE_ENV",
      value: "production"
    }
  ]
})

// Listen for the "install" event
svc.on('install', () => {
  console.log('==================================================')
  console.log('✅ KidsControlPCAgent Service installed successfully!')
  console.log('🚀 Starting the service...')
  svc.start()
  console.log('==================================================')
})

svc.on('alreadyinstalled', () => {
  console.log('⚠️  Service is already installed.')
})

svc.on('invalidinstallation', () => {
  console.error('❌ Invalid installation. Check logs.')
})

console.log('⏳ Registering Windows Service "KidsControlPCAgent"...')
svc.install()
