# Parent invitations

Parent invitations use Firebase Auth, Firestore, Cloud Functions, and SMTP.

## Runtime configuration

Set these non-secret environment variables for the Firebase Functions runtime
before deploying to staging or production:

```text
APP_BASE_URL=https://kidscontrolpc-dev.web.app
FUNCTIONS_REGION=us-central1
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
MAIL_FROM=
```

Store the SMTP password in Firebase Secret Manager:

```powershell
firebase functions:secrets:set SMTP_PASS --project dev
```

Use the staging URL for the `dev` Firebase project and the production URL only
when production deployment is explicitly requested. Keep local `.env` files with
real SMTP settings uncommitted.

## Behavior

- The primary parent enters another parent's email in Settings -> Account.
- A callable Cloud Function creates an invitation and sends an email.
- If the email is new, Firebase Auth creates a temporary account with a random
  password and the email includes that password.
- If the email already belongs to a KidsControlPC account, the existing password
  is not reset. The invited parent signs in with their current password.
- The invite link opens `/invite`, where the parent can accept or decline.
- Accepting creates `users/{ownerUid}/parentAccess/{parentUid}` and points the
  invited profile at the owner's devices.
- New temporary accounts are sent to a password-change step immediately after
  accepting.
- Pending or declined invitations are removed by the scheduled cleanup function
  after 24 hours. Temporary accounts created for expired or declined invitations
  are deleted too.
