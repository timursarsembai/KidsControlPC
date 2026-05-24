/**
 * KidsControlPC Agent — Windows Service Uninstaller
 * Stops and unregisters the KidsControlPCAgent Windows Service.
 * MUST be run from an elevated PowerShell/CMD command prompt (Administrator).
 */

import { Service } from 'node-windows'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const svc = new Service({
  name: 'KidsControlPCAgent',
  script: join(__dirname, 'agent.js')
})

// Listen for the "uninstall" event
svc.on('uninstall', () => {
  console.log('==================================================')
  console.log('✅ KidsControlPCAgent Service uninstalled successfully.')
  console.log('==================================================')
})

console.log('⏳ Stopping and removing Windows Service "KidsControlPCAgent"...')
svc.uninstall()
