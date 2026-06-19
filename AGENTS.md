# AI Agent Project Instructions

This file is mandatory guidance for any AI coding agent working on KidsControlPC.

## Project Summary

KidsControlPC is a commercial parental-control project with:

- a production web app on Firebase Hosting: `https://kidscontrolpc.web.app`
- a staging web app on Firebase Hosting: `https://kidscontrolpc-dev.web.app`
- a Windows child PC agent with GitHub Release based auto-update
- Firebase Auth, Firestore, and Storage as backend services
- separate production and staging Firebase projects

Production Firebase project:

```text
kidscontrolpc
```

Staging Firebase project:

```text
kidscontrolpc-dev
```

## Core Rules

1. Never change production directly without an explicit user request.
2. Never deploy to production without an explicit user request.
3. Never create a production agent release without an explicit user request.
4. Use `dev` for development work and `master` only for production-ready code.
5. Keep changes small and task-focused.
6. Diagnose before fixing. Do not patch by guessing.
7. Do not mix refactoring, feature work, release work, and bug fixes in one task unless explicitly requested.
8. Preserve user changes. Never revert unrelated local changes.
9. Commit and push completed work to the appropriate branch when the user asks for implementation work.
10. For any agent change that must reach child PCs, bump the agent version and create a GitHub Release.

## Branch Workflow

Use this default workflow:

1. Start from a clean tree.
2. Work on `dev` or a short branch from `dev`.
3. Run checks.
4. Push to `origin/dev`.
5. Verify on staging.
6. Merge `dev` into `master` only after staging verification.
7. Push `master`.
8. Deploy production or publish agent release only when explicitly requested.

`master` is the production branch. It should remain clean and deployable.

`dev` is the integration branch. It should usually be close to `master`, but may contain staged work.

## Firebase Environments

Production aliases are configured in `.firebaserc`:

```text
prod -> kidscontrolpc
dev  -> kidscontrolpc-dev
```

Production deploy target:

```powershell
npx firebase-tools deploy --only hosting --project prod
```

Staging deploy target:

```powershell
npx firebase-tools deploy --only hosting --project dev
```

Prefer the repository scripts when available:

```powershell
npm run web:build
npm run web:build:staging
npm run web:deploy:staging
```

If Firebase Hosting deploy fails with upload/hash cache errors, remove only the local Firebase hosting cache file under `.firebase/`, retry deploy, then restore tracked cache files if needed.

## Required Checks

Run these before merging or releasing:

```powershell
npm run lint
npm --prefix agent test
npm run web:build
npm run build
```

Known current baseline:

```text
npm run lint exits 0 with 38 warnings
```

Do not treat these existing warnings as new failures, but do not add new lint errors.

For staging web:

```powershell
npm run web:build:staging
```

For staging Electron renderer:

```powershell
npm run build:staging
```

For production agent installer:

```powershell
npm run agent:build
```

For staging agent installer:

```powershell
npm run agent:build:staging
```

## Agent Release Workflow

The child PC agent checks:

```text
https://api.github.com/repos/timursarsembai/KidsControlPC/releases/latest
```

It auto-updates only when:

- the latest GitHub Release tag is greater than the current `AGENT_VERSION`
- the release contains an asset named exactly `KidsControlAgent_Setup.exe`

For any production agent update:

1. Bump `agent/package.json`.
2. Bump `agent/package-lock.json`.
3. Bump fallback `AGENT_VERSION` in `agent/src/config.js`.
4. Run agent tests and lint.
5. Build production installer:

   ```powershell
   npm run agent:build
   ```

6. Verify the production bundle uses:

   ```text
   buildEnvironment = "production"
   projectId = "kidscontrolpc"
   ```

7. Commit and push `master`.
8. Create GitHub Release with tag `vX.Y.Z`.
9. Upload asset:

   ```text
   agent/dist/KidsControlAgent_Setup.exe
   ```

10. Verify `/releases/latest` returns the new tag and asset.
11. Fast-forward `dev` to `master` after the release bump.

Do not publish staging installers as production release assets.

## Staging Agent Rules

Staging agent must use:

```text
projectId = kidscontrolpc-dev
pairing file = pairing.staging.json
installer = KidsControlAgent_Dev_Setup.exe
service = KidsControlPCAgentDev
install dir = KidsControlAgentDev
scheduled task = KidsControlTimerWidgetDev
```

Production agent must use:

```text
projectId = kidscontrolpc
pairing file = pairing.json
installer = KidsControlAgent_Setup.exe
service = KidsControlPCAgent
install dir = KidsControlAgent
scheduled task = KidsControlTimerWidget
```

## Bug Fix Workflow

For bugs, use this order:

1. Reproduce or inspect the failure.
2. Identify which layer is broken.
3. Make the smallest safe fix.
4. Add or update tests where practical.
5. Verify locally.
6. Verify on staging if the bug touches Firebase, web, or agent behavior.
7. Release to production only after confirmation.

Do not start with broad refactoring.

## Screenshot Feature Diagnostic Flow

When fixing screenshots, check the whole pipeline in order:

1. Web UI sends a screenshot command.
2. Firestore command document is created under the selected device.
3. Agent receives the command.
4. `commandHandler` routes it correctly.
5. Screenshot helper captures the screen in the user session.
6. Screenshot file is created locally.
7. Upload token/config exists.
8. File uploads to Firebase Storage.
9. Firestore screenshot metadata is written.
10. Web UI queries and displays the screenshot.
11. Command status becomes `completed` or a useful `failed` state.

If any step fails, record the exact failing step before editing code.

## Commercial Maintainability Rules

Prefer:

- small commits with clear names
- narrow fixes over broad rewrites
- staging verification before production
- release notes for user-visible changes
- explicit command statuses and error messages
- tests for critical agent logic
- documentation for deployment and release steps

Avoid:

- direct production experiments
- unversioned agent changes
- silent failures
- hidden environment coupling
- mixing staging and production Firebase config
- changing security rules without staging validation
- changing installer behavior without checking service names, install dir, and update flow

## Git Safety

Before work:

```powershell
git status --short --branch
git fetch origin
```

Before merge:

```powershell
git rev-list --left-right --count master...dev
git rev-list --left-right --count master...origin/master
git rev-list --left-right --count dev...origin/dev
```

Use merge commits for `dev -> master` unless the user requests another strategy.

Never use destructive commands such as:

```text
git reset --hard
git checkout -- .
```

unless the user explicitly requests them and the target is clear.

## Final Response Expectations

When reporting completed work, include:

- branch used
- commit hash
- pushed branch
- checks run and results
- deploy/release URL if created
- what the user should do next

If no code was changed, say so clearly.
