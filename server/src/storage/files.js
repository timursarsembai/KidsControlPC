// Where screenshot files live on disk.
//
// A directory per owner and device, so a device that is deleted takes its
// folder with it and nothing has to walk the whole tree to find its files.
//
// Paths are stored relative to the root: an absolute path in a database
// survives exactly until the volume is mounted somewhere else.

import { createReadStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from '../config.js'

export const STORAGE_ROOT = config.storageRoot

/**
 * Resolves a stored path to a real one, refusing anything that climbs out of
 * the root. The paths come from our own database, but a traversal bug here
 * would serve arbitrary files off the server, so it is checked anyway.
 */
export function resolveStoredPath(relativePath) {
  const full = normalize(join(STORAGE_ROOT, relativePath))
  if (!full.startsWith(STORAGE_ROOT + sep)) {
    throw new Error(`path escapes storage root: ${relativePath}`)
  }
  return full
}

export function screenshotPath(ownerId, deviceId) {
  // The extension matters: this is what the browser and the download dialog
  // go by, and the agent only ever sends JPEG.
  return join(ownerId, deviceId, `${randomUUID()}.jpg`)
}

export async function saveFile(relativePath, buffer) {
  const full = resolveStoredPath(relativePath)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, buffer)
  return buffer.length
}

export function readFileStream(relativePath) {
  return createReadStream(resolveStoredPath(relativePath))
}

export async function fileExists(relativePath) {
  try {
    await stat(resolveStoredPath(relativePath))
    return true
  } catch {
    return false
  }
}

/**
 * Deletes a file, ignoring one that is already gone.
 *
 * A missing file must not stop the database row from being removed: otherwise
 * one interrupted delete leaves a row that can never be cleaned up, and the
 * quota it counts against stays spent forever.
 */
export async function deleteFile(relativePath) {
  try {
    await rm(resolveStoredPath(relativePath), { force: true })
  } catch {
    // Already gone, or never written. Either way there is nothing to do.
  }
}

// Used when a device or account is removed: the rows go by cascade, the files
// have to be taken out separately.
export async function deleteDirectory(relativePath) {
  try {
    await rm(resolveStoredPath(relativePath), { recursive: true, force: true })
  } catch {
    // Nothing stored for this device yet.
  }
}

/**
 * Every stored file, as paths relative to the root.
 *
 * Used by the orphan sweep. The tree is two levels deep by construction
 * (owner/device/file), so this does not need to be a general recursive walk.
 */
export async function listStoredFiles() {
  const { readdir } = await import('node:fs/promises')
  const out = []
  let owners
  try {
    owners = await readdir(STORAGE_ROOT, { withFileTypes: true })
  } catch {
    return out
  }
  for (const owner of owners) {
    if (!owner.isDirectory()) continue
    let devices = []
    try {
      devices = await readdir(join(STORAGE_ROOT, owner.name), { withFileTypes: true })
    } catch { continue }
    for (const device of devices) {
      if (!device.isDirectory()) continue
      let files = []
      try {
        files = await readdir(join(STORAGE_ROOT, owner.name, device.name))
      } catch { continue }
      for (const file of files) out.push(join(owner.name, device.name, file))
    }
  }
  return out
}
