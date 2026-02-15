import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CatalogRepository } from '@/services/repositories/CatalogRepository';
import * as idbService from '@/services/storage/indexedDBService';
import * as firestoreService from '@/services/storage/firestoreService';

vi.mock('@/services/storage/indexedDBService', () => ({
    getCatalog: vi.fn(),
    saveCatalog: vi.fn()
}));
vi.mock('@/services/storage/firestoreService', () => ({
    saveNurseCatalogToFirestore: vi.fn(),
    saveTensCatalogToFirestore: vi.fn(),
    subscribeToNurseCatalog: vi.fn(() => () => { }),
    subscribeToTensCatalog: vi.fn(() => () => { }),
    getNurseCatalogFromFirestore: vi.fn().mockResolvedValue([]),
    getTensCatalogFromFirestore: vi.fn().mockResolvedValue([]),
    getProfessionalsCatalogFromFirestore: vi.fn().mockResolvedValue([]),
    saveProfessionalsCatalogToFirestore: vi.fn(),
    subscribeToProfessionalsCatalog: vi.fn(() => () => { })
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({
    isFirestoreEnabled: vi.fn(() => true),
    isDemoModeActive: vi.fn(() => false)
}));
vi.mock('@/services/storage/legacyFirebaseService', () => ({
    getLegacyNurseCatalog: vi.fn().mockResolvedValue([]),
    getLegacyTensCatalog: vi.fn().mockResolvedValue([]),
}));

describe('CatalogRepository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Nurses', () => {
        it('getNurses should try Local then Firestore', async () => {
            vi.mocked(idbService.getCatalog).mockResolvedValueOnce(['Local Nurse']);

            const result = await CatalogRepository.getNurses();
            expect(result).toEqual(['Local Nurse']);
            expect(idbService.getCatalog).toHaveBeenCalledWith('nurses');
        });

        it('getNurses should return default placeholders when all sources are empty', async () => {
            vi.mocked(idbService.getCatalog).mockResolvedValueOnce([]);
            vi.mocked(firestoreService.getNurseCatalogFromFirestore).mockResolvedValueOnce([]);

            const result = await CatalogRepository.getNurses();
            expect(result).toEqual(['Enfermero/a 1', 'Enfermero/a 2']);
        });

        it('saveNurses should save to both', async () => {
            await CatalogRepository.saveNurses(['Nurse A']);
            expect(idbService.saveCatalog).toHaveBeenCalledWith('nurses', ['Nurse A']);
            expect(firestoreService.saveNurseCatalogToFirestore).toHaveBeenCalledWith(['Nurse A']);
        });

        it('subscribeNurses should call firestore service', () => {
            const cb = vi.fn();
            CatalogRepository.subscribeNurses(cb);
            expect(firestoreService.subscribeToNurseCatalog).toHaveBeenCalled();
        });
    });

    describe('TENS', () => {
        it('getTens should fetch from multiple sources', async () => {
            vi.mocked(idbService.getCatalog).mockResolvedValueOnce([]);
            const result = await CatalogRepository.getTens();
            expect(result).toEqual(['TENS 1', 'TENS 2', 'TENS 3']);
            expect(idbService.getCatalog).toHaveBeenCalledWith('tens');
            expect(firestoreService.getTensCatalogFromFirestore).toHaveBeenCalled();
        });

        it('saveTens should save to both', async () => {
            await CatalogRepository.saveTens(['TENS A']);
            expect(idbService.saveCatalog).toHaveBeenCalledWith('tens', ['TENS A']);
            expect(firestoreService.saveTensCatalogToFirestore).toHaveBeenCalledWith(['TENS A']);
        });

        it('subscribeTens should call firestore service', () => {
            const cb = vi.fn();
            CatalogRepository.subscribeTens(cb);
            expect(firestoreService.subscribeToTensCatalog).toHaveBeenCalled();
        });
    });

    describe('Professionals', () => {
        it('getProfessionals should work', async () => {
            vi.mocked(idbService.getCatalog).mockResolvedValueOnce([]);
            const result = await CatalogRepository.getProfessionals();
            expect(result).toEqual([]);
            expect(idbService.getCatalog).toHaveBeenCalledWith('professionals');
            expect(firestoreService.getProfessionalsCatalogFromFirestore).toHaveBeenCalled();
        });

        it('saveProfessionals should work', async () => {
            const profs = [{ name: 'Dr. X', phone: '123', specialty: 'Surgeon' }];
            await CatalogRepository.saveProfessionals(profs as any);
            expect(idbService.saveCatalog).toHaveBeenCalledWith('professionals', profs);
        });

        it('subscribeProfessionals should call firestore service', () => {
            const cb = vi.fn();
            CatalogRepository.subscribeProfessionals(cb);
            expect(firestoreService.subscribeToProfessionalsCatalog).toHaveBeenCalled();
        });
    });
});
