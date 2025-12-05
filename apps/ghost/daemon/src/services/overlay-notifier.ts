import type { WindowManager } from '../windows/window-manager';

let overlayWindowManager: WindowManager | null = null;

export function attachOverlayWindowManager(manager: WindowManager): void {
  overlayWindowManager = manager;
}

/**
 * Show a lightweight toast in the custom overlay window.
 * Falls back to console logging if the overlay is unavailable.
 * @param key Optional dedupe key; if the same key is sent repeatedly, the toast refreshes instead of stacking.
 * @param listening Optional flag to show waveform animation when Ghost is actively listening.
 */
export function showOverlayToast(title: string, body: string, duration: number = 4000, key?: string, listening?: boolean): void {
  if (overlayWindowManager) {
    try {
      overlayWindowManager.showToast(title, body, duration, key, listening);
      return;
    } catch (err) {
      console.warn('[Ghost][OverlayToast] Failed to render toast, falling back to log', err);
    }
  }

  console.log(`[Ghost][Toast] ${title}: ${body}`);
}
