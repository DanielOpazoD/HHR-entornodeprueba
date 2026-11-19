import { act, renderHook, waitFor } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { usePatientRowHandlersModel } from '@/features/census/components/patient-row/usePatientRowHandlersModel';
import { buildPatientRowRuntimeHookParams } from '@/features/census/controllers/patientRowRuntimeModelController';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { PatientData } from '@/types/domain/patient';
import { Specialty } from '@/types/domain/patientClassification';
import { bedManagementReducer, type BedAction } from '@/hooks/useBedManagementReducer';
import { applyPatches } from '@/utils/patchUtils';
import { DataFactory } from '@/tests/factories/DataFactory';

const { ports } = vi.hoisted(() => ({
  ports: { getAvailableDates: vi.fn(), getForDate: vi.fn(), updatePartial: vi.fn() },
}));

vi.mock('@/application/ports/dailyRecordPort', async importOriginal => ({
  ...(await importOriginal<typeof import('@/application/ports/dailyRecordPort')>()),
  defaultDailyRecordReadPort: ports,
  defaultDailyRecordWritePort: { updatePartial: ports.updatePartial },
}));

const today = '2026-05-17';
const yesterday = '2026-05-16';

const newborn = (episode: string, patientName: string): PatientData =>
  DataFactory.createMockPatient('R1', {
    patientName,
    rut: '',
    identityStatus: 'provisional',
    clinicalEpisodeId: episode,
    firstSeenDate: yesterday,
  });

/** The crib row's editing model, wired as the census wires it: its data is the crib. */
const renderCribRow = (crib: PatientData) => {
  const dependencies = {
    updatePatient: vi.fn(),
    updatePatientMultiple: vi.fn(),
    clearPatient: vi.fn(),
    updateClinicalCrib: vi.fn(),
    updateClinicalCribMultiple: vi.fn(),
    toggleBedType: vi.fn(),
    confirm: vi.fn(),
    alert: vi.fn(),
  };
  const hook = renderHook(
    ({ data }: { data: PatientData }) =>
      usePatientRowHandlersModel(
        buildPatientRowRuntimeHookParams({
          bed: { id: 'R1' },
          data,
          currentDateString: today,
          isSubRow: true,
          onAction: vi.fn(),
          rowState: { isCunaMode: false, hasCompanion: false, hasClinicalCrib: false },
          dependencies,
        }).editingRuntimeParams
      ),
    { initialProps: { data: crib } }
  );
  return { ...hook, dependencies };
};

describe('editing from the crib row (ID-03, ID-05)', () => {
  it('drops a crib edit issued for a newborn who is no longer in the crib', () => {
    const { result, rerender, dependencies } = renderCribRow(
      newborn('episode-newborn-a', 'RN DE MADRE SINTETICA')
    );
    // A cell still holding the first newborn's handler, as a pending input does.
    const editFirstNewborn = result.current.handlers.cribInputChangeHandlers.text('patientName');

    rerender({ data: newborn('episode-newborn-b', 'RN OTRO EPISODIO') });
    act(() => {
      editFirstNewborn({
        target: { value: 'RN SINTETICO ESCRITO' },
      } as ChangeEvent<HTMLInputElement>);
    });
    expect(dependencies.updateClinicalCrib).not.toHaveBeenCalled();

    act(() => {
      result.current.handlers.cribInputChangeHandlers.text('patientName')({
        target: { value: 'RN OTRO EPISODIO CORREGIDO' },
      } as ChangeEvent<HTMLInputElement>);
    });
    expect(dependencies.updateClinicalCrib).toHaveBeenCalledWith(
      'R1',
      'patientName',
      'RN OTRO EPISODIO CORREGIDO'
    );
  });

  it('carries a demographic correction saved from the crib row to the same newborn on earlier days', async () => {
    const crib = newborn('episode-newborn-a', 'RN DE MADRE SINTETICA');
    const patches: Array<[string, DailyRecordPatch]> = [];
    ports.getForDate.mockImplementation(async (date: string) =>
      date === yesterday
        ? DataFactory.createMockDailyRecord(yesterday, {
            beds: {
              R1: DataFactory.createMockPatient('R1', {
                patientName: 'MADRE SINTETICA',
                clinicalEpisodeId: 'episode-mother',
                clinicalCrib: { ...crib },
              }),
            },
          })
        : null
    );
    ports.updatePartial.mockImplementation(async (date: string, patch: DailyRecordPatch) => {
      patches.push([date, patch]);
    });
    const { result, dependencies } = renderCribRow(crib);

    act(() => {
      result.current.modalSavers.onSaveCribDemographics({ age: '2d' });
    });

    expect(dependencies.updateClinicalCribMultiple).toHaveBeenCalledWith('R1', { age: '2d' });
    await waitFor(() =>
      expect(patches).toEqual([[yesterday, { 'beds.R1.clinicalCrib.age': '2d' }]])
    );
  });

  it.each([
    ['first', ['R2', 'R1']],
    ['second', ['R1', 'R2']],
  ] as const)(
    'corrects only that newborn on earlier days when a newborn with the same name sits in the %s crib',
    async (_position, [ownBed, otherBed]) => {
      const own = { ...newborn('rn-A', 'RN DE MADRE SINTETICA'), age: '1d' };
      const other = { ...newborn('rn-B', own.patientName), age: '1d' };
      let earlierDay = DataFactory.createMockDailyRecord(yesterday, {
        beds: {
          [otherBed]: DataFactory.createMockPatient(otherBed, {
            patientName: 'MADRE SINTETICA',
            clinicalCrib: other,
          }),
          [ownBed]: DataFactory.createMockPatient(ownBed, {
            patientName: 'MADRE SINTETICA',
            clinicalCrib: own,
          }),
        },
      });
      ports.getForDate.mockImplementation(async (date: string) =>
        date === yesterday ? earlierDay : null
      );
      ports.updatePartial.mockImplementation(async (_date: string, patch: DailyRecordPatch) => {
        earlierDay = applyPatches(earlierDay, patch);
      });
      const { result } = renderCribRow(own);

      act(() => {
        result.current.modalSavers.onSaveCribDemographics({ age: '2d' });
      });

      await waitFor(() => expect(earlierDay.beds[ownBed].clinicalCrib?.age).toBe('2d'));
      expect(earlierDay.beds[otherBed].clinicalCrib?.age).toBe('1d');
      expect(earlierDay.beds[ownBed].age).toBe(earlierDay.beds[otherBed].age);
    }
  );
});

