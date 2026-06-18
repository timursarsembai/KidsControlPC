# Phase 0 Baseline

Date: 2026-06-07
Branch: `dev`
Baseline commit: `0521d92 chore: establish dev refactor baseline`

## Scope

Phase 0 records the current state before refactoring. No application code is changed in this phase.

## Automated Checks

| Check | Command | Result | Notes |
|-------|---------|--------|-------|
| Web production build | `npm.cmd run web:build` | Pass | Vite build completes. Warning: one JS chunk is larger than 500 kB after minification. |
| Root lint | `npm.cmd run lint` | Fail | ESLint 10 cannot find root `eslint.config.(js\|mjs\|cjs)`. |
| Web lint | `npm.cmd run lint --workspace=web` | Fail | 39 errors, 3 warnings. Existing issues include unused React imports, `Date.now()` during render, setState in effects, undefined `__APP_VERSION__`, and unused variables. |
| Agent tests | `npm.cmd test` in `agent/` | Pass | 9 test files, 28 tests passed. |
| Electron/Vite build | `npm.cmd run build` | Pass | Main, preload, and renderer bundles build successfully. Warning: Vite CJS Node API is deprecated. |

PowerShell blocked direct `npm` invocation because `npm.ps1` script execution is disabled. Baseline checks were run with `npm.cmd`.

## Store API Map

Current public store entrypoint:

- `@kidscontrol/shared/stores/useRulesStore`
- implementation: `shared/stores/useRulesStore.js`

Current state fields:

- Auth: `user`
- UI: `selectedDeviceId`, `activeTab`, `activeSubTab`, `programSearch`, `programFilter`, `showSettings`
- Firestore data: `devices`, `rules`, `installedApps`, `screenshots`, `alerts`
- Loading: `rulesLoading`, `appsLoading`
- Subscriptions: `_unsubDevices`, `_unsubRules`, `_unsubApps`, `_unsubScreenshots`, `_unsubAlerts`

Current actions and selectors:

- UI setters: `setActiveTab`, `setActiveSubTab`, `setProgramSearch`, `setProgramFilter`, `setShowSettings`
- Auth/lifecycle: `initFirebase`, `cleanup`
- Device lifecycle: `selectDevice`, `renameDevice`, `deleteDevice`
- Rules: `checkRuleConflict`, `toggleProgramBlock`, `toggleWebsiteBlock`, `addProgramRule`, `addWebsite`, `addPowerRule`, `addLockRule`, `addReminderRule`, `updateReminderRule`, `removeRule`, `removeWebsiteGlobally`
- Profiles: `addProfileMode`, `deleteProfileMode`, `saveProfileRules`
- Pomodoro: `getPomodoroSession`, `togglePomodoroSession`
- Alerts: `acknowledgeAlert`, `acknowledgeAllAlerts`
- Commands/settings: `sendDeviceCommand`, `updateDeviceSettings`
- Screenshots: `requestScreenshot`, `deleteScreenshot`, `getScreenshotDownloadURL`
- Derived selectors: `getFilteredPrograms`, `getFilteredWebsites`

Important compatibility note: both `web/src` and `src/renderer/src` import `@kidscontrol/shared/stores/useRulesStore`. Any store refactor must preserve this entrypoint until both UI trees are migrated.

Potential API mismatch to resolve later: `web/src/components/SettingsPanel/SettingsPanel.jsx` and `src/renderer/src/components/SettingsPanel/SettingsPanel.jsx` read `logout` from `useRulesStore`, but `shared/stores/useRulesStore.js` does not currently expose a `logout` action.

## Firestore API Map

Current public Firestore entrypoint:

- `@kidscontrol/shared/firebase/firestore`
- implementation: `shared/firebase/firestore.js`

Current exports:

- `serverTimestamp`
- Devices: `subscribeToDevices`, `updateDeviceAlias`, `removeDevice`, `updateDeviceSettings`
- Rules: `subscribeToRules`, `addRule`, `updateRule`, `savePomodoroRule`, `deleteRule`
- Installed apps: `subscribeToInstalledApps`, `uploadInstalledApps`
- Commands: `sendDeviceCommand`
- Screenshots: `subscribeToScreenshots`, `deleteScreenshot`, `getScreenshotDownloadURL`
- Alerts: `subscribeToAlerts`, `acknowledgeAlert`, `acknowledgeAllAlerts`
- Pairing: `createPairingCode`
- User profile: `initUserProfile`

Compatibility requirement for Phase 2: `shared/firebase/firestore.js` must remain as a barrel/re-export entrypoint until all consumers are migrated.

## Time Helpers API Map

Current public time helper entrypoint:

- `@kidscontrol/shared/utils/timeHelpers`
- implementation: `shared/utils/timeHelpers.js`

Current exports:

- `isScheduleWindowActive`
- `isScheduleBlockingNow`
- `evaluateRule`

Current private functions that agent unification will need later:

- `toDayIndex`
- `getScheduleGroups`
- `isScheduleGroupActive`

Phase 5 must explicitly export these pure helpers or provide stable aliases before replacing `agent/src/ruleTiming.js`.

## Shared Boundary Finding

Current architectural boundary violation:

- `shared/stores/useRulesStore.js` imports `../../web/src/core/logger`.

Phase 1 should move logger into `shared/utils/logger.js`, export it from `shared/package.json`, and update web/renderer imports while preserving behavior.

## UI Consumer Map

Both UI trees consume shared store and helpers:

- `web/src`
- `src/renderer/src`

Representative consumers include:

- App lifecycle: `App.jsx`
- Navigation/device UI: `DeviceSidebar`, `NavSidebar`, `Header`/`TitleBar`, `Dashboard`, `ContentArea`
- Domain panels: `ProgramsPanel`, `WebPanel`, `ProfilePanel`, `PomodoroPanel`, `RemindersPanel`, `PowerPanel`, `ScreenshotsPanel`, `NotificationsPanel`, `SettingsPanel`

Phase 4 must either refactor both trees consistently or first decide which UI tree is canonical.

## Agent Packaging Finding

`agent/package.json` does not currently depend on `@kidscontrol/shared`, and `agent` is not listed in root `workspaces`.

Phase 5 cannot be a simple re-export change until one of these is done:

- add `agent` to root workspaces;
- add a local dependency from `agent` to `@kidscontrol/shared`;
- introduce a build/bundle step that safely includes only pure shared helpers.

## Manual Smoke Checklist

Manual checks to run before high-risk phases:

- Login/logout.
- Auto-select first device.
- Switch selected device and verify rules/apps/screenshots refresh.
- Add/remove program rule.
- Add/remove website rule.
- Create/edit/delete profile mode and save schedule/targets.
- Start/stop pomodoro.
- Add/edit/remove reminder.
- Send power command.
- Request/delete screenshot and resolve download URL.
- Acknowledge one alert and all alerts.

## Phase 0 Result

Phase 0 is complete with documented baseline. Existing lint failures are recorded and should not be mixed into structural refactor commits unless a later phase explicitly targets lint cleanup.
