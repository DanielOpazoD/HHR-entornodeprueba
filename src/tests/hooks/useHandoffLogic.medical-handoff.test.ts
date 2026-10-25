import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { DEFAULT_NO_CHANGES_COMMENT } from '@/features/handoff/controllers/medicalSpecialtyHandoffController';
import { Specialty } from '@/types/domain/patientClassification';
import {
  BedActionsMock,
  DailyRecordDataMock,
  buildHandoffLogicParams,
  mockAuthContext,
  mockLogDebouncedEvent,
  mockRecord,
  renderUseHandoffLogic,
  resetUseHandoffLogicTestState,
  restoreUseHandoffLogicTestState,
  setDailyRecordBedActionsMock,
  setDailyRecordDataMock,
  setTodayIsoMock,
} from '@/tests/hooks/useHandoffLogic.test-support';

describe('useHandoffLogic medical handoff', () => {
  beforeEach(() => {
    resetUseHandoffLogicTestState();
  });

  afterEach(() => {
    restoreUseHandoffLogicTestState();
  });

  it('updates medical note with audit metadata and confirms current validity', async () => {
    const mockUpdateMultiple = vi.fn();
    setDailyRecordBedActionsMock({
      updatePatientMultiple: mockUpdateMultiple,
      updatePatient: vi.fn(),
      updateClinicalCrib: vi.fn(),
      updateClinicalCribMultiple: vi.fn(),
    } as unknown as BedActionsMock);

    const params = buildHandoffLogicParams({ type: 'medical' });
    const { result } = renderUseHandoffLogic(params);

    await act(async () => {
      await result.current.handleNursingNoteChange('R1', 'Evolución especialista');
    });

    expect(mockUpdateMultiple).toHaveBeenCalledWith(
      'R1',
      expect.objectContaining({
        medicalHandoffNote: 'Evolución especialista',
        medicalHandoffAudit: expect.objectContaining({
          lastSpecialistUpdateBy: expect.objectContaining({
            displayName: 'Dr. Test',
          }),
          lastSpecialistUpdateSpecialty: Specialty.MEDICINA,
          currentStatus: 'updated_by_specialist',
          currentStatusDate: '2025-01-01',
          currentStatusSpecialty: Specialty.MEDICINA,
        }),
        medicalHandoffEntries: expect.arrayContaining([
          expect.objectContaining({
            specialty: Specialty.MEDICINA,
            note: 'Evolución especialista',
          }),
        ]),
      }),
      expect.objectContaining({ patientName: expect.any(String), rut: expect.any(String) })
    );

    setDailyRecordDataMock({
      record: {
        ...mockRecord,
        beds: {
          ...mockRecord.beds,
          R1: {
            ...mockRecord.beds.R1,
            medicalHandoffNote: 'Evolución especialista',
            medicalHandoffEntries: [
              {
                id: 'legacy-primary',
                specialty: Specialty.MEDICINA,
                note: 'Evolución especialista',
              },
            ],
          },
        },
      } as DailyRecordDataMock['record'],
      syncStatus: 'synced' as DailyRecordDataMock['syncStatus'],
      lastSyncTime: null,
      inventory: {} as DailyRecordDataMock['inventory'],
      stabilityRules: {} as DailyRecordDataMock['stabilityRules'],
    } as DailyRecordDataMock);

    const { result: result2 } = renderUseHandoffLogic(params);
    await act(async () => {
      result2.current.handleMedicalRefreshAsCurrent('R1', 'legacy-primary');
    });

    expect(mockUpdateMultiple).toHaveBeenLastCalledWith(
      'R1',
      expect.objectContaining({
        medicalHandoffAudit: expect.objectContaining({
          currentStatus: 'updated_by_specialist',
          currentStatusDate: '2025-01-01',
          currentStatusSpecialty: Specialty.MEDICINA,
        }),
        medicalHandoffEntries: expect.arrayContaining([
          expect.objectContaining({
            id: 'legacy-primary',
            currentStatus: 'updated_by_specialist',
          }),
        ]),
      }),
      expect.objectContaining({ patientName: expect.any(String), rut: expect.any(String) })
    );
    expect(DEFAULT_NO_CHANGES_COMMENT).toContain('sin cambios');
  });

  it('blocks specialist medical note edits for previous-day records', async () => {
    const mockUpdateMultiple = vi.fn();
    setDailyRecordBedActionsMock({
      updatePatientMultiple: mockUpdateMultiple,
      updatePatient: vi.fn(),
      updateClinicalCrib: vi.fn(),
      updateClinicalCribMultiple: vi.fn(),
    } as unknown as BedActionsMock);
    setDailyRecordDataMock({
      record: {
        ...mockRecord,
        date: '2025-01-01',
      } as DailyRecordDataMock['record'],
      syncStatus: 'synced' as DailyRecordDataMock['syncStatus'],
      lastSyncTime: null,
      inventory: {} as DailyRecordDataMock['inventory'],
      stabilityRules: {} as DailyRecordDataMock['stabilityRules'],
    } as DailyRecordDataMock);
    setTodayIsoMock('2025-01-02');
    mockAuthContext.currentUser = {
      uid: 'specialist-1',
      email: 'specialist@hospitalhangaroa.cl',
      displayName: 'Especialista',
      role: 'doctor_specialist',
    };
    mockAuthContext.role = 'doctor_specialist';

    const { result } = renderUseHandoffLogic(buildHandoffLogicParams({ type: 'medical' }));

    await act(async () => {
      await result.current.handleNursingNoteChange('R1', 'Intento bloqueado');
    });

    expect(mockUpdateMultiple).not.toHaveBeenCalled();
  });

  it('uses the clinical crib adapter for nested medical handoff changes', async () => {
    const mockUpdateClinicalCribMultiple = vi.fn();
    setDailyRecordDataMock({
      record: {
        ...mockRecord,
        beds: {
          ...mockRecord.beds,
          R1: {
            ...mockRecord.beds.R1,
            clinicalCrib: {
              ...mockRecord.beds.R1,
              bedId: 'R1-crib',
              patientName: 'RN clínico',
              medicalHandoffNote: '',
            },
          },
        },
      } as DailyRecordDataMock['record'],
      syncStatus: 'synced' as DailyRecordDataMock['syncStatus'],
      lastSyncTime: null,
      inventory: {} as DailyRecordDataMock['inventory'],
      stabilityRules: {} as DailyRecordDataMock['stabilityRules'],
    } as DailyRecordDataMock);
    setDailyRecordBedActionsMock({
      updatePatientMultiple: vi.fn(),
      updatePatient: vi.fn(),
      updateClinicalCrib: vi.fn(),
      updateClinicalCribMultiple: mockUpdateClinicalCribMultiple,
    } as unknown as BedActionsMock);

    const { result } = renderUseHandoffLogic(buildHandoffLogicParams({ type: 'medical' }));

    await act(async () => {
      await result.current.handleNursingNoteChange('R1', 'Nota RN', true);
    });

    expect(mockUpdateClinicalCribMultiple).toHaveBeenCalledWith(
      'R1',
      expect.objectContaining({
        medicalHandoffNote: 'Nota RN',
      }),
      expect.objectContaining({ patientName: expect.any(String), rut: expect.any(String) })
    );
  });

  it('keeps no-effect primary-entry creation silent when entries already exist', async () => {
    const mockUpdateMultiple = vi.fn();
    setDailyRecordDataMock({
      record: {
        ...mockRecord,
        beds: {
          ...mockRecord.beds,
          R1: {
            ...mockRecord.beds.R1,
            medicalHandoffEntries: [
              {
                id: 'primary-entry',
                specialty: Specialty.MEDICINA,
                note: 'Ya existe',
              },
            ],
          },
        },
      } as DailyRecordDataMock['record'],
      syncStatus: 'synced' as DailyRecordDataMock['syncStatus'],
      lastSyncTime: null,
      inventory: {} as DailyRecordDataMock['inventory'],
      stabilityRules: {} as DailyRecordDataMock['stabilityRules'],
    } as DailyRecordDataMock);
    setDailyRecordBedActionsMock({
      updatePatientMultiple: mockUpdateMultiple,
      updatePatient: vi.fn(),
      updateClinicalCrib: vi.fn(),
      updateClinicalCribMultiple: vi.fn(),
    } as unknown as BedActionsMock);

    const { result } = renderUseHandoffLogic(buildHandoffLogicParams({ type: 'medical' }));

    await act(async () => {
      await result.current.handleMedicalPrimaryEntryCreate('R1');
    });

    expect(mockUpdateMultiple).not.toHaveBeenCalled();
  });

  it('keeps invalid refresh-as-current silent when the entry has no note', async () => {
    const mockUpdateMultiple = vi.fn();
    setDailyRecordDataMock({
      record: {
        ...mockRecord,
        beds: {
          ...mockRecord.beds,
          R1: {
            ...mockRecord.beds.R1,
            medicalHandoffEntries: [
              {
                id: 'entry-1',
                specialty: Specialty.MEDICINA,
                note: '',
              },
            ],
          },
        },
      } as DailyRecordDataMock['record'],
      syncStatus: 'synced' as DailyRecordDataMock['syncStatus'],
      lastSyncTime: null,
      inventory: {} as DailyRecordDataMock['inventory'],
      stabilityRules: {} as DailyRecordDataMock['stabilityRules'],
    } as DailyRecordDataMock);
    setDailyRecordBedActionsMock({
      updatePatientMultiple: mockUpdateMultiple,
      updatePatient: vi.fn(),
      updateClinicalCrib: vi.fn(),
      updateClinicalCribMultiple: vi.fn(),
    } as unknown as BedActionsMock);

    const { result } = renderUseHandoffLogic(buildHandoffLogicParams({ type: 'medical' }));

    await act(async () => {
      result.current.handleMedicalRefreshAsCurrent('R1', 'entry-1');
    });

    expect(mockUpdateMultiple).not.toHaveBeenCalled();
    expect(mockLogDebouncedEvent).not.toHaveBeenCalledWith(
      'MEDICAL_HANDOFF_MODIFIED',
      'patient',
      'R1',
      expect.anything(),
      expect.anything(),
      '2025-01-01',
      undefined,
      10000
    );
  });
});
