# Staging environment

The production Firebase project is `kidscontrolpc`.
The staging Firebase project is `kidscontrolpc-dev`.

Use staging for manual verification before releasing production changes. Staging has separate Firebase Hosting, Authentication, Firestore, and Storage data.

## Web app

Run the staging web app locally:

```powershell
npm run web:dev:staging
```

Build the staging web app:

```powershell
npm run web:build:staging
```

Deploy the staging web app to Firebase Hosting:

```powershell
npm run web:deploy:staging
```

The deployed staging URL is:

```text
https://kidscontrolpc-dev.web.app
```

## Electron renderer

Run the desktop app with staging Firebase config:

```powershell
npm run dev:staging
```

Build the desktop app with staging Firebase config:

```powershell
npm run build:staging
```

## Agent

Run the agent against staging Firebase:

```powershell
npm run agent:dev:staging
```

Build a staging agent installer:

```powershell
npm run agent:build:staging
```

The agent uses `pairing.staging.json` in staging mode and `pairing.json` in production mode, so local pairing state is not shared between environments.

Production commands still use the existing production Firebase project by default.
