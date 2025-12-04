import { BrowserWindow, screen, shell } from 'electron';
import path from 'node:path';

export class WindowManager {
    private mainWindow: BrowserWindow | null = null;
    private overlayWindow: BrowserWindow | null = null;
    private toastWindow: BrowserWindow | null = null;

    constructor() { }

    public createMainWindow(): BrowserWindow {
        this.mainWindow = new BrowserWindow({
            width: 320,
            height: 120,
            show: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
            },
        });
        this.mainWindow.loadURL('about:blank');
        return this.mainWindow;
    }

    private createToastWindow(): BrowserWindow {
        if (this.toastWindow && !this.toastWindow.isDestroyed()) {
            return this.toastWindow;
        }

        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        const toastWidth = 280;
        const toastHeight = 120;

        this.toastWindow = new BrowserWindow({
            width: toastWidth,
            height: toastHeight,
            x: width - toastWidth - 20,
            y: 40,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            resizable: false,
            show: false,
            hasShadow: false,
            focusable: false,
            useContentSize: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
            },
        });

        this.toastWindow.loadFile(path.join(__dirname, '../overlay/toast.html'));
        return this.toastWindow;
    }

    public createOverlayWindow(): BrowserWindow {
        const { width } = screen.getPrimaryDisplay().workAreaSize;

        this.overlayWindow = new BrowserWindow({
            width: 240, // Reduced from 300 for more compact display
            height: 100, // Minimum height so overlay is visible even if resize fails
            useContentSize: true,
            x: width - 340, // Initial position with padding
            y: 40,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            resizable: false,
            show: false,
            hasShadow: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
            },
        });

        // Load from src/overlay in dev, or resources in prod
        // In a real app we'd handle dev vs prod paths more robustly
        this.overlayWindow.loadFile(path.join(__dirname, '../overlay/index.html'));

        return this.overlayWindow;
    }

    public resizeOverlay(contentHeight: number): void {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
            const { workArea } = screen.getPrimaryDisplay();
            const width = 240; // Reduced from 300 for more compact display
            const padding = 20; // "move it a bit to the left"

            // Calculate position: Top-right with padding
            let x = workArea.width - width - padding;

            // Ensure it doesn't go off-screen (left side)
            if (x < workArea.x) {
                x = workArea.x + padding;
            }

            // Max height constraint (e.g., 80% of screen height)
            const maxHeight = Math.floor(workArea.height * 0.8);
            const height = Math.min(contentHeight, maxHeight);

            this.overlayWindow.setContentSize(width, height);
            this.overlayWindow.setPosition(x, 40 + workArea.y); // 40px from top
        }
    }

    public getMainWindow(): BrowserWindow | null {
        return this.mainWindow;
    }

    public getOverlayWindow(): BrowserWindow | null {
        return this.overlayWindow;
    }

    public showOverlay(sources: any[], commandId?: string, apiKey?: string): void {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
            console.log('[WindowManager] Updating overlay with', sources.length, 'sources', commandId);

            // Always load the local file overlay (contains sources + graph iframe)
            this.overlayWindow.loadFile(path.join(__dirname, '../overlay/index.html'));

            // Send the update after page fully loads (not a race-prone setTimeout)
            this.overlayWindow.webContents.once('did-finish-load', () => {
                if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
                    this.overlayWindow.webContents.send('update-sources', { sources, commandId, apiKey });
                }
            });

            // Force show and focus sequence
            this.overlayWindow.showInactive();
            this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
            this.overlayWindow.setVisibleOnAllWorkspaces(true);

            // Adaptive sizing based on content
            if (commandId) {
                const width = 320;

                // Calculate height based on number of sources
                // Base: Header(40) + Graph(160) + Footer(30) = 230px
                // Per source: ~50px
                const baseHeight = 230;
                const sourceHeight = 50;
                const maxSourcesVisible = 5;

                const visibleSources = Math.min(sources.length, maxSourcesVisible);
                const calculatedHeight = baseHeight + (visibleSources * sourceHeight);

                // Clamp between 240px (minimal) and 380px (max comfortable)
                const height = Math.max(240, Math.min(380, calculatedHeight));

                this.overlayWindow.setSize(width, height);

                // Position: Top-Right (Notification area)
                const { workArea } = screen.getPrimaryDisplay();
                const x = workArea.x + workArea.width - width - 20;
                const y = workArea.y + 40;

                this.overlayWindow.setPosition(x, y);
            }

            setTimeout(() => {
                if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
                    this.overlayWindow.show();
                    this.overlayWindow.focus();
                }
            }, 50);

            console.log('[WindowManager] Overlay updated and shown');
        } else {
            console.warn('[WindowManager] Overlay window not available');
        }
    }

    public showToast(title: string, body: string, duration: number = 4000, key?: string): void {
        const toastWin = this.createToastWindow();
        if (!toastWin || toastWin.isDestroyed()) {
            console.warn('[WindowManager] Toast window not available for toast:', title, body);
            return;
        }

        toastWin.webContents.send('ghost/toast', { title, body, duration, key });
        toastWin.showInactive();
        toastWin.setAlwaysOnTop(true, 'screen-saver');
        toastWin.setVisibleOnAllWorkspaces(true);
    }

    public hideOverlay(): void {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
            this.overlayWindow.hide();
        }
    }

    public ensureMainWindow(): void {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
            this.createMainWindow();
        }
    }
}
