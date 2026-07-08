import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCMA } from '@/hooks/useCMA';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { CMAData } from '@/types/domain/movements';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

describe('useCMA', () => {
  let mockRecord: DailyRecord;
  const saveAndUpdate = vi.fn();
  const patchRecord = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRecord = DataFactory.createMockDailyRecord('2025-01-01');
  });

  it('should add a CMA entry with normalized data', () => {
    const { result } = renderHook(() => useCMA(mockRecord, saveAndUpdate, patchRecord));

    const cmaData: Omit<CMAData, 'id'> = {
      bedName: 'CMA 1',
      patientName: 'john doe', // should be capitalized
      rut: '111111111', // should be formatted
      age: '45',
      diagnosis: 'Surgery',
      specialty: 'Surgery',
      interventionType: 'Cirugía Mayor Ambulatoria',
    };

    act(() => {
      result.current.addCMA(cmaData);
    });

    expect(patchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        cma: expect.arrayContaining([
          expect.objectContaining({
            patientName: 'John Doe',
            rut: '11.111.111-1',
            bedName: 'CMA 1',
          }),
        ]),
      })
    );
    expect(saveAndUpdate).not.toHaveBeenCalled();
  });

  it('adds CMA and clears the original bed in one patch when the movement comes from a bed', () => {
    mockRecord.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente CMA',
      rut: '11.111.111-1',
      clinicalEpisodeId: 'ep-cma-source',
      pathology: 'Colelitiasis',
      location: 'Sector A',
    });
    const { result } = renderHook(() => useCMA(mockRecord, saveAndUpdate, patchRecord));

    act(() => {
      result.current.addCMA({
        bedName: 'R1',
        patientName: 'paciente cma',
        rut: '111111111',
        age: '45',
        diagnosis: 'Colelitiasis',
        specialty: 'Cirugía',
        interventionType: 'Cirugía Mayor Ambulatoria',
        originalBedId: 'R1',
      });
    });

    expect(patchRecord).toHaveBeenCalledTimes(1);
    expect(patchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        cma: expect.arrayContaining([
          expect.objectContaining({
            patientName: 'Paciente Cma',
            originalBedId: 'R1',
            clinicalEpisodeId: 'ep-cma-source',
            originalData: expect.objectContaining({
              clinicalEpisodeId: 'ep-cma-source',
            }),
          }),
        ]),
        'beds.R1': expect.objectContaining({
          bedId: 'R1',
          patientName: '',
          rut: '',
          pathology: '',
          specialty: Specialty.EMPTY,
          status: PatientStatus.EMPTY,
          admissionDate: '',
          admissionTime: '',
          firstSeenDate: undefined,
          devices: [],
          handoffNote: '',
          handoffNoteDayShift: '',
          handoffNoteNightShift: '',
          medicalHandoffNote: '',
          medicalHandoffEntries: [],
          medicalHandoffAudit: undefined,
          clinicalCrib: undefined,
          clinicalEvents: [],
          hasCompanionCrib: false,
          location: 'Sector A',
        }),
      })
    );
    expect(saveAndUpdate).not.toHaveBeenCalled();
  });

  it('should tombstone a CMA entry without removing it from the persisted list', () => {
    mockRecord.cma = [DataFactory.createMockCMA({ id: 'cma-1' })];
    const { result } = renderHook(() => useCMA(mockRecord, saveAndUpdate, patchRecord));

    act(() => {
      result.current.deleteCMA('cma-1');
    });

    expect(patchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        cma: [
          expect.objectContaining({
            id: 'cma-1',
            deletedAt: expect.any(String),
            deletedReason: 'manual_delete',
          }),
        ],
      })
    );
  });

  it('should update a CMA entry with normalized data', () => {
    mockRecord.cma = [DataFactory.createMockCMA({ id: 'cma-1', patientName: 'Original' })];
    const { result } = renderHook(() => useCMA(mockRecord, saveAndUpdate, patchRecord));

    act(() => {
      result.current.updateCMA('cma-1', { patientName: 'updated name' });
    });

    expect(patchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        cma: [
          expect.objectContaining({
            id: 'cma-1',
            patientName: 'Updated Name',
          }),
        ],
      })
    );
  });

  it('converts a CMA entry into a home discharge in one movement patch', () => {
    mockRecord.cma = [
      DataFactory.createMockCMA({
        id: 'cma-1',
        patientName: 'Paciente CMA',
        rut: '11.111.111-1',
        age: '44',
        bedName: 'R1',
        originalBedId: 'R1',
        dischargeTime: '15:30',
        clinicalEpisodeId: 'episode-cma',
        originalData: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente CMA',
          clinicalEpisodeId: 'episode-cma',
        }),
      }),
    ];
    const { result } = renderHook(() => useCMA(mockRecord, saveAndUpdate, patchRecord));

    act(() => {
      result.current.convertCmaToHomeDischarge('cma-1');
    });

    expect(patchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        cma: [
          expect.objectContaining({
            id: 'cma-1',
            deletedAt: expect.any(String),
            deletedReason: 'converted_to_discharge',
          }),
        ],
        discharges: [
          expect.objectContaining({
            patientName: 'Paciente CMA',
            rut: '11.111.111-1',
            bedId: 'R1',
            time: '15:30',
            status: 'Vivo',
            dischargeType: 'Domicilio (Habitual)',
            clinicalEpisodeId: 'episode-cma',
          }),
        ],
      })
    );
  });

  it('should handle record being null', () => {
    const { result } = renderHook(() => useCMA(null, saveAndUpdate, patchRecord));

    act(() => {
      result.current.addCMA({
        bedName: '',
        patientName: '',
        rut: '',
        age: '',
        diagnosis: '',
        specialty: '',
        interventionType: 'Cirugía Mayor Ambulatoria',
      });
    });

    expect(saveAndUpdate).not.toHaveBeenCalled();
    expect(patchRecord).not.toHaveBeenCalled();
  });
});
