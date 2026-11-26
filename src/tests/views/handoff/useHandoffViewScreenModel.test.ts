import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useHandoffViewScreenModel } from '@/features/handoff/hooks/useHandoffViewScreenModel';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import {
  useDailyRecordBedActions,
  useDailyRecordPersistenceActions,
} from '@/context/useDailyRecordScopedActions';
import type { UseUIStateReturn } from '@/hooks/useUIState';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import type { ShiftType } from '@/types/domain/shift';

const mockLogDebouncedEvent = vi.fn();
const mockLogViewEvent = vi.fn();
const mockLogHandoffNovedadesModified = vi.fn();
const mockSuccess = vi.fn();
const mockError = vi.fn();

vi.mock('@/context/AuditContext', () => ({
  useAuditContext: () => ({
    logDebouncedEvent: mockLogDebouncedEvent,
    logViewEvent: mockLogViewEvent,
    logHandoffNovedadesModified: mockLogHandoffNovedadesModified,
    userId: 'test-user',
  }),
}));

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ success: mockSuccess, error: mockError }),
}));

vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => ({ nursesList: ['Enfermera A'] }),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: vi.fn(),
}));

vi.mock('@/context/useDailyRecordScopedActions', () => ({
  useDailyRecordBedActions: vi.fn(),
  useDailyRecordPersistenceActions: vi.fn(),
}));

type BedActions = ReturnType<typeof useDailyRecordBedActions>;

const bedActions = {
  updatePatient: vi.fn(),
  updatePatientMultiple: vi.fn(() => Promise.resolve(true)),
  updateClinicalCrib: vi.fn(),
  updateClinicalCribMultiple: vi.fn(() => Promise.resolve(true)),
};

const patient = (overrides: Partial<PatientData>): PatientData =>
  ({
    patientName: 'Paciente Prueba',
    rut: '12.345.678-5',
    admissionDate: '2025-01-01',
    admissionTime: '09:00',
    isBlocked: false,
    ...overrides,
  }) as PatientData;

