export const createUiSlice = (set) => ({
  activeTab: 'permanent',
  activeSubTab: 'programs',
  programSearch: '',
  programFilter: 'all',
  showSettings: false,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setActiveSubTab: (sub) => set({ activeSubTab: sub }),
  setProgramSearch: (q) => set({ programSearch: q }),
  setProgramFilter: (f) => set({ programFilter: f }),
  setShowSettings: (v) => set({ showSettings: v })
})
