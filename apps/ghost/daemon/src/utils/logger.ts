import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export class Logger {
  private logPath: string;
  private logStream: fs.WriteStream;

  constructor() {
    const homeDir = os.homedir();
    const logDir = path.join(homeDir, '.ghost', 'logs');
    
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Rotate logs: ghost.log -> ghost.old.log
    this.logPath = path.join(logDir, 'ghost.log');
    const oldLogPath = path.join(logDir, 'ghost.old.log');

    if (fs.existsSync(this.logPath)) {
      if (fs.existsSync(oldLogPath)) {
        fs.unlinkSync(oldLogPath);
      }
      fs.renameSync(this.logPath, oldLogPath);
    }

    this.logStream = fs.createWriteStream(this.logPath, { flags: 'a' });
    
    this.write('INFO', 'Logger initialized');
  }

  private write(level: string, message: string, ...args: any[]) {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    
    const logLine = `[${timestamp}] [${level}] ${message} ${formattedArgs}\n`;
    
    // Write to file
    this.logStream.write(logLine);
    
    // Also write to original console (we will override console later, so this might be tricky if we call console.log inside)
    // Actually, we will use this Logger class to *replace* console methods or be called by them.
  }

  public info(message: string, ...args: any[]) {
    this.write('INFO', message, ...args);
  }

  public error(message: string, ...args: any[]) {
    this.write('ERROR', message, ...args);
  }
  
  public warn(message: string, ...args: any[]) {
    this.write('WARN', message, ...args);
  }
}

export const logger = new Logger();

// Hook into console
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

export function setupGlobalLogger() {
  console.log = (...args: any[]) => {
    logger.info(args[0], ...args.slice(1));
    originalLog.apply(console, args);
  };

  console.error = (...args: any[]) => {
    logger.error(args[0], ...args.slice(1));
    originalError.apply(console, args);
  };

  console.warn = (...args: any[]) => {
    logger.warn(args[0], ...args.slice(1));
    originalWarn.apply(console, args);
  };
  
  console.log('[Ghost] Global logger attached. Logs writing to ~/.ghost/logs/ghost.log');
}
