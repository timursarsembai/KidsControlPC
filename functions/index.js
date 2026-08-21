// Cloud Functions entry point — thin aggregator. Each domain lives in its own
// module under lib/ (parent invitations, account verification, storage quota,
// device pairing/agent auth, device commands) to keep this file discoverable.
require('./lib/firebaseAdmin')

module.exports = {
  ...require('./lib/parentInvitations'),
  ...require('./lib/accountVerification'),
  ...require('./lib/storageQuota'),
  ...require('./lib/pairing'),
  ...require('./lib/commands')
}
