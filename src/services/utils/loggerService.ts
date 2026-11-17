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

import { emitConsoleLog } from '@/services/utils/loggerConsoleSink';
import type { LogEntry, LogLevel, LoggerConfig } from '@/services/utils/loggerTypes';

const formatLogMessage = (
  config: Pick<LoggerConfig, 'enableTimestamps' | 'enableContext'>,
  level: LogLevel,
  message: string,
  context?: string
): string => {
  const parts: string[] = [];

  if (config.enableTimestamps) {
    parts.push(`[${new Date().toISOString().slice(11, 23)}]`);
  }

  parts.push(`[${level.toUpperCase()}]`);

  if (context && config.enableContext) {
    parts.push(`[${context}]`);
  }

  parts.push(message);

  return parts.join(' ');
};

export type { LogEntry, LogLevel } from '@/services/utils/loggerTypes';

// Level priority for filtering
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

const DIAGNOSTIC_LOG_LEVEL_STORAGE_KEY = 'hhr_log_level';
const DIAGNOSTIC_LOG_LEVEL_QUERY_KEYS = ['logLevel', 'hhr-log-level'] as const;

const normalizeLogLevel = (value: string | null | undefined): LogLevel | null => {
  switch (
    String(value || '')
      .trim()
      .toLowerCase()
  ) {
    case 'debug':
    case 'info':
    case 'warn':
    case 'error':
    case 'none':
      return String(value).trim().toLowerCase() as LogLevel;
    case 'verbose':
      return 'debug';
    default:
      return null;
  }
};

const readBrowserDiagnosticLogLevel = (): LogLevel | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const query = new URLSearchParams(window.location.search);
    for (const key of DIAGNOSTIC_LOG_LEVEL_QUERY_KEYS) {
      const queryLevel = normalizeLogLevel(query.get(key));
      if (queryLevel) {
        return queryLevel;
      }
    }
  } catch {
    // Ignore malformed URL state and fall back to storage/defaults.
  }

  try {
    const storedLevel = normalizeLogLevel(
      window.localStorage?.getItem(DIAGNOSTIC_LOG_LEVEL_STORAGE_KEY)
    );
    if (storedLevel) {
      return storedLevel;
    }
  } catch {
    // Ignore unavailable storage and fall back to defaults.
  }

  return null;
};

const resolveInitialLogLevel = (): LogLevel => readBrowserDiagnosticLogLevel() ?? 'warn';

const getPerformanceNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

// ============================================================================
// Logger Class
// ============================================================================

class LoggerService {
  private static instance: LoggerService;
  private config: LoggerConfig;
  private entries: LogEntry[] = [];

  private constructor() {
    // Keep runtime quiet by default; detailed diagnostics are opt-in via query/storage.
    this.config = {
      minLevel: resolveInitialLogLevel(),
      enableTimestamps: true,
      enableContext: true,
      maxStoredEntries: 100,
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
      data,
    };

    this.storeEntry(entry);

    const formattedMessage = formatLogMessage(this.config, level, message, context);
    emitConsoleLog(level, formattedMessage, data);
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
    const start = getPerformanceNow();
    try {
      const result = await fn();
      const duration = getPerformanceNow() - start;
      this.debug(`${label} completed in ${duration.toFixed(2)}ms`);
      return result;
    } catch (error) {
      const duration = getPerformanceNow() - start;
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
  ) {}

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
  error: logger.error.bind(logger),
};
