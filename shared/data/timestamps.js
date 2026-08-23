import { serverTimestamp as firebaseServerTimestamp } from '../firebase/timestamps.js'
import { isSelfHosted } from './backend.js'

/**
 * A timestamp to embed inside a document the client is writing — a rule's
 * timer.startedAt, for instance.
 *
 * On Firestore this is a sentinel the server replaces with its own clock. The
 * self-hosted backend stamps rows itself, but these values live *inside* a
 * free-form payload it does not interpret, so the client's clock is what
 * there is. The agent compares them against its own clock anyway, and both
 * machines are wrong by roughly the same amount.
 */
export const serverTimestamp = isSelfHosted
  ? () => new Date().toISOString()
  : firebaseServerTimestamp
