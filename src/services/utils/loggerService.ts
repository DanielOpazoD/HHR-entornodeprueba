/**
 * Logger Service
 * Centralized logging with configurable levels and structured output.
 * 
 * Features:
 * - Configurable log levels (debug, info, warn, error)
 * - Environment-aware (verbose in dev, minimal in prod)
 * - Structured log format with timestamps
 * - Context support for grouping related logs
 */

// ============================================================================
// Types
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    context?: string;
    data?: unknown;
}

interface LoggerConfig {
    minLevel: LogLevel;
    enableTimestamps: boolean;
    enableContext: boolean;
    maxStoredEntries: number;
}

// Level priority for filtering
const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    none: 4
};

// ============================================================================
// Logger Class
// ============================================================================

class LoggerService {
    private static instance: LoggerService;
    private config: LoggerConfig;
    private entries: LogEntry[] = [];

    private constructor() {
        // Default config based on environment
        const isDev = typeof window !== 'undefined' &&
            (window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1');

        this.config = {
            minLevel: isDev ? 'debug' : 'warn',
            enableTimestamps: true,
            enableContext: true,
            maxStoredEntries: 100
        };
    }

    static getInstance(): LoggerService {
        if (!LoggerService.instance) {
            LoggerService.instance = new LoggerService();
        }
        return LoggerService.instance;
    }

    // ========================================================================
    // Configuration
    // ========================================================================

    configure(config: Partial<LoggerConfig>): void {
        this.config = { ...this.config, ...config };
    }

    setLevel(level: LogLevel): void {
        this.config.minLevel = level;
    }

    getLevel(): LogLevel {
        return this.config.minLevel;
    }

    // ========================================================================
    // Core Logging Methods
    // ========================================================================

    private shouldLog(level: LogLevel): boolean {
        return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.config.minLevel];
    }

    private formatMessage(level: LogLevel, message: string, context?: string): string {
        const parts: string[] = [];

        if (this.config.enableTimestamps) {
            parts.push(`[${new Date().toISOString().slice(11, 23)}]`);
        }

        parts.push(`[${level.toUpperCase()}]`);

        if (context && this.config.enableContext) {
            parts.push(`[${context}]`);
        }

        parts.push(message);

        return parts.join(' ');
    }

    private storeEntry(entry: LogEntry): void {
        this.entries.push(entry);
        if (this.entries.length > this.config.maxStoredEntries) {
            this.entries.shift();
        }
    }

    private log(level: LogLevel, message: string, context?: string, data?: unknown): void {
        if (!this.shouldLog(level)) return;

        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            context,
            data
        };

        this.storeEntry(entry);

        const formattedMessage = this.formatMessage(level, message, context);

        switch (level) {
            case 'debug':
                // eslint-disable-next-line no-console
                console.debug(formattedMessage, data !== undefined ? data : '');
                break;
            case 'info':
                // eslint-disable-next-line no-console
                console.info(formattedMessage, data !== undefined ? data : '');
                break;
            case 'warn':
                console.warn(formattedMessage, data !== undefined ? data : '');
                break;
            case 'error':
                console.error(formattedMessage, data !== undefined ? data : '');
                break;
        }
    }

    // ========================================================================
    // Public API
    // ========================================================================

    debug(message: string, data?: unknown): void;
    debug(context: string, message: string, data?: unknown): void;
    debug(arg1: string, arg2?: unknown, arg3?: unknown): void {
        if (typeof arg2 === 'string') {
            this.log('debug', arg2, arg1, arg3);
        } else {
            this.log('debug', arg1, undefined, arg2);
        }
    }

    info(message: string, data?: unknown): void;
    info(context: string, message: string, data?: unknown): void;
    info(arg1: string, arg2?: unknown, arg3?: unknown): void {
        if (typeof arg2 === 'string') {
            this.log('info', arg2, arg1, arg3);
        } else {
            this.log('info', arg1, undefined, arg2);
        }
    }

    warn(message: string, data?: unknown): void;
    warn(context: string, message: string, data?: unknown): void;
    warn(arg1: string, arg2?: unknown, arg3?: unknown): void {
        if (typeof arg2 === 'string') {
            this.log('warn', arg2, arg1, arg3);
        } else {
            this.log('warn', arg1, undefined, arg2);
        }
    }

    error(message: string, data?: unknown): void;
    error(context: string, message: string, data?: unknown): void;
    error(arg1: string, arg2?: unknown, arg3?: unknown): void {
        if (typeof arg2 === 'string') {
            this.log('error', arg2, arg1, arg3);
        } else {
            this.log('error', arg1, undefined, arg2);
        }
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * Create a child logger with a fixed context
     */
    child(context: string): ChildLogger {
        return new ChildLogger(this, context);
    }

    /**
     * Get all stored log entries
     */
    getEntries(): LogEntry[] {
        return [...this.entries];
    }

    /**
     * Clear stored entries
     */
    clearEntries(): void {
        this.entries = [];
    }

    /**
     * Time a function execution
     */
    async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
        const start = performance.now();
        try {
            const result = await fn();
            const duration = performance.now() - start;
            this.debug(`${label} completed in ${duration.toFixed(2)}ms`);
            return result;
        } catch (error) {
            const duration = performance.now() - start;
            this.error(`${label} failed after ${duration.toFixed(2)}ms`, error);
            throw error;
        }
    }
}

// ============================================================================
// Child Logger (with fixed context)
// ============================================================================

class ChildLogger {
    constructor(
        private parent: LoggerService,
        private context: string
    ) { }

    debug(message: string, data?: unknown): void {
        this.parent.debug(this.context, message, data);
    }

    info(message: string, data?: unknown): void {
        this.parent.info(this.context, message, data);
    }

    warn(message: string, data?: unknown): void {
        this.parent.warn(this.context, message, data);
    }

    error(message: string, data?: unknown): void {
        this.parent.error(this.context, message, data);
    }
}

// ============================================================================
// Exports
// ============================================================================

export const logger = LoggerService.getInstance();

// Convenience exports for common patterns
export const log = {
    debug: logger.debug.bind(logger),
    info: logger.info.bind(logger),
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger)
};
