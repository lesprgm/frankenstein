import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WindowManager } from '../src/windows/window-manager';
import { BrowserWindow, screen } from 'electron';

// Mock Electron
vi.mock('electron', () => {
    const mBrowserWindow = {
        loadURL: vi.fn(),
        loadFile: vi.fn(),
        webContents: {
            send: vi.fn(),
            once: vi.fn((event: string, cb: () => void) => {
                // Immediately call the callback for did-finish-load
                if (event === 'did-finish-load') {
                    setTimeout(cb, 0);
                }
            }),
        },
        showInactive: vi.fn(),
        hide: vi.fn(),
        show: vi.fn(),
        focus: vi.fn(),
        setContentSize: vi.fn(),
        setPosition: vi.fn(),
        setSize: vi.fn(),
        setAlwaysOnTop: vi.fn(),
        setVisibleOnAllWorkspaces: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false),
        on: vi.fn(),
    };

    return {
        BrowserWindow: vi.fn(() => mBrowserWindow),
        screen: {
            getPrimaryDisplay: vi.fn().mockReturnValue({
                workAreaSize: { width: 1920, height: 1080 },
                workArea: { x: 0, y: 0, width: 1920, height: 1080 }
            }),
        },
        shell: {
            openPath: vi.fn(),
        },
    };
});

describe('WindowManager', () => {
    let windowManager: WindowManager;

    beforeEach(() => {
        vi.clearAllMocks();
        windowManager = new WindowManager();
    });

    it('should create main window', () => {
        const window = windowManager.createMainWindow();
        expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
            width: 320,
            height: 120,
            show: false,
        }));
        expect(window.loadURL).toHaveBeenCalledWith('about:blank');
        expect(windowManager.getMainWindow()).toBe(window);
    });

    it('should create overlay window', () => {
        const window = windowManager.createOverlayWindow();
        expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
            width: 360, // Increased for better readability
            height: 100, // Minimum height so overlay is visible even if resize fails
            useContentSize: true,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            show: false,
            skipTaskbar: true,
            resizable: false,
            hasShadow: false,
        }));
        // Check positioning logic (width - 380)
        // 1920 - 380 = 1540
        expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
            x: 1540,
            y: 40,
        }));
        expect(window.loadFile).toHaveBeenCalled();
        expect(windowManager.getOverlayWindow()).toBe(window);
    });

    it('should resize overlay', () => {
        const window = windowManager.createOverlayWindow();

        // Test normal resize
        windowManager.resizeOverlay(200);
        expect(window.setContentSize).toHaveBeenCalledWith(360, 200);
        // 1920 - 360 - 20 = 1540
        expect(window.setPosition).toHaveBeenCalledWith(1540, 40);

        // Test max height constraint (0.8 * 1080 = 864)
        windowManager.resizeOverlay(1000);
        expect(window.setContentSize).toHaveBeenCalledWith(360, 864);
    });

    it('should show overlay with sources and apiKey', async () => {
        const window = windowManager.createOverlayWindow();
        const sources = [{ id: '1', score: 0.9 }];
        const apiKey = 'test-api-key';

        windowManager.showOverlay(sources, 'cmd-123', apiKey);

        // Wait for the did-finish-load callback to fire
        await vi.waitFor(() => {
            expect(window.webContents.send).toHaveBeenCalledWith(
                'update-sources',
                expect.objectContaining({
                    sources,
                    commandId: 'cmd-123',
                    apiKey,
                })
            );
        });
        expect(window.showInactive).toHaveBeenCalled();
    });

    it('should hide overlay', () => {
        const window = windowManager.createOverlayWindow();
        windowManager.hideOverlay();
        expect(window.hide).toHaveBeenCalled();
    });

    it('should ensure main window exists', () => {
        // First creation
        windowManager.ensureMainWindow();
        expect(BrowserWindow).toHaveBeenCalledTimes(1);

        // Second call should not create new window if exists
        windowManager.ensureMainWindow();
        expect(BrowserWindow).toHaveBeenCalledTimes(1);
    });
});
