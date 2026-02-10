import { clipboard } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface SystemContext {
    activeWindow?: {
        title: string;
        owner: {
            name: string;
            bundleId?: string;
            path?: string;
        };
        url?: string;
    };
    accessibility?: {
        role?: string;
        value?: string;
        title?: string;
        description?: string;
    };
    clipboard?: string;
}

export class SystemContextService {
    async getContext(): Promise<SystemContext> {
        const context: SystemContext = {};

        // Get Active Window
        try {
            // Dynamic import for ESM package in CommonJS environment
            const { default: activeWin } = await import('active-win');
            const win = await activeWin();
            if (win) {
                context.activeWindow = {
                    title: win.title,
                    owner: {
                        name: win.owner.name,
                        bundleId: (win.owner as any).bundleId,
                        path: (win.owner as any).path,
                    },
                    url: (win as any).url, // Some platforms support URL
                };
            }
        } catch (error) {
            console.warn('[Ghost] Failed to get active window:', error);
        }

        // Get Accessibility Context (macOS only for now)
        if (process.platform === 'darwin') {
            try {
                const axData = await this.getMacOSAccessibility();
                if (axData) {
                    context.accessibility = axData;
                }
            } catch (error) {
                // Ignore errors, accessibility might not be enabled
            }
        }

        // Get Clipboard (Text only for now)
        try {
            const text = clipboard.readText();
            if (text && text.length < 5000) { // Limit size
                context.clipboard = text;
            }
        } catch (error) {
            console.warn('[Ghost] Failed to read clipboard:', error);
        }

        return context;
    }

    private async getMacOSAccessibility(): Promise<SystemContext['accessibility'] | null> {
        const script = `
            try
                tell application "System Events"
                    set frontApp to first application process whose frontmost is true
                    set focusedElem to value of attribute "AXFocusedUIElement" of frontApp
                    
                    set elemRole to role of focusedElem
                    set elemValue to value of focusedElem
                    set elemTitle to title of focusedElem
                    set elemDesc to description of focusedElem
                    
                    return "{\\"role\\": \\"" & elemRole & "\\", \\"value\\": \\"" & elemValue & "\\", \\"title\\": \\"" & elemTitle & "\\", \\"description\\": \\"" & elemDesc & "\\"}"
                end tell
            on error
                return ""
            end try
        `;

        try {
            const { stdout } = await execAsync(`osascript -e '${script}'`);
            if (!stdout || stdout.trim() === '') return null;
            
            // Clean up output if needed (osascript might return "missing value")
            const jsonStr = stdout.replace(/missing value/g, 'null');
            const data = JSON.parse(jsonStr);
            
            // Filter out nulls/empty
            const result: any = {};
            if (data.role && data.role !== 'null') result.role = data.role;
            if (data.value && data.value !== 'null') result.value = String(data.value).substring(0, 1000); // Limit length
            if (data.title && data.title !== 'null') result.title = data.title;
            if (data.description && data.description !== 'null') result.description = data.description;
            
            return Object.keys(result).length > 0 ? result : null;
        } catch (e) {
            return null;
        }
    }
}

