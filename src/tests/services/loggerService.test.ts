/**
 * Tests for LoggerService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to test the logger functions
describe('LoggerService', () => {
    beforeEach(() => {
        vi.spyOn(console, 'debug').mockImplementation(() => { });
        vi.spyOn(console, 'info').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should export logger instance', async () => {
        const { logger } = await import('@/services/utils/loggerService');
        expect(logger).toBeDefined();
        expect(typeof logger.debug).toBe('function');
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.error).toBe('function');
    });

    it('should export log shorthand', async () => {
        const { log } = await import('@/services/utils/loggerService');
        expect(log).toBeDefined();
        expect(typeof log.debug).toBe('function');
        expect(typeof log.info).toBe('function');
        expect(typeof log.warn).toBe('function');
        expect(typeof log.error).toBe('function');
    });

    it('should allow setting log level', async () => {
        const { logger } = await import('@/services/utils/loggerService');

        logger.setLevel('warn');
        expect(logger.getLevel()).toBe('warn');

        logger.setLevel('debug');
        expect(logger.getLevel()).toBe('debug');
    });

    it('should create child loggers with context', async () => {
        const { logger } = await import('@/services/utils/loggerService');

        const childLogger = logger.child('TestContext');
        expect(childLogger).toBeDefined();
        expect(typeof childLogger.debug).toBe('function');
        expect(typeof childLogger.info).toBe('function');
    });

    it('should store log entries', async () => {
        const { logger } = await import('@/services/utils/loggerService');

        logger.clearEntries();
        logger.setLevel('debug');
        logger.info('Test message');

        const entries = logger.getEntries();
        expect(entries.length).toBeGreaterThan(0);
        expect(entries[entries.length - 1].message).toBe('Test message');
    });
});
