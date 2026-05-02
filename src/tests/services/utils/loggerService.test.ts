import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createScopedLogger, createScopedLoggerMap } from '@/services/utils/loggerScope';
import { logger } from '@/services/utils/loggerService';
import { restoreConsole, suppressConsole } from '@/tests/utils/consoleTestUtils';

describe('LoggerService', () => {
  beforeEach(() => {
    logger.clearEntries();
    logger.setLevel('debug');
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
  });

  it('exports logger and log shorthands', async () => {
    vi.resetModules();

    const runtimeLoggerModule = await import('@/services/utils/loggerService');

    expect(runtimeLoggerModule.logger).toBeDefined();
    expect(typeof runtimeLoggerModule.logger.debug).toBe('function');
    expect(typeof runtimeLoggerModule.logger.info).toBe('function');
    expect(typeof runtimeLoggerModule.logger.warn).toBe('function');
    expect(typeof runtimeLoggerModule.logger.error).toBe('function');
    expect(runtimeLoggerModule.log).toBeDefined();
    expect(typeof runtimeLoggerModule.log.debug).toBe('function');
    expect(typeof runtimeLoggerModule.log.info).toBe('function');
    expect(typeof runtimeLoggerModule.log.warn).toBe('function');
    expect(typeof runtimeLoggerModule.log.error).toBe('function');
  });

  it('defaults to warn unless diagnostics were explicitly enabled', async () => {
    vi.resetModules();
    window.localStorage.clear();

    const runtimeLoggerModule = await import('@/services/utils/loggerService');

    expect(runtimeLoggerModule.logger.getLevel()).toBe('warn');
  });

  it('honors an explicit diagnostics log level from localStorage', async () => {
    vi.resetModules();
    window.localStorage.setItem('hhr_log_level', 'debug');

    const runtimeLoggerModule = await import('@/services/utils/loggerService');

    expect(runtimeLoggerModule.logger.getLevel()).toBe('debug');
  });

  it('should configure and get levels', () => {
    logger.setLevel('error');
    expect(logger.getLevel()).toBe('error');
  });

  it('should respect log levels', () => {
    const consoleSpies = suppressConsole(['warn', 'error']);
    logger.setLevel('warn');
    try {
      logger.debug('should not show');
      logger.info('should not show');
      logger.warn('should show');
      logger.error('should show');

      const entries = logger.getEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].level).toBe('warn');
    } finally {
      restoreConsole(consoleSpies);
    }
  });

  it('should format messages correctly', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.configure({ enableTimestamps: false, enableContext: true });
    logger.info('TestContext', 'TestMessage');

    expect(consoleSpy).toHaveBeenCalledWith('[INFO] [TestContext] TestMessage', '');
  });

  it('should handle data in logs', () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const testData = { id: 1 };
    logger.debug('Context', 'Msg', testData);
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(String), testData);
  });

  it('should manage stored entries correctly', () => {
    const consoleSpies = suppressConsole(['info']);
    logger.configure({ maxStoredEntries: 2 });
    try {
      logger.info('Entry 1');
      logger.info('Entry 2');
      logger.info('Entry 3');

      const entries = logger.getEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].message).toBe('Entry 2');
      expect(entries[1].message).toBe('Entry 3');
    } finally {
      restoreConsole(consoleSpies);
    }
  });

  it('should create child loggers with context', () => {
    const consoleSpies = suppressConsole(['debug', 'info', 'error']);
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.configure({ enableTimestamps: false, enableContext: true });
    try {
      const child = createScopedLogger('ChildCtx');

      child.debug('DebugMsg');
      child.info('InfoMsg');
      child.warn('WarnMsg');
      child.error('ErrorMsg');

      expect(consoleSpy).toHaveBeenCalledWith('[WARN] [ChildCtx] WarnMsg', '');
    } finally {
      consoleSpy.mockRestore();
      restoreConsole(consoleSpies);
    }
  });

  it('should create logger maps with the requested named scopes', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.configure({ enableTimestamps: false, enableContext: true });

    const loggers = createScopedLoggerMap({
      authLogger: 'AuthCtx',
      exportLogger: 'ExportCtx',
    });

    loggers.authLogger.info('Auth ready');
    loggers.exportLogger.info('Export ready');

    expect(consoleSpy).toHaveBeenNthCalledWith(1, '[INFO] [AuthCtx] Auth ready', '');
    expect(consoleSpy).toHaveBeenNthCalledWith(2, '[INFO] [ExportCtx] Export ready', '');
  });

  it('should time function execution', async () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const result = await logger.time('TestTime', async () => {
      return 'done';
    });

    expect(result).toBe('done');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('TestTime completed in'), '');
  });

  it('should time function failure', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failingFn = async () => {
      throw new Error('Failed');
    };

    await expect(logger.time('FailTime', failingFn)).rejects.toThrow('Failed');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('FailTime failed after'),
      expect.any(Error)
    );
  });

  it('should handle different argument overloads', () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logger.debug('Message only');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Message only'), '');

    logger.debug('Context', 'Message with context');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Context] Message with context'),
      ''
    );
  });
});
