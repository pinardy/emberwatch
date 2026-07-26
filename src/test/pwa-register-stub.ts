/**
 * Stands in for `virtual:pwa-register/react`, which only exists when the
 * vite-plugin-pwa build pipeline is running. Aliased in `vite.config.ts` for
 * tests so the UI can be mounted outside a real build.
 */
export function useRegisterSW() {
  return {
    offlineReady: [false, () => {}] as [boolean, (v: boolean) => void],
    needRefresh: [false, () => {}] as [boolean, (v: boolean) => void],
    updateServiceWorker: async () => {},
  }
}
