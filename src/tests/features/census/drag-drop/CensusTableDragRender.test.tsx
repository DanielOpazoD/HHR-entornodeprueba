import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CensusTableBody } from '@/features/census/components/CensusTableBody';
import { useCensusTableDragDrop } from '@/features/census/drag-drop/useCensusTableDragDrop';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BedType } from '@/types/domain/beds';

const { patientRowRender } = vi.hoisted(() => ({ patientRowRender: vi.fn() }));
const pendingClearTargets = { bedIds: new Set<string>(), clinicalCribBedIds: new Set<string>() };
const pendingCribCreates = new Map();

vi.mock('@/features/census/hooks/usePendingBedClearIds', () => ({
  usePendingIntentionalClearTargets: () => pendingClearTargets,
  usePendingClinicalCribCreates: () => pendingCribCreates,
}));

vi.mock('@/features/census/components/PatientRow', async () => {
  const { createElement, memo } = await import('react');
  return {
    PatientRow: memo(({ bed }: { bed: { id: string } }) => {
      patientRowRender(bed.id);
      return createElement('tr', { 'data-testid': `patient-${bed.id}` });
    }),
  };
});

vi.mock('@/features/census/components/EmptyBedRow', () => ({
  EmptyBedRow: ({
    bed,
    onDragEnter,
  }: {
    bed: { id: string };
    onDragEnter?: React.DragEventHandler;
  }) => <tr data-testid={`empty-${bed.id}`} onDragEnter={onDragEnter} />,
}));

const occupiedBed = { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false };
const emptyBed = { id: 'R2', name: 'R2', type: BedType.MEDIA, isCuna: false };
const patient = DataFactory.createMockPatient('R1');
const beds = { R1: patient };
const rows = [
  { kind: 'occupied' as const, id: 'R1', bed: occupiedBed, data: patient, isSubRow: false },
  { kind: 'empty' as const, id: 'R2', bed: emptyBed },
];
const columns = {
  actions: 42,
  bed: 96,
  type: 64,
  name: 190,
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
const documentPresence = {};
const bedTypes = {};
const onAction = vi.fn();
const onActivateEmptyBed = vi.fn();

const Table = () => {
  const dragDrop = useCensusTableDragDrop(vi.fn(), beds);
  return (
    <table>
      <CensusTableBody
        unifiedRows={rows}
        currentDateString="2026-02-20"
        readOnly={false}
        diagnosisMode="free"
        columns={columns}
        visibleColumnCount={9}
        bedTypes={bedTypes}
        role="admin"
        clinicalDocumentPresenceByBedId={documentPresence}
        onAction={onAction}
        onActivateEmptyBed={onActivateEmptyBed}
        dragDrop={dragDrop}
      />
    </table>
  );
};

it('keeps an unchanged patient row memoized while an empty bed receives drag hover', () => {
  patientRowRender.mockClear();
  render(<Table />);
  expect(patientRowRender).toHaveBeenCalledTimes(1);

  fireEvent.dragEnter(screen.getByTestId('empty-R2'));

  expect(patientRowRender).toHaveBeenCalledTimes(1);
});

it('rerenders only the bed whose document indicator changes in a populated census', () => {
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
  const table = (presence: Record<string, boolean>, recordLastUpdated?: string) => (
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
  // A new authoritative revision must still reach every row's guarded commands.
  rerender(table({ BED0: true }, '2026-02-20T12:00:00Z'));
  expect(patientRowRender).toHaveBeenCalledTimes(41);
});