const buildRecord = (overrides: Partial<DailyRecord> = {}): DailyRecord =>
  ({
    date: '2025-01-02',
    beds: {
      R1: patient({
        bedId: 'R1',
        handoffNoteDayShift: 'Nota día',
        handoffNoteNightShift: 'Nota noche',
        clinicalCrib: patient({
          patientName: 'RN Prueba',
          rut: '11.111.111-1',
          handoffNoteNightShift: 'Nota cuna',
        }),
      }),
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
    nursesDayShift: ['Enfermera Día'],
    nursesNightShift: ['Enfermera Noche'],
    handoffNightReceives: ['Enfermera Recibe'],
    tensDayShift: ['TENS Día'],
    tensNightShift: ['TENS Noche'],
    activeExtraBeds: [],
    ...overrides,
  }) as DailyRecord;

const setRecord = (record: DailyRecord | null) =>
  vi
    .mocked(useDailyRecordData)
    .mockReturnValue({ record } as ReturnType<typeof useDailyRecordData>);

const renderScreen = (selectedShift: ShiftType, readOnly = false) =>
  renderHook(() =>
    useHandoffViewScreenModel({
      readOnly,
      ui: { selectedShift, setSelectedShift: vi.fn() } as unknown as UseUIStateReturn,
    })
  );

describe('useHandoffViewScreenModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRecord(buildRecord());
    vi.mocked(useDailyRecordBedActions).mockReturnValue(bedActions as unknown as BedActions);
    vi.mocked(useDailyRecordPersistenceActions).mockReturnValue({
      saveAndUpdate: vi.fn().mockResolvedValue(undefined),
      patchRecord: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    document.title = 'Hospital Hanga Roa';
  });

  it('saves a day note to both shifts and audits the day note in 30 s bursts', () => {
    const { result } = renderScreen('day');

    act(() => result.current.handleNursingNoteChange('R1', 'Nueva nota', false));

    expect(bedActions.updatePatientMultiple).toHaveBeenCalledWith('R1', {
      handoffNoteDayShift: 'Nueva nota',
      handoffNoteNightShift: 'Nueva nota',
    });
    expect(bedActions.updatePatient).not.toHaveBeenCalled();
    expect(mockLogDebouncedEvent).toHaveBeenCalledWith(
      'NURSE_HANDOFF_MODIFIED',
      'patient',
      'R1',
      {
        patientName: 'Paciente Prueba',
        shift: 'day',
        note: 'Nueva nota',
        changes: { handoffNoteDayShift: { old: 'Nota día', new: 'Nueva nota' } },
      },
      '12.345.678-5',
      '2025-01-02',
      undefined,
      30000
    );
  });

  it('saves a night note only to the night shift, for the bed and for its crib', () => {
    const { result } = renderScreen('night');

    act(() => result.current.handleNursingNoteChange('R1', 'Noche nueva', false));
    act(() => result.current.handleNursingNoteChange('R1', 'Cuna nueva', true));

    expect(bedActions.updatePatientMultiple).toHaveBeenCalledWith('R1', {
      handoffNoteNightShift: 'Noche nueva',
    });
    expect(bedActions.updateClinicalCribMultiple).toHaveBeenCalledWith('R1', {
      handoffNoteNightShift: 'Cuna nueva',
    });
    expect(bedActions.updateClinicalCrib).not.toHaveBeenCalled();
    expect(mockLogDebouncedEvent).toHaveBeenLastCalledWith(
      'NURSE_HANDOFF_MODIFIED',
      'patient',
      'R1',
      {
        patientName: 'RN Prueba',
        shift: 'night',
        note: 'Cuna nueva',
        changes: { handoffNoteNightShift: { old: 'Nota cuna', new: 'Cuna nueva' } },
      },
      '11.111.111-1',
      '2025-01-02',
      undefined,
      30000
    );
  });

  it('adds and deletes clinical events, tells the person it worked and audits both', () => {
    const { result } = renderScreen('day');

    act(() =>
      result.current.clinicalEventActions.onAdd?.('R1', {
        name: 'Broncoscopía',
        date: '2025-01-02',
        note: '',
      })
    );

    expect(bedActions.updatePatient).toHaveBeenCalledWith('R1', 'clinicalEvents', [
      expect.objectContaining({ name: 'Broncoscopía' }),
    ]);
    expect(mockSuccess).toHaveBeenCalledWith(
      'Evento agregado',
      'Se ha registrado el evento: Broncoscopía'
    );
    expect(mockLogDebouncedEvent).toHaveBeenCalledWith(
      'CLINICAL_EVENT_ADDED',
      'patient',
      'R1',
      { event: 'Broncoscopía' },
      'R1',
      '2025-01-02',
      undefined,
      10000
    );

    setRecord(
      buildRecord({
        beds: {
          R1: patient({
            clinicalEvents: [
              { id: 'evt-1', name: 'Cirugía', date: '2025-01-02', note: '', createdAt: '' },
            ],
          }),
        },
      })
    );
    const { result: withEvent } = renderScreen('day');
    act(() => withEvent.current.clinicalEventActions.onDelete?.('R1', 'evt-1'));

    expect(bedActions.updatePatient).toHaveBeenLastCalledWith('R1', 'clinicalEvents', []);
    expect(mockLogDebouncedEvent).toHaveBeenLastCalledWith(
      'CLINICAL_EVENT_DELETED',
      'patient',
      'R1',
      { event: 'Cirugía' },
      'R1',
      '2025-01-02',
      undefined,
      10000
    );
  });

  it('offers no clinical event actions on a read-only screen', () => {
    const { result } = renderScreen('day', true);

    expect(result.current.readOnly).toBe(true);
    expect(result.current.clinicalEventActions.onAdd).toBeUndefined();
    expect(result.current.clinicalEventActions.onUpdate).toBeUndefined();
    expect(result.current.clinicalEventActions.onDelete).toBeUndefined();
  });

  it('takes the staff lists of each shift from the census staffing', () => {
    const { result: day } = renderScreen('day');
    expect(day.current.deliversList).toEqual(['Enfermera Día']);
    expect(day.current.receivesList).toEqual(['Enfermera Noche']);
    expect(day.current.tensList).toEqual(['TENS Día']);
    expect(day.current.noteField).toBe('handoffNoteDayShift');

    const { result: night } = renderScreen('night');
    expect(night.current.deliversList).toEqual(['Enfermera Noche']);
    expect(night.current.receivesList).toEqual(['Enfermera Recibe']);
    expect(night.current.tensList).toEqual(['TENS Noche']);
    expect(night.current.noteField).toBe('handoffNoteNightShift');
  });

  it('shows an extra bed only while it is active, and nothing without a record', () => {
    const { result: inactive } = renderScreen('day');
    const inactiveIds = inactive.current.visibleBeds.map(bed => bed.id);
    expect(inactiveIds).toContain('R1');
    expect(inactiveIds).not.toContain('E1');
    expect(inactive.current.hasAnyPatients).toBe(true);

    setRecord(buildRecord({ activeExtraBeds: ['E1'] }));
    const { result: active } = renderScreen('day');
    expect(active.current.visibleBeds.map(bed => bed.id)).toContain('E1');

    setRecord(null);
    const { result: empty } = renderScreen('day');
    expect(empty.current.visibleBeds).toEqual([]);
    expect(empty.current.hasAnyPatients).toBe(false);
    expect(empty.current.deliversList).toEqual([]);
    expect(empty.current.tensList).toEqual([]);
  });

  it('records the handoff view once and names the browser tab after the shift and day', () => {
    renderScreen('night');

    expect(mockLogViewEvent).toHaveBeenCalledTimes(1);
    expect(mockLogViewEvent).toHaveBeenCalledWith(
      'VIEW_NURSING_HANDOFF',
      'dailyRecord',
      '2025-01-02',
      { view: 'nursing_handoff', shift: 'night' },
      undefined,
      '2025-01-02',
      undefined
    );
    expect(document.title).toBe('TN 02-01-2025');
  });

  it('keeps derived lists and mutation handlers stable across bed note updates while reading the latest record', () => {
    const initialRecord = buildRecord();
    setRecord(initialRecord);
    const ui = { selectedShift: 'day' as ShiftType, setSelectedShift: vi.fn() };
    const { result, rerender } = renderHook(() =>
      useHandoffViewScreenModel({
        readOnly: false,
        ui: ui as unknown as UseUIStateReturn,
      })
    );

    const firstVisibleBeds = result.current.visibleBeds;
    const firstDeliversList = result.current.deliversList;
    const firstReceivesList = result.current.receivesList;
    const firstTensList = result.current.tensList;
    const firstHandleNoteChange = result.current.handleNursingNoteChange;
    const firstClinicalEventActions = result.current.clinicalEventActions;

    // Simulate editing bed R1's note (new record & beds reference, same staffing/layout slices).
    const updatedBedRecord: DailyRecord = {
      ...initialRecord,
      beds: {
        ...initialRecord.beds,
        R1: {
          ...initialRecord.beds.R1,
          handoffNoteDayShift: 'Nota actualizada',
        },
      },
    };
    setRecord(updatedBedRecord);
    rerender();

    expect(result.current.visibleBeds).toBe(firstVisibleBeds);
    expect(result.current.deliversList).toBe(firstDeliversList);
    expect(result.current.receivesList).toBe(firstReceivesList);
    expect(result.current.tensList).toBe(firstTensList);
    expect(result.current.handleNursingNoteChange).toBe(firstHandleNoteChange);
    expect(result.current.clinicalEventActions).toBe(firstClinicalEventActions);

    // Invoking the stable callback immediately after rerender reads the newest note as oldNote.
    act(() => result.current.handleNursingNoteChange('R1', 'Tercera nota', false));
    expect(mockLogDebouncedEvent).toHaveBeenLastCalledWith(
      'NURSE_HANDOFF_MODIFIED',
      'patient',
      'R1',
      expect.objectContaining({
        changes: {
          handoffNoteDayShift: { old: 'Nota actualizada', new: 'Tercera nota' },
        },
      }),
      '12.345.678-5',
      '2025-01-02',
      undefined,
      30000
    );

    // Updating a non-bed slice also keeps shouldShowPatient stable.
    const shouldShowBeforeNovedades = result.current.shouldShowPatient;
    setRecord({
      ...updatedBedRecord,
      handoffNovedadesDayShift: 'Sin incidencias',
    });
    rerender();

    expect(result.current.shouldShowPatient).toBe(shouldShowBeforeNovedades);
  });
});
