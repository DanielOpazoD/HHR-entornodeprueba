import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UpcEvaluationHistoryPanel } from '@/features/census/components/patient-row/UpcEvaluationHistoryPanel';
import { loadPatientUpcHistory } from '@/services/patient/patientUpcHistoryService';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { UpcEvaluationSnapshot } from '@/domain/upc/upcContracts';

vi.mock('@/services/patient/patientUpcHistoryService', () => ({ loadPatientUpcHistory: vi.fn() }));
const entries: UpcEvaluationSnapshot[] = Array.from({ length: 6 }, (_, index) => ({
  evaluationId: String(index),
  evaluatedAt: `2026-09-04T1${8 - index}:00:00Z`,
  evaluatedForDate: '2026-09-04',
  evaluatedBedId: 'R1',
  uciCriteria: [],
  utiCriteria: [],
  classification: null,
  criterionLabels: ['Texto conservado al firmar'],
  responsibleNurse: { name: `Enfermera ${index}`, source: 'assigned' },
  evaluatedBy: { uid: 'test', displayName: 'Cuenta de prueba' },
}));
const patient = DataFactory.createMockPatient('R1', { upcChecklist: entries[0] });

describe('UPC history view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadPatientUpcHistory).mockResolvedValue({ entries, warning: null });
  });
  it('lists every evaluation via pagination, showing criteria/audit details on demand', async () => {
    render(<UpcEvaluationHistoryPanel patient={patient} date="2026-09-04" />);
    expect(await screen.findByText('6 evaluaciones · 1/2')).toBeInTheDocument();
    expect(screen.getAllByText('Sin criterios UPC')).toHaveLength(4);
    expect(screen.getByText('Enfermera 0')).toBeInTheDocument();
    expect(screen.queryByText('Enfermera 4')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Evaluaciones anteriores' }));
    expect(screen.getByText('Enfermera 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Evaluaciones anteriores' })).toBeDisabled();
    expect(screen.getAllByText('Texto conservado al firmar')).toHaveLength(2);
    expect(screen.getAllByText('Registrado por: Cuenta de prueba')).toHaveLength(2);
  });
  it('exposes partial history and offers refresh without writing anything', async () => {
    vi.mocked(loadPatientUpcHistory).mockResolvedValueOnce({
      entries: [entries[0]],
      warning: 'Historial parcial: sin conexión',
    });
    render(<UpcEvaluationHistoryPanel patient={patient} date="2026-09-04" />);
    expect(await screen.findByText('Historial parcial: sin conexión')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar historial UPC' }));
    expect(await screen.findByText('6 evaluaciones · 1/2')).toBeInTheDocument();
    expect(screen.queryByText('Historial parcial: sin conexión')).not.toBeInTheDocument();
  });
  it('does not replace a new patient history with a late response from the previous patient', async () => {
    let finish!: (value: { entries: UpcEvaluationSnapshot[]; warning: null }) => void;
    vi.mocked(loadPatientUpcHistory).mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve;
      })
    );
    const { rerender } = render(<UpcEvaluationHistoryPanel patient={patient} date="2026-09-04" />);
    await waitFor(() => expect(loadPatientUpcHistory).toHaveBeenCalledOnce());
    vi.mocked(loadPatientUpcHistory).mockResolvedValueOnce({ entries: [], warning: null });
    rerender(
      <UpcEvaluationHistoryPanel
        patient={{ ...patient, rut: '99.999.999-9', upcChecklist: undefined }}
        date="2026-09-04"
      />
    );
    expect(
      await screen.findByText('No hay evaluaciones UPC guardadas disponibles.')
    ).toBeInTheDocument();
    finish({ entries, warning: null });
    await waitFor(() => expect(screen.queryByText('Enfermera 0')).not.toBeInTheDocument());
  });
});