it.each([
  ['crib', true],
  ['mother', false],
] as const)(
  'keeps name, diagnosis, specialty and age edits on the %s row they were typed in',
  async (_row, isSubRow) => {
    const crib = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: 'episode-newborn',
      patientName: 'RN SINTETICO',
      rut: '',
      firstSeenDate: today,
    });
    const mother = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: 'episode-mother',
      clinicalCrib: crib,
      patientName: 'MADRE SINTETICA',
      firstSeenDate: today,
    });
    let record = DataFactory.createMockDailyRecord(today, { beds: { R1: mother } });
    const dispatch = (action: BedAction) => {
      record = applyPatches(record, bedManagementReducer(record, action)!);
    };
    const { result } = renderHook(() =>
      usePatientRowHandlersModel(
        buildPatientRowRuntimeHookParams({
          bed: { id: 'R1' },
          data: isSubRow ? crib : mother,
          currentDateString: today,
          isSubRow,
          onAction: vi.fn(),
          rowState: { isCunaMode: false, hasCompanion: false, hasClinicalCrib: !isSubRow },
          dependencies: {
            updatePatient: (bedId, field, value) => {
              dispatch({ type: 'UPDATE_PATIENT', bedId, field, value });
            },
            updatePatientMultiple: async (bedId, fields) => {
              dispatch({ type: 'UPDATE_PATIENT_MULTIPLE', bedId, fields });
              return true;
            },
            // The row's handlers only send patient fields; crib create/remove are other commands.
            updateClinicalCrib: (bedId, field, value) => {
              dispatch({
                type: 'UPDATE_CLINICAL_CRIB',
                bedId,
                field: field as keyof PatientData,
                value,
              });
            },
            updateClinicalCribMultiple: async (bedId, fields) => {
              dispatch({ type: 'UPDATE_CLINICAL_CRIB_MULTIPLE', bedId, fields });
              return true;
            },
            clearPatient: vi.fn(),
            toggleBedType: vi.fn(),
            confirm: vi.fn(),
            alert: vi.fn(),
          },
        }).editingRuntimeParams
      )
    );
    const handlers = isSubRow
      ? result.current.handlers.cribInputChangeHandlers
      : result.current.handlers.mainInputChangeHandlers;
    const saveDemographics = isSubRow
      ? result.current.modalSavers.onSaveCribDemographics
      : result.current.modalSavers.onSaveDemographics;
    const name = isSubRow ? 'RN SINTETICO CORREGIDO' : 'MADRE SINTETICA CORREGIDA';
    const typed = (value: string) => ({ target: { value } }) as ChangeEvent<HTMLInputElement>;

    act(() => {
      if (isSubRow) handlers.text('patientName')(typed(name));
      else saveDemographics({ patientName: name });
      handlers.text('pathology')(typed('BORRADOR'));
      handlers.text('pathology')(typed('DIAGNOSTICO FINAL'));
      handlers.text('specialty')(typed(Specialty.PEDIATRIA));
      saveDemographics({ age: isSubRow ? '2d' : '31' });
    });
    // Past the clinical block's coalescing pause.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 650));
    });

    const edited = isSubRow ? record.beds.R1.clinicalCrib! : record.beds.R1;
    expect(edited).toMatchObject({
      patientName: name,
      pathology: 'DIAGNOSTICO FINAL',
      specialty: Specialty.PEDIATRIA,
      age: isSubRow ? '2d' : '31',
    });
    if (isSubRow) expect({ ...record.beds.R1, clinicalCrib: crib }).toEqual(mother);
    else expect(record.beds.R1.clinicalCrib).toEqual(crib);
  }
);
