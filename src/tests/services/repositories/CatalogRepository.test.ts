// Unmock the repository so we can test the real thing
// (it is mocked globally in tests/setup.ts)
vi.unmock('@/services/repositories/CatalogRepository');

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CatalogRepository } from '@/services/repositories/CatalogRepository';
import * as catalogService from '@/services/storage/indexeddb/indexedDbCatalogService';
import * as firestoreService from '@/services/storage/firestore';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';

vi.mock('@/services/storage/indexeddb/indexedDbCatalogService', () => ({
  getCatalog: vi.fn(),
  saveCatalog: vi.fn(),
  getCatalogValues: vi.fn(),
  saveCatalogValues: vi.fn(),
  cacheCatalogValues: vi.fn(),
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

describe('CatalogRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
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

    it('saveNurses should save to both', async () => {
      await CatalogRepository.saveNurses([' Nurse A ', 'Nurse A', ''], []);
      expect(catalogService.cacheCatalogValues).toHaveBeenCalledWith('nurses', ['Nurse A'], true);
      expect(firestoreService.saveNurseCatalogToFirestore).toHaveBeenCalledWith(
        ['Nurse A'],
        expect.any(Array)
      );
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
    });

    it('saveTens should save to both', async () => {
      await CatalogRepository.saveTens([' TENS A ', 'TENS A', ''], []);
      expect(catalogService.cacheCatalogValues).toHaveBeenCalledWith('tens', ['TENS A'], true);
      expect(firestoreService.saveTensCatalogToFirestore).toHaveBeenCalledWith(
        ['TENS A'],
        expect.any(Array)
      );
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
      await CatalogRepository.saveProfessionals(profs, []);
      expect(catalogService.cacheCatalogValues).toHaveBeenCalledWith('professionals', profs, true);
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

  describe('Remote snapshots', () => {
    const subscriptions = [
      {
        catalog: 'nurses',
        subscribe: CatalogRepository.subscribeNurses,
        remote: firestoreService.subscribeToNurseCatalog,
        list: ['ENFERMERA SINTETICA A'],
      },
      {
        catalog: 'tens',
        subscribe: CatalogRepository.subscribeTens,
        remote: firestoreService.subscribeToTensCatalog,
        list: ['TENS SINTETICO A'],
      },
      {
        catalog: 'professionals',
        subscribe: CatalogRepository.subscribeProfessionals,
        remote: firestoreService.subscribeToProfessionalsCatalog,
        list: [{ name: 'PROFESIONAL SINTETICO A', phone: '' }],
      },
    ] as const;

    /** A snapshot arrives; its local copy is held until the case releases it. */
    const receiveSnapshot = ({ subscribe, remote, list }: (typeof subscriptions)[number]) => {
      let deliver!: (items: unknown[]) => Promise<void>;
      vi.mocked(remote).mockImplementation(callback => {
        deliver = callback as (items: unknown[]) => Promise<void>;
        return () => {};
      });
      let release!: () => void;
      vi.mocked(catalogService.cacheCatalogValues).mockImplementation(
        () => new Promise<void>(resolve => (release = resolve))
      );
      const callback = vi.fn();
      (subscribe as (cb: (items: unknown[]) => void) => () => void)(callback);
      const delivered = deliver([...list]);
      return { callback, finish: async () => (release(), await delivered) };
    };

    afterEach(() => setSessionGeneration(null));

    it.each(subscriptions)(
      'a $catalog snapshot whose session ended while it was stored locally reaches no screen',
      async row => {
        setSessionGeneration('synthetic-generation-A', 'user:synthetic-A');
        const snapshot = receiveSnapshot(row);
        setSessionGeneration('synthetic-generation-B', 'user:synthetic-B');
        await snapshot.finish();
        expect(catalogService.cacheCatalogValues).toHaveBeenCalledWith(row.catalog, row.list, true);
        expect(snapshot.callback).not.toHaveBeenCalled();
      }
    );

    it.each(subscriptions)(
      'a $catalog snapshot in the same session reaches the screen',
      async row => {
        setSessionGeneration('synthetic-generation-A', 'user:synthetic-A');
        const snapshot = receiveSnapshot(row);
        await snapshot.finish();
        expect(snapshot.callback).toHaveBeenCalledWith(row.list);
      }
    );
  });
});
