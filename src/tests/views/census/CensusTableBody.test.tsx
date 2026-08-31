import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CensusTableBody } from '@/features/census/components/CensusTableBody';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { UnifiedBedRow } from '@/features/census/types/censusTableTypes';
import type { BedDefinition } from '@/types/domain/beds';
import { BedType } from '@/types/domain/beds';
import type { TableColumnConfig } from '@/context/TableConfigContext';

const patientRowSpy = vi.fn();
const emptyBedRowSpy = vi.fn();
const { pendingClearTargetsMock, pendingCribCreatesMock } = vi.hoisted(() => ({
  pendingClearTargetsMock: {
    bedIds: new Set<string>(),
    clinicalCribBedIds: new Set<string>(),
  },
  pendingCribCreatesMock: new Map<string, unknown>(),
}));

vi.mock('@/features/census/hooks/usePendingBedClearIds', () => ({
  usePendingIntentionalClearTargets: () => pendingClearTargetsMock,
  usePendingClinicalCribCreates: () => pendingCribCreatesMock,
}));

vi.mock('@/features/census/components/PatientRow', () => ({
  PatientRow: (props: { bed: BedDefinition; actionMenuAlign: 'top' | 'bottom' }) => {
    patientRowSpy(props);
    return <tr data-testid={`patient-row-${props.bed.id}`} />;
  },
}));

vi.mock('@/features/census/components/EmptyBedRow', () => ({
  EmptyBedRow: (props: { bed: BedDefinition; onClick: () => void }) => {
    emptyBedRowSpy(props);
    return (
      <tr data-testid={`empty-bed-row-${props.bed.id}`}>
        <td>{props.bed.id}</td>
        <td>
          <button
            type="button"
            data-testid={`empty-bed-button-${props.bed.id}`}
            onClick={props.onClick}
          >
            Agregar paciente
          </button>
        </td>
      </tr>
    );
  },
}));

