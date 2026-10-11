import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CensusTableBody } from '@/features/census/components/CensusTableBody';
import { useCensusTableDragDrop } from '@/features/census/drag-drop/useCensusTableDragDrop';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BedType } from '@/types/domain/beds';

const { patientRowRender, emptyRowRender } = vi.hoisted(() => ({
  patientRowRender: vi.fn(),
  emptyRowRender: vi.fn(),
}));
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

vi.mock('lucide-react', async importOriginal => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    Plus: () => {
      emptyRowRender();
      return <span />;
    },
  };
});

const emptyBed = { id: 'R2', name: 'R2', type: BedType.MEDIA, isCuna: false };
const patient = DataFactory.createMockPatient('R1');
const beds = { R1: patient };
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

const emptyRows = Array.from({ length: 20 }, (_, index) => ({
  kind: 'empty' as const,
  id: `E${index}`,
  bed: { ...emptyBed, id: `E${index}`, name: `E${index}` },
}));
const Table = () => {
  const dragDrop = useCensusTableDragDrop(onAction, beds);
  return (
    <table>
      <CensusTableBody
        unifiedRows={emptyRows}
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

it('renders only the newly hovered empty bed during drag instead of repainting all 20', () => {
  emptyRowRender.mockClear();
  render(<Table />);
  expect(emptyRowRender).toHaveBeenCalledTimes(20);
  fireEvent.dragEnter(document.querySelector('[data-bed-id="E0"]')!);
  expect(emptyRowRender).toHaveBeenCalledTimes(21);
  fireEvent.dragEnter(document.querySelector('[data-bed-id="E1"]')!);
  expect(emptyRowRender).toHaveBeenCalledTimes(23);
  fireEvent.click(screen.getAllByRole('button', { name: 'Agregar paciente' })[1]);
  expect(onActivateEmptyBed).toHaveBeenCalledWith('E1');
});
