import { describe, expect, it, vi } from 'vitest';
import {
  LOCAL_SYNC_HINT_MESSAGE,
  createLocalSyncHint,
  isLocalhostHostname,
  shouldHintLocalSync,
} from '@/services/observability/localSyncDiagnostics';

describe('localSyncDiagnostics', () => {
  describe('isLocalhostHostname', () => {
    it('accepts localhost and 127.0.0.1', () => {
      expect(isLocalhostHostname('localhost')).toBe(true);
      expect(isLocalhostHostname('127.0.0.1')).toBe(true);
    });

    it('rejects other hosts and undefined', () => {
      expect(isLocalhostHostname('hospitalizadoshhr.netlify.app')).toBe(false);
      expect(isLocalhostHostname(undefined)).toBe(false);
    });
  });

  describe('shouldHintLocalSync', () => {
    it('is true only in development mode on localhost', () => {
      expect(shouldHintLocalSync('development', 'localhost')).toBe(true);
      expect(shouldHintLocalSync('development', '127.0.0.1')).toBe(true);
    });

    it('is false in test or production mode (so it never fires in CI or prod)', () => {
      expect(shouldHintLocalSync('test', 'localhost')).toBe(false);
      expect(shouldHintLocalSync('production', 'localhost')).toBe(false);
    });

    it('is false off localhost', () => {
      expect(shouldHintLocalSync('development', 'example.com')).toBe(false);
    });
  });

  describe('createLocalSyncHint', () => {
    it('warns exactly once with the hint message when gating allows', () => {
      const warn = vi.fn();
      const emit = createLocalSyncHint({ shouldHint: () => true, warn });

      emit();
      emit();
      emit();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(LOCAL_SYNC_HINT_MESSAGE);
    });

    it('never warns when gating disallows', () => {
      const warn = vi.fn();
      const emit = createLocalSyncHint({ shouldHint: () => false, warn });

      emit();
      emit();

      expect(warn).not.toHaveBeenCalled();
    });
  });
});
