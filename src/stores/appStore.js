import { create } from 'zustand'

export const useAppStore = create((set) => ({
  selectedBusiness: null,
  businesses: [],
  isOnline: navigator.onLine,
  offlineQueueCount: 0,
  toast: null,

  setSelectedBusiness: (business) => set({ selectedBusiness: business }),
  setBusinesses: (businesses) => set({ businesses }),
  setOnline: (status) => set({ isOnline: status }),
  setOfflineQueueCount: (count) => set({ offlineQueueCount: count }),

  showToast: (message, type = 'info', duration = 3000) => {
    set({ toast: { message, type, id: Date.now() } })
    setTimeout(() => set({ toast: null }), duration)
  },
  clearToast: () => set({ toast: null }),
}))
