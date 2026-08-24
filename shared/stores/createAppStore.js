import { create } from 'zustand'
import { createAlertsSlice } from './slices/alertsSlice.js'
import { createAuthSlice } from './slices/authSlice.js'
import { createCommandsSlice } from './slices/commandsSlice.js'
import { createDerivedSelectors } from './slices/derivedSelectors.js'
import { createDevicesSlice } from './slices/devicesSlice.js'
import { createPomodoroSlice } from './slices/pomodoroSlice.js'
import { createProfilesSlice } from './slices/profilesSlice.js'
import { createRulesSlice } from './slices/rulesSlice.js'
import { createScreenshotsSlice } from './slices/screenshotsSlice.js'
import { createUiSlice } from './slices/uiSlice.js'
import { createChatSlice } from './slices/chatSlice.js'
import { createChildrenSlice } from './slices/childrenSlice.js'

export function createAppStore() {
  return create((set, get) => ({
    ...createAuthSlice(set, get),
    ...createUiSlice(set, get),
    ...createDevicesSlice(set, get),
    ...createRulesSlice(set, get),
    ...createProfilesSlice(set, get),
    ...createPomodoroSlice(set, get),
    ...createAlertsSlice(set, get),
    ...createCommandsSlice(set, get),
    ...createScreenshotsSlice(set, get),
    ...createChatSlice(set, get),
    ...createChildrenSlice(set, get),
    ...createDerivedSelectors(set, get)
  }))
}
