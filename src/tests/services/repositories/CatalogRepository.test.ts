// Unmock the repository so we can test the real thing
// (it is mocked globally in tests/setup.ts)
vi.unmock('@/services/repositories/CatalogRepository');

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CatalogRepository } from '@/services/repositories/CatalogRepository';
import * as catalogService from '@/services/storage/indexeddb/indexedDbCatalogService';
import * as firestoreService from '@/services/storage/firestore';
import * as legacyCatalogBridge from '@/services/storage/migration/legacyCatalogReadBridge';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { isLegacyBridgeEnabled } from '@/services/repositories/legacyCompatibilityPolicy';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';

vi.mock('@/services/storage/indexeddb/indexedDbCatalogService', () => ({
  getCatalog: vi.fn(),
  saveCatalog: vi.fn(),
  getCatalogValues: vi.fn(),
  saveCatalogValues: vi.fn(),
}));
vi.mock('@/services/storage/firestore', () => ({
  saveNurseCatalogToFirestore: vi.fn(),
  saveTensCatalogToFirestore: vi.fn(),
  subscribeToNurseCatalog: vi.fn(() => () => {}),
  subscribeToTensCatalog: vi.fn(() => () => {}),
  getNurseCatalogFromFirestore: vi.fn().mockResolvedValue([]),
  getTensCatalogFromFirestore: vi.fn().mockResolvedValue([]),
  getProfessionalsCatalogFromFirestore: vi.fn().mockResolvedValue([]),
  saveProfessionalsCatalogToFirestore: vi.fn(),
  subscribeToProfessionalsCatalog: vi.fn(() => () => {}),
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));
vi.mock('@/services/storage/migration/legacyCatalogReadBridge', () => ({
  getLegacyNurseCatalog: vi.fn().mockResolvedValue([]),
  getLegacyTensCatalog: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/services/repositories/legacyCompatibilityPolicy', () => ({
  isLegacyBridgeEnabled: vi.fn(() => true),
}));

describe('CatalogRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
    vi.mocked(isLegacyBridgeEnabled).mockReturnValue(true);
  });

  describe('Nurses', () => {
    it('getNurses should try Local then Firestore', async () => {
      vi.mocked(catalogService.getCatalog).mockResolvedValueOnce(['Local Nurse']);

      const result = await CatalogRepository.getNurses();
      expect(result).toEqual(['Local Nurse']);
      expect(catalogService.getCatalog).toHaveBeenCalledWith('nurses');
    });

    it('getNurses should return default placeholders when all sources are empty', async () => {
      vi.mocked(catalogService.getCatalog).mockResolvedValueOnce([]);
      vi.mocked(firestoreService.getNurseCatalogFromFirestore).mockResolvedValueOnce([]);

      const result = await CatalogRepository.getNurses();
      expect(result).toEqual(['Enfermero/a 1', 'Enfermero/a 2']);
    });

    it('getNurses skips the legacy fallback when the legacy bridge is disabled', async () => {
      // Regression: the legacy catalog read must honor isLegacyBridgeEnabled() like the
      // record bridge, so VITE_LEGACY_COMPATIBILITY_MODE=disabled (e.g. local dev with no
      // legacy config) does not error on the missing VITE_LEGACY_FIREBASE_* vars.
      vi.mocked(isLegacyBridgeEnabled).mockReturnValue(false);
      vi.mocked(catalogService.getCatalog).mockResolvedValueOnce([]);
      vi.mocked(firestoreService.getNurseCatalogFromFirestore).mockResolvedValueOnce([]);

      const result = await CatalogRepository.getNurses();

      expect(legacyCatalogBridge.getLegacyNurseCatalog).not.toHaveBeenCalled();
      expect(result).toEqual(['Enfermero/a 1', 'Enfermero/a 2']);
    });

    it('saveNurses should save to both', async () => {
      await CatalogRepository.saveNurses([' Nurse A ', 'Nurse A', '']);
      expect(catalogService.saveCatalog).toHaveBeenCalledWith('nurses', ['Nurse A']);
      expect(firestoreService.saveNurseCatalogToFirestore).toHaveBeenCalledWith(['Nurse A']);
    });

    it('subscribeNurses should call firestore service', () => {
      const cb = vi.fn();
      CatalogRepository.subscribeNurses(cb);
      expect(firestoreService.subscribeToNurseCatalog).toHaveBeenCalled();
    });

    it('subscribeNurses should use local catalog without opening Firestore when disabled', async () => {
      vi.mocked(isFirestoreEnabled).mockReturnValue(false);
      vi.mocked(catalogService.getCatalog).mockResolvedValueOnce([' Nurse Local ', '']);
      const cb = vi.fn();

      const unsubscribe = CatalogRepository.subscribeNurses(cb);
      await Promise.resolve();

      expect(firestoreService.subscribeToNurseCatalog).not.toHaveBeenCalled();
      expect(catalogService.getCatalog).toHaveBeenCalledWith('nurses');
      expect(cb).toHaveBeenCalledWith(['Nurse Local']);
      expect(typeof unsubscribe).toBe('function');
    });

    it('subscribeNurses should reject non-function callbacks', () => {
      expect(() =>
        CatalogRepository.subscribeNurses(null as unknown as (nurses: string[]) => void)
      ).toThrow(/callback must be a function/);
    });
  });

  describe('TENS', () => {
    it('getTens should fetch from multiple sources', async () => {
      vi.mocked(catalogService.getCatalog).mockResolvedValueOnce([]);
      const result = await CatalogRepository.getTens();
      expect(result).toEqual(['TENS 1', 'TENS 2', 'TENS 3']);
      expect(catalogService.getCatalog).toHaveBeenCalledWith('tens');
      expect(firestoreService.getTensCatalogFromFirestore).toHaveBeenCalled();
      expect(legacyCatalogBridge.getLegacyTensCatalog).toHaveBeenCalled();
    });

    it('getTens skips the legacy fallback when the legacy bridge is disabled', async () => {
      vi.mocked(isLegacyBridgeEnabled).mockReturnValue(false);
      vi.mocked(catalogService.getCatalog).mockResolvedValueOnce([]);

      const result = await CatalogRepository.getTens();

      expect(legacyCatalogBridge.getLegacyTensCatalog).not.toHaveBeenCalled();
      expect(result).toEqual(['TENS 1', 'TENS 2', 'TENS 3']);
    });

    it('saveTens should save to both', async () => {
      await CatalogRepository.saveTens([' TENS A ', 'TENS A', '']);
      expect(catalogService.saveCatalog).toHaveBeenCalledWith('tens', ['TENS A']);
      expect(firestoreService.saveTensCatalogToFirestore).toHaveBeenCalledWith(['TENS A']);
    });

    it('subscribeTens should call firestore service', () => {
      const cb = vi.fn();
      CatalogRepository.subscribeTens(cb);
      expect(firestoreService.subscribeToTensCatalog).toHaveBeenCalled();
    });

    it('subscribeTens should use local catalog without opening Firestore when disabled', async () => {
      vi.mocked(isFirestoreEnabled).mockReturnValue(false);
      vi.mocked(catalogService.getCatalog).mockResolvedValueOnce([' TENS Local ', '']);
      const cb = vi.fn();

      CatalogRepository.subscribeTens(cb);
      await Promise.resolve();

      expect(firestoreService.subscribeToTensCatalog).not.toHaveBeenCalled();
      expect(catalogService.getCatalog).toHaveBeenCalledWith('tens');
      expect(cb).toHaveBeenCalledWith(['TENS Local']);
    });
  });

  describe('Professionals', () => {
    it('getProfessionals should work', async () => {
      vi.mocked(catalogService.getCatalogValues).mockResolvedValueOnce([]);
      const result = await CatalogRepository.getProfessionals();
      expect(result).toEqual([]);
      expect(catalogService.getCatalogValues).toHaveBeenCalledWith('professionals');
      expect(firestoreService.getProfessionalsCatalogFromFirestore).toHaveBeenCalled();
    });

    it('saveProfessionals should work', async () => {
      const profs: ProfessionalCatalogItem[] = [
        { name: 'Dr. X', phone: '123', specialty: 'Cirugía' },
      ];
      await CatalogRepository.saveProfessionals(profs);
      expect(catalogService.saveCatalogValues).toHaveBeenCalledWith('professionals', profs);
    });

    it('subscribeProfessionals should call firestore service', () => {
      const cb = vi.fn();
      CatalogRepository.subscribeProfessionals(cb);
      expect(firestoreService.subscribeToProfessionalsCatalog).toHaveBeenCalled();
    });

    it('subscribeProfessionals should use local catalog without opening Firestore when disabled', async () => {
      vi.mocked(isFirestoreEnabled).mockReturnValue(false);
      const professionals: ProfessionalCatalogItem[] = [
        { name: 'Dr. Local', specialty: 'Medicina Interna', phone: '' },
      ];
      vi.mocked(catalogService.getCatalogValues).mockResolvedValueOnce(professionals);
      const cb = vi.fn();

      CatalogRepository.subscribeProfessionals(cb);
      await Promise.resolve();

      expect(firestoreService.subscribeToProfessionalsCatalog).not.toHaveBeenCalled();
      expect(catalogService.getCatalogValues).toHaveBeenCalledWith('professionals');
      expect(cb).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'Dr. Local',
          specialty: 'Medicina Interna',
        }),
      ]);
    });
  });
});
