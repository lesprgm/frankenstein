import { execFile, exec } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export class VisionService {
    private swiftScriptPath: string;

    constructor() {
        // Resolve the Swift OCR script for both dev (ts-node) and built (dist) environments.
        const distPath = path.join(__dirname, '../ocr/recognize-text.swift');
        const srcPath = path.join(__dirname, '../../src/ocr/recognize-text.swift');
        this.swiftScriptPath = fs.existsSync(distPath) ? distPath : srcPath;
    }

    /**
     * Get the title of the currently active window using AppleScript
     */
    private async getActiveWindowTitle(): Promise<string | null> {
        if (process.platform !== 'darwin') return null;

        try {
            const script = 'tell application "System Events" to get name of first window of (first application process whose frontmost is true)';
            const { stdout } = await execAsync(`osascript -e '${script}'`);
            return stdout.trim();
        } catch (error) {
            console.warn('[Ghost][Vision] Failed to get window title:', error);
            return null;
        }
    }

    /**
    * Captures the main screen and extracts text using macOS Vision framework.
    * Returns the extracted text and screenshot path, or null if failed.
    */
    async captureScreenContext(): Promise<{ text: string; screenshotPath: string; windowTitle?: string } | null> {
        const homeDir = os.homedir();
        const ghostDir = path.join(homeDir, '.ghost', 'screenshots');

        if (!fs.existsSync(ghostDir)) {
            fs.mkdirSync(ghostDir, { recursive: true });
        }

        const filename = `screen-${Date.now()}.png`;
        const screenshotPath = path.join(ghostDir, filename);

        try {
            // 0. Get window title first (before screenshot might change focus?)
            const windowTitle = await this.getActiveWindowTitle();

            // 1. Capture screenshot (silent, main monitor, png)
            // -x: silent (no sound)
            // -m: main monitor only (to avoid huge dual-screen images)
            // -r: do not add shadow (cleaner)
            await execAsync(`screencapture -x -m -r "${screenshotPath}"`);

            // 2. Run OCR
            const { stdout } = await execFileAsync('swift', [this.swiftScriptPath, screenshotPath]);

            const text = stdout.trim();
            // Return even if text is empty, as long as we have a screenshot
            return {
                text,
                screenshotPath,
                windowTitle: windowTitle || undefined
            };

        } catch (error) {
            console.error('[Ghost][Vision] Failed to capture/recognize:', error);
            // Cleanup on error only
            if (fs.existsSync(screenshotPath)) {
                fs.unlinkSync(screenshotPath);
            }
            return null;
        }
    }
}