describe('CensusTableBody', () => {
  beforeEach(() => {
    pendingClearTargetsMock.bedIds.clear();
    pendingClearTargetsMock.clinicalCribBedIds.clear();
    pendingCribCreatesMock.clear();
    patientRowSpy.mockClear();
    emptyBedRowSpy.mockClear();
  });

  const columns: TableColumnConfig = {
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

  it('assigns action menu alignment based on row position', () => {
    patientRowSpy.mockClear();
    const unifiedRows: UnifiedBedRow[] = Array.from({ length: 6 }, (_, i) => ({
      kind: 'occupied' as const,
      id: `row-${i}`,
      bed: { id: `R${i + 1}`, name: `R${i + 1}`, type: BedType.MEDIA, isCuna: false },
      data: DataFactory.createMockPatient(`R${i + 1}`),
      isSubRow: false,
    }));

    render(
      <table>
        <CensusTableBody
          unifiedRows={unifiedRows}
          currentDateString="2026-02-15"
          readOnly={false}
          diagnosisMode="free"
          columns={columns}
          visibleColumnCount={9}
          bedTypes={{}}
          role="viewer"
          clinicalDocumentPresenceByBedId={{}}
          onAction={vi.fn()}
          onActivateEmptyBed={vi.fn()}
        />
      </table>
    );

    expect(patientRowSpy).toHaveBeenCalledTimes(6);
    expect(patientRowSpy.mock.calls[0][0].actionMenuAlign).toBe('top');
    expect(patientRowSpy.mock.calls[2][0].actionMenuAlign).toBe('bottom');
    expect(patientRowSpy.mock.calls[5][0].actionMenuAlign).toBe('bottom');
    expect(patientRowSpy.mock.calls[0][0].role).toBe('viewer');
    expect(patientRowSpy.mock.calls[0][0].accessProfile).toBeUndefined();
    expect(patientRowSpy.mock.calls[0][0].indicators).toEqual({
      hasClinicalDocument: false,
      isNewAdmission: false,
    });
  });

  it('forwards specialist census access profile to each patient row', () => {
    patientRowSpy.mockClear();
    const unifiedRows: UnifiedBedRow[] = [
      {
        kind: 'occupied',
        id: 'row-1',
        bed: { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false },
        data: DataFactory.createMockPatient('R1'),
        isSubRow: false,
      },
    ];

    render(
      <table>
        <CensusTableBody
          unifiedRows={unifiedRows}
          currentDateString="2026-02-15"
          readOnly={true}
          diagnosisMode="free"
          columns={columns}
          visibleColumnCount={9}
          bedTypes={{}}
          role="doctor_specialist"
          accessProfile="specialist"
          clinicalDocumentPresenceByBedId={{}}
          onAction={vi.fn()}
          onActivateEmptyBed={vi.fn()}
        />
      </table>
    );

    expect(patientRowSpy).toHaveBeenCalledTimes(1);
    expect(patientRowSpy.mock.calls[0][0].accessProfile).toBe('specialist');
    expect(patientRowSpy.mock.calls[0][0].role).toBe('doctor_specialist');
  });

  it('forwards resolved indicators to main rows only', () => {
    patientRowSpy.mockClear();
    const unifiedRows: UnifiedBedRow[] = [
      {
        kind: 'occupied',
        id: 'row-main',
        bed: { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false },
        data: DataFactory.createMockPatient('R1', {
          admissionDate: '2026-02-15',
          admissionTime: '14:10',
        }),
        isSubRow: false,
      },
      {
        kind: 'occupied',
        id: 'row-crib',
        bed: { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false },
        data: DataFactory.createMockPatient('R1-crib', {
          admissionDate: '2026-02-15',
          admissionTime: '14:10',
        }),
        isSubRow: true,
      },
    ];

    render(
      <table>
        <CensusTableBody
          unifiedRows={unifiedRows}
          currentDateString="2026-02-15"
          readOnly={false}
          diagnosisMode="free"
          columns={columns}
          visibleColumnCount={9}
          bedTypes={{}}
          role="nurse_hospital"
          clinicalDocumentPresenceByBedId={{ R1: true }}
          onAction={vi.fn()}
          onActivateEmptyBed={vi.fn()}
        />
      </table>
    );

    expect(patientRowSpy.mock.calls[0][0].indicators).toEqual({
      hasClinicalDocument: true,
      isNewAdmission: true,
    });
    expect(patientRowSpy.mock.calls[1][0].indicators).toEqual({
      hasClinicalDocument: false,
      isNewAdmission: false,
    });
  });

  it('treats early next-day admissions as current clinical-day admissions', () => {
    patientRowSpy.mockClear();
    const unifiedRows: UnifiedBedRow[] = [
      {
        kind: 'occupied',
        id: 'row-main',
        bed: { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false },
        data: DataFactory.createMockPatient('R1', {
          admissionDate: '2026-02-16',
          admissionTime: '02:10',
        }),
        isSubRow: false,
      },
    ];

    render(
      <table>
        <CensusTableBody
          unifiedRows={unifiedRows}
          currentDateString="2026-02-15"
          readOnly={false}
          diagnosisMode="free"
          columns={columns}
          visibleColumnCount={9}
          bedTypes={{}}
          role="nurse_hospital"
          clinicalDocumentPresenceByBedId={{ R1: true }}
          onAction={vi.fn()}
          onActivateEmptyBed={vi.fn()}
        />
      </table>
    );

    expect(patientRowSpy.mock.calls[0][0].indicators).toEqual({
      hasClinicalDocument: true,
      isNewAdmission: true,
    });
  });

  it('renders empty bed rows and forwards empty bed activation', () => {
    emptyBedRowSpy.mockClear();
    const onActivateEmptyBed = vi.fn();
    const unifiedRows: UnifiedBedRow[] = [
      {
        kind: 'empty',
        id: 'R9',
        bed: { id: 'R9', name: 'R9', type: BedType.MEDIA, isCuna: false },
      },
      {
        kind: 'empty',
        id: 'R10',
        bed: { id: 'R10', name: 'R10', type: BedType.MEDIA, isCuna: false },
      },
    ];

    render(
      <table>
        <CensusTableBody
          unifiedRows={unifiedRows}
          currentDateString="2026-02-15"
          readOnly={false}
          diagnosisMode="free"
          columns={columns}
          visibleColumnCount={9}
          bedTypes={{}}
          role="viewer"
          clinicalDocumentPresenceByBedId={{}}
          onAction={vi.fn()}
          onActivateEmptyBed={onActivateEmptyBed}
        />
      </table>
    );

    expect(emptyBedRowSpy).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId('empty-bed-button-R9'));
    expect(onActivateEmptyBed).toHaveBeenCalledWith('R9');
  });

  it('projects an occupied bed as empty immediately while its clear is pending', () => {
    pendingClearTargetsMock.bedIds.add('R1');
    const unifiedRows: UnifiedBedRow[] = [
      {
        kind: 'occupied',
        id: 'row-1',
        bed: { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false },
        data: DataFactory.createMockPatient('R1'),
        isSubRow: false,
      },
      {
        kind: 'occupied',
        id: 'row-crib',
        bed: { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false },
        data: DataFactory.createMockPatient('R1-crib'),
        isSubRow: true,
      },
    ];

    render(
      <table>
        <CensusTableBody
          unifiedRows={unifiedRows}
          currentDateString="2026-02-15"
          readOnly={false}
          diagnosisMode="free"
          columns={columns}
          visibleColumnCount={9}
          bedTypes={{}}
          role="nurse_hospital"
          clinicalDocumentPresenceByBedId={{}}
          onAction={vi.fn()}
          onActivateEmptyBed={vi.fn()}
          dragDrop={{
            state: { dragSourceBedId: null, dragOverBedId: null, pendingMove: null },
            patientHandlers: {
              onDragStart: vi.fn(() => vi.fn()),
              onDragEnd: vi.fn(),
            },
            emptyBedHandlers: {
              onDragOver: vi.fn(() => vi.fn()),
              onDragEnter: vi.fn(() => vi.fn()),
              onDragLeave: vi.fn(),
              onDrop: vi.fn(() => vi.fn()),
            },
            confirmationHandlers: { onConfirm: vi.fn(), onCancel: vi.fn() },
          }}
        />
      </table>
    );

    expect(patientRowSpy).not.toHaveBeenCalled();
    expect(emptyBedRowSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        readOnly: true,
        isPendingClear: true,
      })
    );
  });

  it('hides only the clinical crib immediately while its own clear is pending', () => {
    pendingClearTargetsMock.clinicalCribBedIds.add('R1');
    const unifiedRows: UnifiedBedRow[] = [
      {
        kind: 'occupied',
        id: 'row-main',
        bed: { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false },
        data: DataFactory.createMockPatient('R1'),
        isSubRow: false,
      },
      {
        kind: 'occupied',
        id: 'row-crib',
        bed: { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false },
        data: DataFactory.createMockPatient('R1-crib'),
        isSubRow: true,
      },
    ];

    render(
      <table>
        <CensusTableBody
          unifiedRows={unifiedRows}
          currentDateString="2026-02-15"
          readOnly={false}
          diagnosisMode="free"
          columns={columns}
          visibleColumnCount={9}
          bedTypes={{}}
          role="nurse_hospital"
          clinicalDocumentPresenceByBedId={{}}
          onAction={vi.fn()}
          onActivateEmptyBed={vi.fn()}
        />
      </table>
    );

    expect(patientRowSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        isSubRow: false,
        readOnly: false,
      })
    );
    expect(patientRowSpy).toHaveBeenCalledTimes(1);
  });

  it('projects a read-only provisional crib row while its guarded creation is pending', () => {
    pendingCribCreatesMock.set('R1', {
      ...DataFactory.createMockPatient('R1'),
      bedMode: 'Cuna',
      identityStatus: 'provisional',
      patientName: 'RN de Paciente',
    });
    const unifiedRows: UnifiedBedRow[] = [
      {
        kind: 'occupied',
        id: 'R1',
        bed: { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false },
        data: DataFactory.createMockPatient('R1'),
        isSubRow: false,
      },
    ];

    render(
      <table>
        <CensusTableBody
          unifiedRows={unifiedRows}
          currentDateString="2026-02-15"
          readOnly={false}
          diagnosisMode="free"
          columns={columns}
          visibleColumnCount={9}
          bedTypes={{}}
          role="nurse_hospital"
          clinicalDocumentPresenceByBedId={{}}
          onAction={vi.fn()}
          onActivateEmptyBed={vi.fn()}
        />
      </table>
    );

    expect(patientRowSpy).toHaveBeenCalledTimes(2);
    // La fila provisional se proyecta como sub-fila de sólo lectura hasta el ACK.
    expect(patientRowSpy.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        isSubRow: true,
        readOnly: true,
        data: expect.objectContaining({ patientName: 'RN de Paciente' }),
      })
    );
  });
});
