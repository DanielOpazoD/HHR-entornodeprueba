import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import {
  BedActionsMock,
  buildHandoffLogicParams,
  mockLogDebouncedEvent,
  mockRecord,
  renderUseHandoffLogic,
  resetUseHandoffLogicTestState,
  restoreUseHandoffLogicTestState,
  setDailyRecordBedActionsMock,
  setDailyRecordDataMock,
} from '@/tests/hooks/useHandoffLogic.test-support';

describe('useHandoffLogic nursing and events', () => {
  beforeEach(() => {
    resetUseHandoffLogicTestState();
  });

  afterEach(() => {
    restoreUseHandoffLogicTestState();
  });

  it('handles nursing note changes correctly (Day Shift uses updatePatientMultiple)', async () => {
    const mockUpdateMultiple = vi.fn();
    setDailyRecordBedActionsMock({
      updatePatientMultiple: mockUpdateMultiple,
      updatePatient: vi.fn(),
      updateClinicalCrib: vi.fn(),
      updateClinicalCribMultiple: vi.fn(),
    } as unknown as BedActionsMock);

    const { result } = renderUseHandoffLogic(buildHandoffLogicParams());

    await act(async () => {
      await result.current.handleNursingNoteChange('R1', 'New Note');
    });

    expect(mockUpdateMultiple).toHaveBeenCalledWith(
      'R1',
      expect.objectContaining({
        handoffNoteDayShift: 'New Note',
        handoffNoteNightShift: 'New Note',
      })
    );
    expect(mockLogDebouncedEvent).toHaveBeenCalledWith(
      'NURSE_HANDOFF_MODIFIED',
      'patient',
      'R1',
      expect.anything(),
      '1-1',
      '2025-01-01',
      undefined,
      30000
    );
  });

  it('adds and deletes clinical events', async () => {
    const mockUpdate = vi.fn();
    setDailyRecordBedActionsMock({
      updatePatient: mockUpdate,
      updatePatientMultiple: vi.fn(),
      updateClinicalCrib: vi.fn(),
      updateClinicalCribMultiple: vi.fn(),
    } as unknown as BedActionsMock);

    const { result } = renderUseHandoffLogic(buildHandoffLogicParams());

    await act(async () => {
      await result.current.handleClinicalEventAdd('R1', {
        name: 'Cirugía',
        date: '2025-01-01',
        note: '',
      });
    });

    expect(mockUpdate).toHaveBeenCalledWith('R1', 'clinicalEvents', expect.any(Array));
    expect(mockLogDebouncedEvent).toHaveBeenCalledWith(
      'CLINICAL_EVENT_ADDED',
      'patient',
      'R1',
      expect.anything(),
      'R1',
      '2025-01-01',
      undefined,
      10000
    );

    const recordWithEvent = {
      ...mockRecord,
      beds: {
        R1: {
          ...mockRecord.beds.R1,
          clinicalEvents: [
            { id: 'evt-1', name: 'Delete', date: '2025-01-01', note: '', createdAt: '' },
          ],
        },
      },
    };

    const mockUpdate2 = vi.fn();

    setDailyRecordDataMock({
      record: recordWithEvent,
      syncStatus: 'synced',
      lastSyncTime: null,
      inventory: {},
      stabilityRules: {},
    } as never);
    setDailyRecordBedActionsMock({
      updatePatient: mockUpdate2,
    } as unknown as BedActionsMock);

    const { result: result2 } = renderUseHandoffLogic(buildHandoffLogicParams());

    await act(async () => {
      await result2.current.handleClinicalEventDelete('R1', 'evt-1');
    });

    expect(mockUpdate2).toHaveBeenCalledWith('R1', 'clinicalEvents', []);
    expect(mockLogDebouncedEvent).toHaveBeenCalledWith(
      'CLINICAL_EVENT_DELETED',
      'patient',
      'R1',
      expect.anything(),
      'R1',
      '2025-01-01',
      undefined,
      10000
    );
  });

  it('adds clinical events and tells the person it worked', async () => {
    const mockUpdate = vi.fn();
    const onSuccess = vi.fn();
    setDailyRecordBedActionsMock({
      updatePatient: mockUpdate,
      updatePatientMultiple: vi.fn(),
      updateClinicalCrib: vi.fn(),
      updateClinicalCribMultiple: vi.fn(),
    } as unknown as BedActionsMock);

    const { result } = renderUseHandoffLogic(buildHandoffLogicParams({ onSuccess }));

    await act(async () => {
      await result.current.handleClinicalEventAdd('R1', {
        name: 'Broncoscopía',
        date: '2025-01-01',
        note: 'Procedimiento coordinado',
      });
    });

    expect(mockUpdate).toHaveBeenCalledWith('R1', 'clinicalEvents', expect.any(Array));
    expect(onSuccess).toHaveBeenCalledWith(
      'Evento agregado',
      'Se ha registrado el evento: Broncoscopía'
    );
    expect(mockLogDebouncedEvent).toHaveBeenCalledWith(
      'CLINICAL_EVENT_ADDED',
      'patient',
      'R1',
      expect.anything(),
      'R1',
      '2025-01-01',
      undefined,
      10000
    );
  });
});
