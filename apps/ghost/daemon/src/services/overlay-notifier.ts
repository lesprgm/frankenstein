import type { WindowManager } from '../windows/window-manager';

let overlayWindowManager: WindowManager | null = null;

export function attachOverlayWindowManager(manager: WindowManager): void {
  overlayWindowManager = manager;
}

/**
 * Show a lightweight toast in the custom overlay window.
 * Falls back to console logging if the overlay is unavailable.
 * @param key Optional dedupe key; if the same key is sent repeatedly, the toast refreshes instead of stacking.
 */
export function showOverlayToast(title: string, body: string, duration: number = 4000, key?: string): void {
  if (overlayWindowManager) {
    try {
      overlayWindowManager.showToast(title, body, duration, key);
      return;
    } catch (err) {
      console.warn('[Ghost][OverlayToast] Failed to render toast, falling back to log', err);
    }
  }

  console.log(`[Ghost][Toast] ${title}: ${body}`);
}
