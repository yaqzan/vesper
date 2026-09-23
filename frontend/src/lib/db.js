// IndexedDB wrapper for offline-pending uploads.
//
// When a recording can't reach the server (no signal while driving), the audio
// blob is stashed here and retried when connectivity returns. One object store,
// keyed by a client-generated UUID.
//
// Blobs are stored as ArrayBuffers — iOS Safari evicts in-memory Blob data
// when the PWA goes to background, making the Blob unreadable on retry even
// though IndexedDB still returns a seemingly valid object. ArrayBuffers are
// fully serialized to disk and survive app suspension.

const DB_NAME = 'vesper-db'
const DB_VERSION = 1
const STORE = 'pending_uploads'

let dbPromise = null

export function initDB() {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

  return dbPromise
}

function tx(mode) {
  return initDB().then((db) => db.transaction(STORE, mode).objectStore(STORE))
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Persist a pending upload record.
 * The blob is converted to ArrayBuffer before storage for iOS compatibility.
 */
export async function savePending(record) {
  const arrayBuffer = await record.blob.arrayBuffer()
  const store = await tx('readwrite')
  await promisify(store.put({ ...record, blob: arrayBuffer }))
  return record
}

export async function getAllPending() {
  const store = await tx('readonly')
  const all = await promisify(store.getAll())
  return all
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .map((item) => ({
      ...item,
      // Reconstruct Blob from ArrayBuffer (new path), or pass through as-is
      // for old entries that were stored as raw Blobs before this fix.
      blob: item.blob instanceof ArrayBuffer
        ? new Blob([item.blob], { type: item.mimeType })
        : item.blob,
    }))
}

export async function deletePending(id) {
  const store = await tx('readwrite')
  await promisify(store.delete(id))
}

export async function updatePending(id, updates) {
  const store = await tx('readwrite')
  const existing = await promisify(store.get(id))
  if (!existing) return null
  const merged = { ...existing, ...updates }
  await promisify(store.put(merged))
  return merged
}
