import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '@/services/utils/loggerService';

describe('LoggerService', () => {
    beforeEach(() => {
        logger.clearEntries();
        logger.setLevel('debug');
        vi.restoreAllMocks();
    });

    it('should configure and get levels', () => {
        logger.setLevel('error');
        expect(logger.getLevel()).toBe('error');
    });

    it('should respect log levels', () => {
        logger.setLevel('warn');
        logger.debug('should not show');
        logger.info('should not show');
        logger.warn('should show');
        logger.error('should show');

        const entries = logger.getEntries();
        expect(entries).toHaveLength(2);
        expect(entries[0].level).toBe('warn');
    });

    it('should format messages correctly', () => {
        const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => { });
        logger.configure({ enableTimestamps: false, enableContext: true });
        logger.info('TestContext', 'TestMessage');

        expect(consoleSpy).toHaveBeenCalledWith('[INFO] [TestContext] TestMessage', '');
    });

    it('should handle data in logs', () => {
        const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => { });
        const testData = { id: 1 };
        logger.debug('Context', 'Msg', testData);
        expect(consoleSpy).toHaveBeenCalledWith(expect.any(String), testData);
    });

    it('should manage stored entries correctly', () => {
        logger.configure({ maxStoredEntries: 2 });
        logger.info('Entry 1');
        logger.info('Entry 2');
        logger.info('Entry 3');

        const entries = logger.getEntries();
        expect(entries).toHaveLength(2);
        expect(entries[0].message).toBe('Entry 2');
        expect(entries[1].message).toBe('Entry 3');
    });

    it('should create child loggers with context', () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
        logger.configure({ enableTimestamps: false, enableContext: true });
        const child = logger.child('ChildCtx');

        child.debug('DebugMsg');
        child.info('InfoMsg');
        child.warn('WarnMsg');
        child.error('ErrorMsg');

        expect(consoleSpy).toHaveBeenCalledWith('[WARN] [ChildCtx] WarnMsg', '');
    });

    it('should time function execution', async () => {
        const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => { });
        const result = await logger.time('TestTime', async () => {
            return 'done';
        });

        expect(result).toBe('done');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('TestTime completed in'), '');
    });

    it('should time function failure', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        const failingFn = async () => { throw new Error('Failed'); };

        await expect(logger.time('FailTime', failingFn)).rejects.toThrow('Failed');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('FailTime failed after'), expect.any(Error));
    });

    it('should handle different argument overloads', () => {
        const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => { });
        logger.debug('Message only');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Message only'), '');

        logger.debug('Context', 'Message with context');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Context] Message with context'), '');
    });
});
