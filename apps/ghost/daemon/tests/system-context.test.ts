import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SystemContextService } from '../src/services/system-context';

// Mock electron clipboard
const mockReadText = vi.fn();
vi.mock('electron', () => ({
  clipboard: {
    readText: (...args: any[]) => mockReadText(...args),
  },
}));

// Mock active-win
const mockActiveWin = vi.fn();
vi.mock('active-win', () => {
  return {
    __esModule: true,
    default: mockActiveWin,
  };
});

// Mock child_process for osascript
const mockExec = vi.fn((cmd, cb) => {
  cb(null, '', '');
});
vi.mock('child_process', () => ({
  exec: (cmd: string, cb: any) => mockExec(cmd, cb),
}));

// Mock util.promisify to just return the mockExec wrapped
vi.mock('util', () => ({
  promisify: (fn: any) => {
    return async (...args: any[]) => {
      return new Promise((resolve, reject) => {
        fn(...args, (error: any, stdout: any, stderr: any) => {
          if (error) reject(error);
          else resolve({ stdout, stderr });
        });
      });
    };
  },
}));

describe('SystemContextService', () => {
  let service: SystemContextService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SystemContextService();
  });

  it('should capture active window details', async () => {
    mockActiveWin.mockResolvedValue({
      title: 'My Project - VS Code',
      owner: {
        name: 'Code',
        bundleId: 'com.microsoft.VSCode',
        path: '/Applications/Visual Studio Code.app',
      },
      url: undefined,
    });

    const context = await service.getContext();

    expect(context.activeWindow).toBeDefined();
    expect(context.activeWindow?.title).toBe('My Project - VS Code');
    expect(context.activeWindow?.owner.name).toBe('Code');
  });

  it('should capture accessibility context on macOS', async () => {
    // Mock platform to be darwin
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    mockActiveWin.mockResolvedValue(undefined);
    
    // Mock osascript output
    const mockAxOutput = JSON.stringify({
        role: 'AXTextArea',
        value: 'function hello() { console.log("world"); }',
        title: 'Editor',
        description: 'Main editor area'
    });
    
    mockExec.mockImplementation((cmd: string, cb: any) => {
        if (cmd.includes('osascript')) {
            cb(null, mockAxOutput, '');
        } else {
            cb(null, '', '');
        }
    });

    const context = await service.getContext();

    expect(context.accessibility).toBeDefined();
    expect(context.accessibility?.role).toBe('AXTextArea');
    expect(context.accessibility?.value).toContain('function hello');

    // Restore platform
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('should handle accessibility errors gracefully', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    mockActiveWin.mockResolvedValue(undefined);
    
    mockExec.mockImplementation((cmd: string, cb: any) => {
        cb(new Error('Script failed'), '', 'Error');
    });

    const context = await service.getContext();

    expect(context.accessibility).toBeUndefined();

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('should capture clipboard text', async () => {
    mockReadText.mockReturnValue('Copied text content');
    mockActiveWin.mockResolvedValue(undefined); // No active window

    const context = await service.getContext();

    expect(context.clipboard).toBe('Copied text content');
  });

  it('should handle errors gracefully when active-win fails', async () => {
    mockActiveWin.mockRejectedValue(new Error('Permission denied'));
    mockReadText.mockReturnValue('');

    const context = await service.getContext();

    expect(context.activeWindow).toBeUndefined();
    // Should still return empty object or partial context, not throw
    expect(context).toEqual({});
  });

  it('should ignore large clipboard content', async () => {
    const largeText = 'a'.repeat(6000); // > 5000 limit
    mockReadText.mockReturnValue(largeText);
    mockActiveWin.mockResolvedValue(undefined);

    const context = await service.getContext();

    expect(context.clipboard).toBeUndefined();
  });
});
