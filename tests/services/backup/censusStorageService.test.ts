import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    uploadCensus,
    checkCensusExists,
    deleteCensusFile,
    listCensusYears,
    listCensusMonths,
    listCensusFilesInMonth
} from '@/services/backup/censusStorageService';
import {
    ref,
    uploadBytes,
    getDownloadURL,
    getMetadata,
    deleteObject
} from 'firebase/storage';

// Mock firebase/storage
vi.mock('firebase/storage', () => ({
    ref: vi.fn(),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    listAll: vi.fn(),
    deleteObject: vi.fn(),
    getMetadata: vi.fn()
}));

// Mock baseStorageService helpers
vi.mock('@/services/backup/baseStorageService', () => ({
    MONTH_NAMES: [],
    createListYears: vi.fn(() => vi.fn()),
    createListMonths: vi.fn(() => vi.fn()),
    createListFilesInMonth: vi.fn(() => vi.fn())
}));

describe('censusStorageService', () => {
    const mockDate = '2025-01-01';
    const mockBlob = new Blob(['content'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('uploadCensus', () => {
        it('should upload census and return download URL', async () => {
            vi.mocked(uploadBytes).mockResolvedValue({} as any);
            vi.mocked(getDownloadURL).mockResolvedValue('http://download.url');

            const url = await uploadCensus(mockBlob, mockDate);

            expect(ref).toHaveBeenCalled();
            expect(uploadBytes).toHaveBeenCalled();
            expect(getDownloadURL).toHaveBeenCalled();
            expect(url).toBe('http://download.url');
        });
    });

    describe('checkCensusExists', () => {
        it('should return true if file exists', async () => {
            vi.mocked(getMetadata).mockResolvedValue({} as any);
            const exists = await checkCensusExists(mockDate);
            expect(exists).toBe(true);
        });

        it('should return false if file not found', async () => {
            vi.mocked(getMetadata).mockRejectedValue({ code: 'storage/object-not-found' });
            const exists = await checkCensusExists(mockDate);
            expect(exists).toBe(false);
        });

        it('should return false and log error for other errors', async () => {
            vi.mocked(getMetadata).mockRejectedValue(new Error('Other Error'));
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            const exists = await checkCensusExists(mockDate);

            expect(exists).toBe(false);
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('deleteCensusFile', () => {
        it('should call deleteObject', async () => {
            vi.mocked(deleteObject).mockResolvedValue(undefined as any);
            await deleteCensusFile(mockDate);
            expect(deleteObject).toHaveBeenCalled();
        });
    });

    describe('Factory-provided functions', () => {
        it('should exist', () => {
            expect(listCensusYears).toBeDefined();
            expect(listCensusMonths).toBeDefined();
            expect(listCensusFilesInMonth).toBeDefined();
        });
    });
});
