import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CatalogRepository } from '@/services/repositories/CatalogRepository';
import * as idbService from '@/services/storage/indexedDBService';
import * as firestoreService from '@/services/storage/firestoreService';

vi.mock('@/services/storage/indexedDBService');
vi.mock('@/services/storage/firestoreService');
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
            expect(idbService.getCatalog).toHaveBeenCalledWith('tens');
        });

        it('saveTens should save to both', async () => {
            await CatalogRepository.saveTens(['TENS A']);
            expect(idbService.saveCatalog).toHaveBeenCalledWith('tens', ['TENS A']);
            expect(firestoreService.saveTensCatalogToFirestore).toHaveBeenCalledWith(['TENS A']);
        });
    });

    describe('Professionals', () => {
        it('getProfessionals should work', async () => {
            vi.mocked(idbService.getCatalog).mockResolvedValueOnce([]);
            const result = await CatalogRepository.getProfessionals();
            expect(idbService.getCatalog).toHaveBeenCalledWith('professionals');
        });

        it('saveProfessionals should work', async () => {
            const profs = [{ name: 'Dr. X', phone: '123', specialty: 'Surgeon' }];
            await CatalogRepository.saveProfessionals(profs as any);
            expect(idbService.saveCatalog).toHaveBeenCalledWith('professionals', profs);
        });
    });
});
