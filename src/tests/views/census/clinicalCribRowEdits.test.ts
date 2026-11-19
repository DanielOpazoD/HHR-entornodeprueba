import { act, renderHook, waitFor } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { usePatientRowHandlersModel } from '@/features/census/components/patient-row/usePatientRowHandlersModel';
import { buildPatientRowRuntimeHookParams } from '@/features/census/controllers/patientRowRuntimeModelController';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { PatientData } from '@/types/domain/patient';
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
});
