// Stand-in for the Firebase SDK in a self-hosted build.
//
// Why this exists: shared/firebase/config.js runs at import time, and
// getAuth() throws auth/invalid-api-key when there are no Firebase keys — which
// is exactly the case on this build. The data facade imports both
// implementations statically, so that module gets evaluated no matter which
// backend is selected, and the panel would die before rendering anything.
// The build passes; only opening the page shows it.
//
// Aliased in over `firebase/*` by web/vite.config.js when mode is selfhosted.
// The bonus is that the real SDK stops being bundled at all — roughly 300 KB
// that a self-hosted panel has no use for.
//
// Every name here is one the codebase imports from firebase/*. Reads yield
// nothing and unsubscribes are no-ops, so a screen still mounted against
// Firebase renders empty instead of exploding. Writes throw: silence would
// look like the write succeeded.

const NOT_AVAILABLE = 'Эта возможность работает только в облачной версии.'

// async for the same reason the facade stubs are: callers attach .catch(), and
// a synchronous throw would sail straight past it.
async function unavailable() {
  throw new Error(NOT_AVAILABLE)
}

function noopUnsubscribe() {
  return () => {}
}

// ── firebase/app ────────────────────────────────────────────────────────────
export const initializeApp = () => ({ name: 'stub', options: {} })

// ── firebase/auth ───────────────────────────────────────────────────────────
// currentUser is null rather than absent: callers read `auth.currentUser?.email`
// and a missing property would be the same thing, but this is explicit.
export const getAuth = () => ({ currentUser: null })
export const onAuthStateChanged = (_auth, callback) => {
  callback(null)
  return noopUnsubscribe()
}
export const signInWithEmailAndPassword = unavailable
export const createUserWithEmailAndPassword = unavailable
export const sendPasswordResetEmail = unavailable
export const sendEmailVerification = unavailable
export const applyActionCode = unavailable
export const updatePassword = unavailable
export const deleteUser = unavailable
export const signOut = async () => {}

// ── firebase/firestore ──────────────────────────────────────────────────────
export const getFirestore = () => ({ type: 'stub-firestore' })
export const collection = () => ({ type: 'stub-collection' })
export const doc = () => ({ type: 'stub-doc' })
export const query = () => ({ type: 'stub-query' })
export const where = () => ({})
export const orderBy = () => ({})
export const limit = () => ({})
export const onSnapshot = (...args) => {
  // onSnapshot(ref, onNext, onError) — hand back an empty result so a screen
  // renders "nothing here" rather than waiting forever.
  const onNext = args.find(a => typeof a === 'function')
  onNext?.({ exists: () => false, data: () => ({}), docs: [], docChanges: () => [] })
  return noopUnsubscribe()
}
export const getDoc = async () => ({ exists: () => false, data: () => ({}) })
export const getDocs = async () => ({ docs: [], empty: true })
export const addDoc = unavailable
export const setDoc = unavailable
export const updateDoc = unavailable
export const deleteDoc = unavailable
export const writeBatch = () => ({ set: unavailable, update: unavailable, delete: unavailable, commit: unavailable })
export const arrayUnion = (...values) => values
export const serverTimestamp = () => new Date().toISOString()
export const Timestamp = {
  now: () => ({ toDate: () => new Date(), toMillis: () => Date.now() }),
  fromDate: (date) => ({ toDate: () => date, toMillis: () => date.getTime() }),
  fromMillis: (ms) => ({ toDate: () => new Date(ms), toMillis: () => ms })
}

// ── firebase/functions ──────────────────────────────────────────────────────
export const getFunctions = () => ({ type: 'stub-functions' })
export const httpsCallable = () => unavailable

// ── firebase/storage ────────────────────────────────────────────────────────
export const getStorage = () => ({ type: 'stub-storage' })
export const ref = () => ({ fullPath: '' })
export const getDownloadURL = unavailable
export const getMetadata = unavailable
export const uploadBytesResumable = unavailable
export const deleteObject = unavailable
export const listAll = async () => ({ items: [], prefixes: [] })
