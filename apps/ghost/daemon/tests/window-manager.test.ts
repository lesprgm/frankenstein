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
        },
        showInactive: vi.fn(),
        hide: vi.fn(),
        setContentSize: vi.fn(),
        setPosition: vi.fn(),
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
            width: 300,
            height: 0,
            useContentSize: true,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
        }));
        // Check positioning logic (width - 340)
        // 1920 - 340 = 1580
        expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
            x: 1580,
            y: 40,
        }));
        expect(window.loadFile).toHaveBeenCalled();
        expect(windowManager.getOverlayWindow()).toBe(window);
    });

    it('should resize overlay', () => {
        const window = windowManager.createOverlayWindow();

        // Test normal resize
        windowManager.resizeOverlay(200);
        expect(window.setContentSize).toHaveBeenCalledWith(300, 200);
        // 1920 - 300 - 20 = 1600
        expect(window.setPosition).toHaveBeenCalledWith(1600, 40);

        // Test max height constraint (0.8 * 1080 = 864)
        windowManager.resizeOverlay(1000);
        expect(window.setContentSize).toHaveBeenCalledWith(300, 864);
    });

    it('should update overlay with sources', () => {
        const window = windowManager.createOverlayWindow();
        const sources = [{ id: '1', score: 0.9 }];

        windowManager.updateOverlay(sources);

        expect(window.webContents.send).toHaveBeenCalledWith('update-sources', sources);
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
