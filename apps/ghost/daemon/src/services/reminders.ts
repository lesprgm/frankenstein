import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CreateReminderParams {
    title: string;
    notes?: string;
    dueDate?: string; // ISO string
}

export class RemindersService {
    private swiftScriptPath: string;

    constructor() {
        // Reusing the ocr directory for swift scripts for now
        this.swiftScriptPath = path.join(__dirname, '../ocr/create-reminder.swift');
    }

    async createReminder(params: CreateReminderParams): Promise<{ success: boolean; error?: string }> {
        // Short-circuit in non-macOS or sandboxed environments to avoid hangs
        if (process.platform !== 'darwin' || process.env.SWIFT_REMINDERS_DISABLED === 'true') {
            return { success: false, error: 'Reminders not available in this environment' };
        }

        try {
            const args = [
                this.swiftScriptPath,
                params.title,
                params.notes || '',
            ];

            if (params.dueDate) {
                args.push(params.dueDate);
            }

            const { stdout, stderr } = await execFileAsync('swift', args, { timeout: 3000 });

            if (stdout.includes('Success:')) {
                return { success: true };
            } else {
                return { success: false, error: stderr || stdout };
            }
        } catch (error) {
            console.error('[Ghost][Reminders] Failed to create reminder:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
}
