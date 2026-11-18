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
import { CatalogConflictError } from '@/services/repositories/contracts/catalogChanges';

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
      vi.mocked(catalogService.cacheCatalogValues).mockImplementationOnce(
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

  describe('Local copy order', () => {
    const catalogs = [
      {
        catalog: 'nurses',
        subscribe: CatalogRepository.subscribeNurses,
        remoteSubscribe: firestoreService.subscribeToNurseCatalog,
        save: CatalogRepository.saveNurses,
        remoteSave: firestoreService.saveNurseCatalogToFirestore,
        read: CatalogRepository.getNurses,
        localRead: catalogService.getCatalog,
        remoteRead: firestoreService.getNurseCatalogFromFirestore,
        older: ['ENFERMERA SINTETICA A'],
        newer: ['ENFERMERA SINTETICA B'],
      },
      {
        catalog: 'tens',
        subscribe: CatalogRepository.subscribeTens,
        remoteSubscribe: firestoreService.subscribeToTensCatalog,
        save: CatalogRepository.saveTens,
        remoteSave: firestoreService.saveTensCatalogToFirestore,
        read: CatalogRepository.getTens,
        localRead: catalogService.getCatalog,
        remoteRead: firestoreService.getTensCatalogFromFirestore,
        older: ['TENS SINTETICO A'],
        newer: ['TENS SINTETICO B'],
      },
      {
        catalog: 'professionals',
        subscribe: CatalogRepository.subscribeProfessionals,
        remoteSubscribe: firestoreService.subscribeToProfessionalsCatalog,
        save: CatalogRepository.saveProfessionals,
        remoteSave: firestoreService.saveProfessionalsCatalogToFirestore,
        read: CatalogRepository.getProfessionals,
        localRead: catalogService.getCatalogValues,
        remoteRead: firestoreService.getProfessionalsCatalogFromFirestore,
        older: [{ name: 'PROFESIONAL SINTETICO', phone: '', specialty: 'Cirugía' }],
        newer: [{ name: 'PROFESIONAL SINTETICO', phone: '', specialty: 'Pediatría' }],
      },
    ] as const;
    type Row = (typeof catalogs)[number];
    type Answer = { resolve: (list: unknown) => void; reject: (error: unknown) => void };

    /** The next remote call of this kind answers only when the case says so. */
    const hold = (remoteCall: Row['remoteSave'] | Row['remoteRead']) => {
      let answer!: Answer;
      vi.mocked(remoteCall).mockImplementationOnce(
        () => new Promise<never>((resolve, reject) => (answer = { resolve, reject } as Answer))
      );
      return () => answer;
    };
    const save = (row: Row, list: readonly unknown[]) =>
      (row.save as (next: unknown[], base: unknown[]) => Promise<unknown>)([...list], []);
    const copies = (row: Row) =>
      vi
        .mocked(catalogService.cacheCatalogValues)
        .mock.calls.filter(([catalogId]) => catalogId === row.catalog)
        .map(([, list]) => list);

    it.each(catalogs)(
      'an earlier $catalog save answered last leaves the later confirmed list',
      async row => {
        const earlier = hold(row.remoteSave);
        const settled = save(row, row.older);
        await save(row, row.newer);
        earlier().resolve([...row.older]);
        await settled;
        expect(copies(row)).toEqual([row.newer]);
      }
    );

    it.each(catalogs)(
      'an earlier $catalog conflict answered last leaves the later confirmed list',
      async row => {
        const earlier = hold(row.remoteSave);
        const settled = save(row, row.older);
        await save(row, row.newer);
        earlier().reject(new CatalogConflictError([...row.older]));
        await expect(settled).rejects.toBeInstanceOf(CatalogConflictError);
        expect(copies(row)).toEqual([row.newer]);
      }
    );

    it.each(catalogs)(
      'an earlier $catalog read answered last leaves the later confirmed list',
      async row => {
        vi.mocked(row.localRead).mockResolvedValueOnce([]);
        const earlier = hold(row.remoteRead);
        const reading = row.read();
        await vi.waitFor(() => expect(row.remoteRead).toHaveBeenCalled());
        await save(row, row.newer);
        earlier().resolve([...row.older]);
        await reading;
        expect(copies(row)).toEqual([row.newer]);
      }
    );

    it.each(catalogs)('$catalog answers in order each refresh the copy', async row => {
      await save(row, row.older);
      await save(row, row.newer);
      vi.mocked(row.remoteSave).mockRejectedValueOnce(new CatalogConflictError([...row.older]));
      await expect(save(row, row.newer)).rejects.toBeInstanceOf(CatalogConflictError);
      expect(copies(row)).toEqual([row.older, row.newer, row.older]);
    });

    it.each(catalogs)(
      'a $catalog snapshot that arrived later is not replaced by an earlier save answered last',
      async row => {
        let deliver!: (items: unknown[]) => Promise<void>;
        vi.mocked(row.remoteSubscribe).mockImplementationOnce(callback => {
          deliver = callback as (items: unknown[]) => Promise<void>;
          return () => {};
        });
        (row.subscribe as (callback: (items: unknown[]) => void) => () => void)(vi.fn());
        const earlier = hold(row.remoteSave);
        const settled = save(row, row.older);
        await deliver([...row.newer]);
        earlier().resolve([...row.older]);
        await settled;
        expect(copies(row)).toEqual([row.newer]);
      }
    );

    it.each(catalogs)('a later save of another catalog does not hold back $catalog', async row => {
      const other = catalogs[(catalogs.indexOf(row) + 1) % catalogs.length];
      const earlier = hold(row.remoteSave);
      const settled = save(row, row.older);
      await save(other, other.newer);
      earlier().resolve([...row.older]);
      await settled;
      expect(copies(row)).toEqual([row.older]);
    });
  });
});
