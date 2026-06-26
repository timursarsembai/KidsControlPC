import { ref, listAll, deleteObject, getMetadata } from 'firebase/storage'
import { storage } from './config.js'

async function listAllFiles(path) {
  const result = await listAll(ref(storage, path))
  const files = [...result.items]
  for (const prefix of result.prefixes) {
    const sub = await listAllFiles(prefix.fullPath)
    files.push(...sub)
  }
  return files
}

export async function deleteAllUserAttachments(ownerUid, onProgress) {
  const files = await listAllFiles(`users/${ownerUid}/chats`)
  let deleted = 0
  for (const fileRef of files) {
    await deleteObject(fileRef)
    deleted++
    onProgress?.(deleted, files.length)
  }
  return deleted
}

export async function deleteUserAttachmentsOlderThan(ownerUid, ms, onProgress) {
  const files = await listAllFiles(`users/${ownerUid}/chats`)
  const cutoff = Date.now() - ms
  const toDelete = []
  for (const fileRef of files) {
    const meta = await getMetadata(fileRef)
    if (new Date(meta.timeCreated).getTime() < cutoff) toDelete.push(fileRef)
  }
  let deleted = 0
  for (const fileRef of toDelete) {
    await deleteObject(fileRef)
    deleted++
    onProgress?.(deleted, toDelete.length)
  }
  return deleted
}
