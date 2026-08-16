import { describe, expect, it } from 'vitest';
import {
  resolveInitialModuleFromLocation,
  resolveModuleFromPathname,
  resolveSyncedModuleUrl,
  shouldShowPrintButtonForModule,
} from '@/hooks/controllers/appStateNavigationController';

describe('appStateNavigationController', () => {
  describe('resolveModuleFromPathname', () => {
    it('resolves the root path to census', () => {
      expect(resolveModuleFromPathname('/')).toBe('CENSUS');
    });

    it('resolves known clean paths to their modules', () => {
      expect(resolveModuleFromPathname('/medical-handoff')).toBe('MEDICAL_HANDOFF');
      expect(resolveModuleFromPathname('/transfer-management')).toBeNull();
    });

    it('returns null for unknown paths', () => {
      expect(resolveModuleFromPathname('/censo')).toBeNull();
    });
  });

  describe('resolveInitialModuleFromLocation', () => {
    it('prefers a known clean path over the legacy query param', () => {
      expect(
        resolveInitialModuleFromLocation({
          pathname: '/statistics',
          search: '?module=MEDICAL_HANDOFF',
        })
      ).toBe('ANALYTICS');
    });

    it('falls back to the legacy module query when the path is not mapped', () => {
      expect(
        resolveInitialModuleFromLocation({
          pathname: '/admin',
          search: '?module=MEDICAL_HANDOFF',
        })
      ).toBe('MEDICAL_HANDOFF');
    });

    it('defaults to census when neither path nor query resolves a module', () => {
      expect(
        resolveInitialModuleFromLocation({
          pathname: '/admin',
          search: '?module=UNKNOWN_MODULE',
        })
      ).toBe('CENSUS');
    });
  });

  describe('resolveSyncedModuleUrl', () => {
    it('keeps the census date while normalizing the path', () => {
      const url = resolveSyncedModuleUrl({
        module: 'CENSUS',
        href: 'http://localhost:3001/?module=CENSUS&date=2026-04-22',
      });

      expect(url.pathname).toBe('/census');
      expect(url.search).toBe('?date=2026-04-22');
    });

    it('drops legacy date params outside census routes', () => {
      const url = resolveSyncedModuleUrl({
        module: 'MEDICAL_HANDOFF',
        href: 'http://localhost:3001/?module=MEDICAL_HANDOFF&date=2026-04-22',
      });

      expect(url.pathname).toBe('/medical-handoff');
      expect(url.search).toBe('');
    });
  });

  describe('shouldShowPrintButtonForModule', () => {
    it('returns true only for print-capable modules', () => {
      expect(shouldShowPrintButtonForModule('CUDYR')).toBe(true);
      expect(shouldShowPrintButtonForModule('NURSING_HANDOFF')).toBe(true);
      expect(shouldShowPrintButtonForModule('MEDICAL_HANDOFF')).toBe(true);
      expect(shouldShowPrintButtonForModule('CENSUS')).toBe(false);
    });
  });
});
