# web/ vs src/renderer/ Component Divergence

Date: 2026-08-21

## Scope

`web/src/components` (parent web app) and `src/renderer/src/components`
(Electron desktop app) each carry a full copy of the UI. This session moved
the byte-identical subset into `shared/ui/` (see git history: "dedupe
identical UI components"). This document triages everything that's still
duplicated but *not* identical, so a future pass can pick up where this one
left off without re-doing the analysis.

No visual/interactive testing was possible in this environment (no browser
extension available) — CSS-heavy items below need that before merging.

## Already fixed this session

- `ProfilePanel.jsx`: renderer was missing web's `.sort((a,b) =>
  a.timeFrom.localeCompare(b.timeFrom))` calls after editing/adding schedule
  ranges — a real display bug (ranges could render out of chronological
  order). Ported; the two `ProfilePanel.jsx` files are now content-identical.
  Not moved to `shared/ui/` because `ProfilePanel.css` still genuinely
  differs (see below).
- `ContentArea.jsx`: import order only, cosmetic, aligned so future diffs
  are meaningful.

## Confirmed intentional platform differences — do NOT merge

These implement genuinely different behavior for a responsive web app vs a
fixed-size Electron window. Merging them would either bloat the desktop app
with unused responsive/mobile code, or silently drop features from the web
app.

- **`Dashboard.jsx`**: web uses `Header` (mobile hamburger menu, scrim,
  `isMobileOpen`/`onMobileNavigate` plumbing for touch layouts) plus
  `useEffect`/`useCallback` to close mobile panels on navigation. Renderer
  uses `TitleBar` (Electron window chrome) with none of that — a desktop
  window doesn't need a mobile nav drawer. `Header/` is intentionally
  web-only (not in renderer at all); `TitleBar/` is intentionally
  renderer-only.
- **`PowerPanel.jsx`/`.css`** (473 vs 210 lines JS, 458 vs 188 CSS): web has
  a full scheduled-power-action feature (recurring/date/monthly rules,
  countdown display, day-of-week formatting) that renderer's version does
  not have at all — renderer only exposes the four immediate action buttons
  (shutdown/restart/sleep/hibernate). This is a real feature gap, not
  drift. Whether the desktop app *should* gain power scheduling is a product
  decision, not a mechanical merge.
- **`DeviceSidebar.jsx`/`.css`** (124/65 diff lines, 10 mobile-signal hits):
  web's version carries `isMobileOpen`/`onMobileNavigate` mobile-drawer
  support that renderer's fixed-layout sidebar doesn't need.
- **`NavSidebar.jsx`/`.css`**, **Dashboard.css**: same mobile-drawer pattern
  bleeding into these files (`isMobileOpen`, `onMobileNavigate`, `@media`
  breakpoints).

## Confirmed unfinished/partial features — leave alone, don't silently port

Porting these would mean shipping a half-built feature to the other app, or
guessing at product intent.

- **`ProfileSection.jsx`** (web): threads a `disabled` field + `.profile-disabled`
  CSS class per profile, sourced from a `toggleProfileMode` store action —
  but no button in the UI actually calls `toggleProfileMode` (dead wiring,
  noted separately in the lint-cleanup commit from this session too).
  Renderer has none of this. Don't port until the toggle UI itself is built.
- **`SettingsPanel.jsx`** (web): has three extra sections renderer lacks —
  `ParentAccessSection` (invite a second parent — a multi-owner /
  `activeOwnerUid` feature that may not make sense for a single-owner
  desktop install), `PauseSection` ("снять блокировки"), `AppLogsSection`
  ("Логи"). `AccountSection.jsx` also differs by 137 lines for related
  reasons. Needs a product decision on which of these the desktop app
  should get, not a mechanical copy.
- **`RemindersPanel.jsx`** (23 diff lines): web uses an in-app `ConfirmModal`
  for delete confirmation; renderer uses the browser-native `confirm()`.
  This is a real, safe-looking UX improvement to port, but `ConfirmModal`
  is currently web-only (`web/src/components/ConfirmModal.jsx`, never moved
  to `shared/ui/`) — porting this means moving `ConfirmModal` to
  `shared/ui/` first. Small, contained, good candidate for the next pass.

## Same feature, different code structure — safe to reconcile, needs care

- **`ContentArea.jsx`** (303 vs 279 lines): both apps have Activity/
  Storage/Chat/Notifications tabs, but web implements them as separate
  early-return JSX blocks while renderer consolidates them into one ternary
  chain with a shared `Panel` variable for chat/notifications. Same
  functionality, renderer's structure is more DRY. A careful full trace
  (every `activeTab` branch, every CSS class like `content-area--chat`)
  would let renderer's structure become canonical — didn't attempt this
  pass because a routing bug here would affect every panel in both apps and
  needs interactive verification to be safe, not just a code read.

## CSS-only divergence — needs visual verification, not attempted

All of these differ substantially (35–418 diff lines) and most contain a
handful of `@media`/mobile-only rules mixed in with what's probably
harmless drift (color tweaks, spacing). Diff-reading isn't reliable enough
to separate "safe to unify" from "will visibly break a layout" for CSS —
this needs an actual side-by-side render in both apps:

`WebPanel.css`, `ProgramsPanel.css`, `NavSidebar.css`, `PomodoroPanel.css`,
`ScreenshotsPanel.css`, `RemindersPanel.css`, `ProfilePanel.css`,
`NotificationsPanel.css`, `ContentArea.css`, `SettingsPanel.css`.

## Suggested order for a follow-up pass

1. Move `ConfirmModal` to `shared/ui/`, port renderer's `RemindersPanel`
   confirm-dialog UX from web (small, contained, no CSS conflict since
   `ConfirmModal` doesn't exist in renderer at all yet).
2. Reconcile `ContentArea.jsx` onto renderer's DRYer structure, with an
   actual click-through test of every tab in both apps afterward.
3. Decide product-level: does the desktop app get `PowerPanel` scheduling,
   `ParentAccessSection`, `PauseSection`, `AppLogsSection`, and the
   profile-disable toggle, or do these stay web-only by design? This gates
   whether `PowerPanel`/`SettingsPanel`/`ProfileSection` are ever merged at
   all.
4. Only after 1–3: tackle the CSS-only diffs, with a browser open to both
   apps side by side.
