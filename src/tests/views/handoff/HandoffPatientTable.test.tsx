/** @vitest-environment jsdom */
import '../../setup';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { HandoffPatientTable } from '@/features/handoff/components/HandoffPatientTable';
import { render } from '../../integration/setup';
import { BEDS } from '@/constants/beds';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('HandoffPatientTable', () => {
  const mockRecord: DailyRecord = DataFactory.createMockDailyRecord('2025-01-01', {
    beds: {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'Patient 1',
        clinicalEvents: [
          { id: 'e1', name: 'Cirugía P1', date: '2025-01-01', note: '', createdAt: '' },
        ],
      }),
      R2: DataFactory.createMockPatient('R2', { patientName: 'Patient 2' }),
    },
  });

  const defaultProps = {
    visibleBeds: BEDS.filter(b => b.id === 'R1' || b.id === 'R2'),
    record: mockRecord,
    noteField: 'handoffNoteDayShift' as const,
    onNoteChange: vi.fn(),
    clinicalEventActions: {
      onAdd: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    },
    tableHeaderClass: 'bg-slate-50',
    readOnly: false,
    isMedical: false,
    hasAnyPatients: true,
    shouldShowPatient: () => true,
  };

  it('toggles global expansion state when header button is clicked', () => {
    render(<HandoffPatientTable {...defaultProps} />);

    // Inicialmente el evento no debería estar visible
    expect(screen.queryByText('Cirugía P1')).not.toBeInTheDocument();

    // Botón de expansión global
    const globalExpandBtn = screen.getByTitle(/Expandir todos los eventos/i);
    fireEvent.click(globalExpandBtn);

    // Ahora debería aparecer el evento
    expect(screen.getByText('Cirugía P1')).toBeInTheDocument();

    // Botón de colapso global
    const globalCollapseBtn = screen.getByTitle(/Colapsar todos los eventos/i);
    fireEvent.click(globalCollapseBtn);

    expect(screen.queryByText('Cirugía P1')).not.toBeInTheDocument();
  });

  it('shows global expand button in medical mode when clinical event actions are available', () => {
    render(<HandoffPatientTable {...defaultProps} isMedical={true} />);

    const globalExpandBtn = screen.getByTitle(/Expandir todos los eventos/i);
    fireEvent.click(globalExpandBtn);

    expect(screen.getByText('Cirugía P1')).toBeInTheDocument();
  });

  it('hides blocked beds in medical mode', () => {
    const blockedRecord: DailyRecord = DataFactory.createMockDailyRecord('2025-01-01', {
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente bloqueado',
          isBlocked: true,
        }),
        R2: DataFactory.createMockPatient('R2', { patientName: 'Paciente visible' }),
      },
    });

    render(
      <HandoffPatientTable
        {...defaultProps}
        isMedical={true}
        record={blockedRecord}
        visibleBeds={BEDS.filter(b => b.id === 'R1' || b.id === 'R2')}
      />
    );

    expect(screen.queryByText('Paciente bloqueado')).not.toBeInTheDocument();
    expect(screen.getByText('Paciente visible')).toBeInTheDocument();
  });
});
