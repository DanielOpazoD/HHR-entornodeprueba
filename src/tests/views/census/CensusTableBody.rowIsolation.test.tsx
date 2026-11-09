import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CensusTableBody } from '@/features/census/components/CensusTableBody';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BedType } from '@/types/domain/beds';
import type { PatientRowProps } from '@/features/census/components/patient-row/patientRowContracts';

const { patientRowRender, updateClinicalCrib, confirm, alert } = vi.hoisted(() => ({
  patientRowRender: vi.fn(),
  updateClinicalCrib: vi.fn(),
  confirm: vi.fn(async () => true),
  alert: vi.fn(),
}));
const pendingClearTargets = { bedIds: new Set<string>(), clinicalCribBedIds: new Set<string>() };
const pendingCribCreates = new Map();

vi.mock('@/features/census/hooks/usePendingBedClearIds', () => ({
  usePendingIntentionalClearTargets: () => pendingClearTargets,
  usePendingClinicalCribCreates: () => pendingCribCreates,
}));

vi.mock('@/features/census/components/PatientRow', async () => {
  const { createElement, memo } = await import('react');
  const { usePatientRowBedConfigActions } =
    await import('@/features/census/components/patient-row/usePatientRowBedConfigActions');
  return {
    PatientRow: memo(({ bed, data, getRecordLastUpdated }: PatientRowProps) => {
      const { removeClinicalCrib } = usePatientRowBedConfigActions({
        bedId: bed.id,
        isCunaMode: false,
        hasCompanion: false,
        hasClinicalCrib: Boolean(data.clinicalCrib),
        clinicalCrib: data.clinicalCrib,
        getRecordLastUpdated,
        updatePatient: vi.fn(),
        updateClinicalCrib,
        confirm,
        alert,
      });
      patientRowRender(bed.id);
      return createElement(
        'tr',
        { 'data-testid': `patient-${bed.id}` },
        createElement('td', {}, createElement('button', { onClick: removeClinicalCrib }, bed.id))
      );
    }),
  };
});

const occupiedBed = { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false };
const columns = {
  actions: 42,
  bed: 96,
  type: 64,
  name: 190,
  access: 64,
  rut: 128,
  age: 56,
  diagnosis: 220,
  specialty: 112,
  status: 0,
  admission: 128,
  dmi: 0,
  scores: 56,
  cqx: 0,
  upc: 0,
};
const bedTypes = {};
const onAction = vi.fn();
const onActivateEmptyBed = vi.fn();

it('isolates edits and server confirmations while crib removal uses the latest revision', async () => {
  patientRowRender.mockClear();
  const fullRows = Array.from({ length: 20 }, (_, index) => {
    const bed = { ...occupiedBed, id: `BED${index}`, name: `BED${index}` };
    return {
      kind: 'occupied' as const,
      id: bed.id,
      bed,
      data: DataFactory.createMockPatient(bed.id),
      isSubRow: false,
    };
  });
  fullRows[1].data.clinicalCrib = DataFactory.createMockPatient('BED1-C');
  const props = {
    unifiedRows: fullRows,
    currentDateString: '2026-02-20',
    readOnly: false,
    diagnosisMode: 'free' as const,
    columns,
    visibleColumnCount: 9,
    bedTypes,
    role: 'admin' as const,
    onAction,
    onActivateEmptyBed,
  };
  const table = (presence: Record<string, boolean>, recordLastUpdated = '2026-02-20T11:59:59Z') => (
    <table>
      <CensusTableBody
        {...props}
        clinicalDocumentPresenceByBedId={presence}
        recordLastUpdated={recordLastUpdated}
      />
    </table>
  );
  const { rerender } = render(table({}));
  expect(patientRowRender).toHaveBeenCalledTimes(20);
  rerender(table({ BED0: true }));
  expect(patientRowRender).toHaveBeenCalledTimes(21);
  expect(patientRowRender).toHaveBeenLastCalledWith('BED0');
  rerender(table({ BED0: true }));
  expect(patientRowRender).toHaveBeenCalledTimes(21);
  fullRows[0] = { ...fullRows[0], data: { ...fullRows[0].data, patientName: 'Edited Patient' } };
  props.unifiedRows = [...fullRows];
  rerender(table({ BED0: true }, '2026-02-20T12:00:00Z'));
  expect(patientRowRender).toHaveBeenCalledTimes(22);
  expect(patientRowRender).toHaveBeenLastCalledWith('BED0');
  rerender(table({ BED0: true }, '2026-02-20T12:00:01Z'));
  expect(patientRowRender).toHaveBeenCalledTimes(22);
  confirm.mockImplementationOnce(async () => {
    rerender(table({ BED0: true }, '2026-02-20T12:00:02Z'));
    return true;
  });
  fireEvent.click(screen.getByRole('button', { name: 'BED1' }));
  await waitFor(() =>
    expect(updateClinicalCrib).toHaveBeenCalledWith(
      'BED1',
      'remove',
      undefined,
      '2026-02-20T12:00:01Z',
      expect.objectContaining({ patientName: fullRows[1].data.clinicalCrib?.patientName })
    )
  );
});
