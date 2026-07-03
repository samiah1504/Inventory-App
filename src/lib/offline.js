import { openDB } from 'idb'

const DB_NAME = 'kanziy-ops'
const DB_VERSION = 1
const QUEUE_STORE = 'offline-queue'

let db

async function getDb() {
  if (!db) {
    db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(QUEUE_STORE)) {
          database.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true })
        }
      }
    })
  }
  return db
}

export async function queueAction(action) {
  const database = await getDb()
  await database.add(QUEUE_STORE, {
    ...action,
    timestamp: new Date().toISOString(),
    retries: 0
  })
}

export async function getQueuedActions() {
  const database = await getDb()
  return database.getAll(QUEUE_STORE)
}

export async function removeQueuedAction(id) {
  const database = await getDb()
  await database.delete(QUEUE_STORE, id)
}

export async function clearQueue() {
  const database = await getDb()
  await database.clear(QUEUE_STORE)
}

export function isOnline() {
  return navigator.onLine
}

export function onOnline(callback) {
  window.addEventListener('online', callback)
  return () => window.removeEventListener('online', callback)
}
