import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportDataJSON, exportDataCSV, importDataJSON, importDataCSV } from '@/services/exporters/exportService';
import * as indexedDBService from '@/services/storage/indexedDBService';
import * as validation from '@/schemas';
import { DailyRecord } from '@/types';

// Mock dependencies
vi.mock('@/services/storage/indexedDBService', () => ({
    getAllRecords: vi.fn(),
    saveRecord: vi.fn()
}));

vi.mock('@/schemas', () => ({
    validateBackupData: vi.fn()
}));


describe('exportService', () => {
    const mockRecord: DailyRecord = {
        date: '2025-01-01',
        beds: {
            'UTI-1': {
                patientName: 'Test Patient',
                rut: '12345678-9',
                pathology: 'Test',
                specialty: 'Medicina',
                status: 'Estable',
                admissionDate: '2025-01-01',
                devices: [],
                isUPC: false,
                isBlocked: false,
                location: 'UTI',
                deviceDetails: {}
            } as any
        },
        discharges: [{
            id: 'discharge-1',
            bedId: 'UTI-1',
            bedName: 'UTI 1',
            bedType: 'UTI',
            patientName: 'Paciente Alta',
            rut: '98765432-1',
            diagnosis: 'Recuperado',
            status: 'Vivo'
        }] as any,
        transfers: [{
            id: 'transfer-1',
            time: '10:00',
            bedId: 'UTI-2',
            bedName: 'UTI 2',
            bedType: 'UTI',
            patientName: 'Paciente Traslado',
            rut: '11111111-1',
            diagnosis: 'Fractura',
            evacuationMethod: 'Avión Comercial',
            receivingCenter: 'Hospital Regional'
        }] as any,
        cma: [],
        nurses: [],
        lastUpdated: new Date().toISOString(),
        activeExtraBeds: []
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Mock DOM methods
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn(() => 'blob:test'),
            revokeObjectURL: vi.fn()
        });
    });

    describe('exportDataJSON', () => {
        it('exports all records as JSON', async () => {
            const mockElement = { click: vi.fn() };
            vi.spyOn(document, 'createElement').mockReturnValue(mockElement as any);
            vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockElement as any);
            vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockElement as any);

            vi.mocked(indexedDBService.getAllRecords).mockResolvedValue({
                '2025-01-01': mockRecord
            });

            await exportDataJSON();

            expect(indexedDBService.getAllRecords).toHaveBeenCalled();
            expect(mockElement.click).toHaveBeenCalled();
        });
    });

    describe('exportDataCSV', () => {
        it('does nothing when record is null', () => {
            const createSpy = vi.spyOn(document, 'createElement');
            exportDataCSV(null);
            expect(createSpy).not.toHaveBeenCalled();
        });
    });


    describe('importDataJSON', () => {
        it('imports valid JSON data', async () => {
            const validData = { '2025-01-01': mockRecord };

            vi.mocked(validation.validateBackupData).mockReturnValue({
                success: true,
                data: validData as any
            });
            vi.mocked(indexedDBService.saveRecord).mockResolvedValue();

            const file = new File([JSON.stringify(validData)], 'backup.json', { type: 'application/json' });
            const result = await importDataJSON(file);

            expect(result).toBe(true);
            expect(indexedDBService.saveRecord).toHaveBeenCalled();
        });

        it('rejects invalid JSON', async () => {
            vi.mocked(validation.validateBackupData).mockReturnValue({
                success: false,
                errors: ['Invalid field']
            });

            const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { });

            const file = new File(['{"invalid": true}'], 'backup.json');
            const result = await importDataJSON(file);

            expect(result).toBe(false);
            expect(alertSpy).toHaveBeenCalled();
        });
    });

    describe('importDataCSV', () => {
        it('returns false as CSV import is not implemented', async () => {
            const file = new File(['data'], 'test.csv');
            const result = await importDataCSV(file);
            expect(result).toBe(false);
        });
    });
});
