import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CensusTableBody } from '@/features/census/components/CensusTableBody';
import { DataFactory } from '@/tests/factories/DataFactory';

const patientRowSpy = vi.fn();
const emptyBedRowSpy = vi.fn();

vi.mock('@/features/census/components/PatientRow', () => ({
  PatientRow: (props: any) => {
    patientRowSpy(props);
    return <tr data-testid={`patient-row-${props.bed.id}`} />;
  },
}));

vi.mock('@/features/census/components/EmptyBedRow', () => ({
  EmptyBedRow: (props: any) => {
    emptyBedRowSpy(props);
    return (
      <tr data-testid={`empty-bed-row-${props.bed.id}`} onClick={props.onClick}>
        <td>{props.bed.id}</td>
      </tr>
    );
  },
}));

describe('CensusTableBody', () => {
  it('assigns action menu alignment based on row position', () => {
    patientRowSpy.mockClear();
    const occupiedRows = Array.from({ length: 6 }, (_, i) => ({
      id: `row-${i}`,
      bed: { id: `R${i + 1}`, name: `R${i + 1}` },
      data: DataFactory.createMockPatient(`R${i + 1}`),
      isSubRow: false,
    }));

    render(
      <table>
        <CensusTableBody
          occupiedRows={occupiedRows as any}
          emptyBeds={[]}
          currentDateString="2026-02-15"
          readOnly={false}
          diagnosisMode="free"
          bedTypes={{}}
          onAction={vi.fn()}
          onActivateEmptyBed={vi.fn()}
        />
      </table>
    );

    expect(patientRowSpy).toHaveBeenCalledTimes(6);
    expect(patientRowSpy.mock.calls[0][0].actionMenuAlign).toBe('top');
    expect(patientRowSpy.mock.calls[2][0].actionMenuAlign).toBe('bottom');
    expect(patientRowSpy.mock.calls[5][0].actionMenuAlign).toBe('bottom');
  });

  it('renders empty bed divider and forwards empty bed activation', () => {
    emptyBedRowSpy.mockClear();
    const onActivateEmptyBed = vi.fn();
    const emptyBeds = [
      { id: 'R9', name: 'R9' },
      { id: 'R10', name: 'R10' },
    ];

    render(
      <table>
        <CensusTableBody
          occupiedRows={[]}
          emptyBeds={emptyBeds as any}
          currentDateString="2026-02-15"
          readOnly={false}
          diagnosisMode="free"
          bedTypes={{}}
          onAction={vi.fn()}
          onActivateEmptyBed={onActivateEmptyBed}
        />
      </table>
    );

    expect(screen.getByText('Camas disponibles (2)')).toBeInTheDocument();
    expect(emptyBedRowSpy).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId('empty-bed-row-R9'));
    expect(onActivateEmptyBed).toHaveBeenCalledWith('R9');
  });
});
