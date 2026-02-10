import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePatientAnalysis } from '@/hooks/usePatientAnalysis';
import { DailyRecordRepository } from '@/services/repositories/DailyRecordRepository';
import { PatientMasterRepository } from '@/services/repositories/PatientMasterRepository';

// Mock repositories using a more robust Vitest pattern
vi.mock('@/services/repositories/DailyRecordRepository', () => {
    return {
        DailyRecordRepository: {
            getAllDates: vi.fn(),
            getForDate: vi.fn(),
            updatePartial: vi.fn()
        }
    };
});

vi.mock('@/services/repositories/PatientMasterRepository', () => {
    return {
        PatientMasterRepository: {
            bulkUpsertPatients: vi.fn()
        }
    };
});

// Mock audit service
vi.mock('@/services/admin/auditService', () => ({
    logAuditEvent: vi.fn()
}));

vi.mock('@/services/admin/utils/auditUtils', () => ({
    getCurrentUserEmail: vi.fn().mockReturnValue('test@test.com')
}));

describe('usePatientAnalysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should run analysis and detect patients', async () => {
        const mockDates = ['2025-01-01'];
        const mockRecord = {
            date: '2025-01-01',
            beds: {
                'Bed-1': {
                    rut: '11.111.111-1',
                    patientName: 'John Doe',
                    admissionDate: '2025-01-01'
                }
            }
        };

        vi.mocked(DailyRecordRepository.getAllDates).mockResolvedValue(mockDates);
        vi.mocked(DailyRecordRepository.getForDate).mockResolvedValue(mockRecord as any);

        const { result } = renderHook(() => usePatientAnalysis());

        await act(async () => {
            await result.current.runAnalysis();
        });

        expect(result.current.analysis).not.toBeNull();
        expect(result.current.analysis?.uniquePatients).toBe(1);
        expect(result.current.analysis?.validPatients[0].fullName).toBe('John Doe');
    });

    it('should detect name conflicts', async () => {
        const mockDates = ['2025-01-01', '2025-01-02'];
        const record1 = {
            date: '2025-01-01',
            beds: { 'B1': { rut: '11.111.111-1', patientName: 'John Doe' } }
        };
        const record2 = {
            date: '2025-01-02',
            beds: { 'B1': { rut: '11.111.111-1', patientName: 'John Smith' } }
        };

        vi.mocked(DailyRecordRepository.getAllDates).mockResolvedValue(mockDates);
        vi.mocked(DailyRecordRepository.getForDate)
            .mockResolvedValueOnce(record1 as any)
            .mockResolvedValueOnce(record2 as any);

        const { result } = renderHook(() => usePatientAnalysis());

        await act(async () => {
            await result.current.runAnalysis();
        });

        expect(result.current.analysis?.conflicts).toHaveLength(1);
        expect(result.current.analysis?.conflicts[0].options).toContain('John Doe');
        expect(result.current.analysis?.conflicts[0].options).toContain('John Smith');
    });

    it('should resolve conflicts and harmonize history', async () => {
        // Setup initial state via analysis: Two days, different names for same RUT
        const mockDates = ['2025-01-01', '2025-01-02'];
        const record1 = {
            date: '2025-01-01',
            beds: { 'B1': { rut: '11.111.111-1', patientName: 'John Old' } }
        };
        const record2 = {
            date: '2025-01-02',
            beds: { 'B1': { rut: '11.111.111-1', patientName: 'John New' } }
        };
        vi.mocked(DailyRecordRepository.getAllDates).mockResolvedValue(mockDates);
        vi.mocked(DailyRecordRepository.getForDate)
            .mockResolvedValueOnce(record1 as any)
            .mockResolvedValueOnce(record2 as any);

        const { result } = renderHook(() => usePatientAnalysis());

        await act(async () => {
            await result.current.runAnalysis();
        });

        // Now resolve it
        await act(async () => {
            await result.current.resolveConflict('11.111.111-1', 'John Doe', true);
        });

        expect(DailyRecordRepository.updatePartial).toHaveBeenCalled();
        expect(result.current.analysis?.conflicts).toHaveLength(0);
    });

    it('should track admissions and ongoing events', async () => {
        const mockDates = ['2025-01-01', '2025-01-02'];
        const record1 = {
            date: '2025-01-01',
            beds: { 'B1': { rut: '11.111.111-1', patientName: 'John Doe', admissionDate: '2025-01-01' } }
        };
        const record2 = {
            date: '2025-01-02',
            beds: { 'B1': { rut: '11.111.111-1', patientName: 'John Doe', admissionDate: '2025-01-01' } }
        };
        vi.mocked(DailyRecordRepository.getAllDates).mockResolvedValue(mockDates);
        vi.mocked(DailyRecordRepository.getForDate)
            .mockResolvedValueOnce(record1 as any)
            .mockResolvedValueOnce(record2 as any);

        const { result } = renderHook(() => usePatientAnalysis());
        await act(async () => { await result.current.runAnalysis(); });

        const patient = result.current.analysis?.validPatients[0];
        // Should have 1 admission record, not 2 (second is an extension)
        const admissions = patient?.hospitalizations?.filter(h => h.type === 'Ingreso');
        expect(admissions).toHaveLength(1);
    });

    it('should track explicit discharges', async () => {
        const mockDates = ['2025-01-01'];
        const record1 = {
            date: '2025-01-01',
            beds: { 'B1': { rut: '11.111.111-1', patientName: 'John Doe' } },
            discharges: [{ rut: '11.111.111-1', bedName: 'B1', diagnosis: 'Done', status: 'Alta' }]
        };
        vi.mocked(DailyRecordRepository.getAllDates).mockResolvedValue(mockDates);
        vi.mocked(DailyRecordRepository.getForDate).mockResolvedValue(record1 as any);

        const { result } = renderHook(() => usePatientAnalysis());
        await act(async () => { await result.current.runAnalysis(); });

        const patient = result.current.analysis?.validPatients[0];
        const egresos = patient?.hospitalizations?.filter(h => h.type === 'Egreso');
        expect(egresos).toHaveLength(1);
    });

    it('should track silent discharges', async () => {
        const mockDates = ['2025-01-01', '2025-01-02'];
        const record1 = {
            date: '2025-01-01',
            beds: { 'B1': { rut: '11.111.111-1', patientName: 'John Doe' } }
        };
        const record2 = {
            date: '2025-01-02',
            beds: {} // Patient gone without explicit discharge
        };
        vi.mocked(DailyRecordRepository.getAllDates).mockResolvedValue(mockDates);
        vi.mocked(DailyRecordRepository.getForDate)
            .mockResolvedValueOnce(record1 as any)
            .mockResolvedValueOnce(record2 as any);

        const { result } = renderHook(() => usePatientAnalysis());
        await act(async () => { await result.current.runAnalysis(); });

        const patient = result.current.analysis?.validPatients[0];
        const autoEgresos = patient?.hospitalizations?.filter(h => h.type === 'Egreso');
        expect(autoEgresos).toHaveLength(1);
        expect(autoEgresos?.[0].id).toContain('egreso-auto');
    });

    it('should track transfers', async () => {
        const mockDates = ['2025-01-01'];
        const record = {
            date: '2025-01-01',
            beds: { 'B1': { rut: '11.111.111-1', patientName: 'John Doe' } },
            transfers: [{ rut: '11.111.111-1', bedName: 'B1', diagnosis: 'Heart', receivingCenter: 'Other Clinic' }]
        };
        vi.mocked(DailyRecordRepository.getAllDates).mockResolvedValue(mockDates);
        vi.mocked(DailyRecordRepository.getForDate).mockResolvedValue(record as any);

        const { result } = renderHook(() => usePatientAnalysis());
        await act(async () => { await result.current.runAnalysis(); });

        const patient = result.current.analysis?.validPatients[0];
        const traslados = patient?.hospitalizations?.filter(h => h.type === 'Traslado');
        expect(traslados).toHaveLength(1);
        expect(traslados?.[0].receivingCenter).toBe('Other Clinic');
    });

    it('should track death events', async () => {
        const mockDates = ['2025-01-01'];
        const record = {
            date: '2025-01-01',
            beds: { 'B1': { rut: '11.111.111-1', patientName: 'John Doe' } },
            discharges: [{ rut: '11.111.111-1', bedName: 'B1', status: 'Fallecido', diagnosis: 'Sepsis' }]
        };
        vi.mocked(DailyRecordRepository.getAllDates).mockResolvedValue(mockDates);
        vi.mocked(DailyRecordRepository.getForDate).mockResolvedValue(record as any);

        const { result } = renderHook(() => usePatientAnalysis());
        await act(async () => { await result.current.runAnalysis(); });

        const patient = result.current.analysis?.validPatients[0];
        expect(patient?.vitalStatus).toBe('Fallecido');
        const deathEvent = patient?.hospitalizations?.filter(h => h.type === 'Fallecimiento');
        expect(deathEvent).toHaveLength(1);
    });

    it('should resolve conflict without harmonization', async () => {
        const mockDates = ['2025-01-01', '2025-01-02'];
        const r1 = { beds: { 'B1': { rut: '11.111.111-1', patientName: 'N1' } } };
        const r2 = { beds: { 'B1': { rut: '11.111.111-1', patientName: 'N2' } } };
        vi.mocked(DailyRecordRepository.getAllDates).mockResolvedValue(mockDates);
        vi.mocked(DailyRecordRepository.getForDate).mockResolvedValueOnce(r1 as any).mockResolvedValueOnce(r2 as any);

        const { result } = renderHook(() => usePatientAnalysis());
        await act(async () => { await result.current.runAnalysis(); });

        await act(async () => {
            await result.current.resolveConflict('11.111.111-1', 'Correct Name', false);
        });

        expect(DailyRecordRepository.updatePartial).not.toHaveBeenCalled();
        expect(result.current.analysis?.validPatients[0].fullName).toBe('Correct Name');
    });

    it('should handle demographic mismatches during analysis', async () => {
        const mockDates = ['2025-01-01', '2025-01-02'];
        const record1 = {
            date: '2025-01-01',
            beds: {
                'B1': {
                    rut: '11.111.111-1',
                    patientName: 'John',
                    birthDate: '1990-01-01',
                    biologicalSex: 'Masculino',
                    isRapanui: false
                }
            }
        };
        const record2 = {
            date: '2025-01-02',
            beds: {
                'B1': {
                    rut: '11.111.111-1',
                    patientName: 'John',
                    birthDate: '1991-01-01', // mismatch
                    biologicalSex: 'Femenino', // mismatch
                    isRapanui: true // mismatch
                }
            }
        };
        vi.mocked(DailyRecordRepository.getAllDates).mockResolvedValue(mockDates);
        vi.mocked(DailyRecordRepository.getForDate)
            .mockResolvedValueOnce(record1 as any)
            .mockResolvedValueOnce(record2 as any);

        const { result } = renderHook(() => usePatientAnalysis());
        await act(async () => { await result.current.runAnalysis(); });

        expect(result.current.analysis?.uniquePatients).toBe(1);
    });

    it('should return early in resolveConflict if conflict or analysis missing', async () => {
        const { result } = renderHook(() => usePatientAnalysis());

        // No analysis run yet
        await act(async () => {
            await result.current.resolveConflict('123', 'Name', true);
        });
        expect(DailyRecordRepository.updatePartial).not.toHaveBeenCalled();
    });

    it('should run migration and handle success', async () => {
        const mockDates = ['2025-01-01'];
        const record1 = {
            date: '2025-01-01',
            beds: { 'B1': { rut: '11.111.111-1', patientName: 'John D.' } }
        };
        vi.mocked(DailyRecordRepository.getAllDates).mockResolvedValue(mockDates);
        vi.mocked(DailyRecordRepository.getForDate).mockResolvedValue(record1 as any);
        vi.mocked(PatientMasterRepository.bulkUpsertPatients).mockResolvedValue({ successes: 1, errors: 0 });

        const { result } = renderHook(() => usePatientAnalysis());

        await act(async () => {
            await result.current.runAnalysis();
        });

        await act(async () => {
            await result.current.runMigration();
        });

        expect(result.current.migrationResult?.successes).toBe(1);
    });

    it('should handle migration failure', async () => {
        const mockDates = ['2025-01-01'];
        const record1 = { date: '2025-01-01', beds: { 'B1': { rut: '11.111.111-1', patientName: 'John' } } };
        vi.mocked(DailyRecordRepository.getAllDates).mockResolvedValue(mockDates);
        vi.mocked(DailyRecordRepository.getForDate).mockResolvedValue(record1 as any);
        vi.mocked(PatientMasterRepository.bulkUpsertPatients).mockRejectedValue(new Error('Migration fail'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        const { result } = renderHook(() => usePatientAnalysis());
        await act(async () => { await result.current.runAnalysis(); });
        await act(async () => { await result.current.runMigration(); });

        expect(consoleSpy).toHaveBeenCalledWith('Migration failed', expect.any(Error));
        consoleSpy.mockRestore();
    });

    it('should handle analysis failure', async () => {
        vi.mocked(DailyRecordRepository.getAllDates).mockRejectedValue(new Error('Analysis fail'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        const { result } = renderHook(() => usePatientAnalysis());
        await act(async () => { await result.current.runAnalysis(); });

        expect(consoleSpy).toHaveBeenCalledWith('Analysis failed', expect.any(Error));
        consoleSpy.mockRestore();
    });

    it('should detect name conflicts across 3+ variations/days', async () => {
        const mockDates = ['2025-01-01', '2025-01-02', '2025-01-03'];
        const records = [
            { date: '2025-01-01', beds: { 'B1': { rut: '11.111.111-1', patientName: 'N1' } } },
            { date: '2025-01-02', beds: { 'B1': { rut: '11.111.111-1', patientName: 'N2' } } },
            { date: '2025-01-03', beds: { 'B1': { rut: '11.111.111-1', patientName: 'N3' } } }
        ];

        vi.mocked(DailyRecordRepository.getAllDates).mockResolvedValue(mockDates);
        vi.mocked(DailyRecordRepository.getForDate)
            .mockResolvedValueOnce(records[0] as any)
            .mockResolvedValueOnce(records[1] as any)
            .mockResolvedValueOnce(records[2] as any);

        const { result } = renderHook(() => usePatientAnalysis());
        await act(async () => { await result.current.runAnalysis(); });

        expect(result.current.analysis?.conflicts[0].options).toHaveLength(3);
        expect(result.current.analysis?.conflicts[0].records).toHaveLength(2); // First record is base, next 2 are conflicts
    });
});
