import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ClinicalExplorerHeader } from '@/features/census/components/clinical-explorer/ClinicalExplorerHeader';
import { listClinicalExplorerPatients } from '@/features/census/controllers/clinicalExplorerController';
import { BEDS } from '@/constants/beds';
import { DataFactory } from '@/tests/factories/DataFactory';

it('keeps one set of print actions when changing patient and returning', () => {
  const [first, second] = listClinicalExplorerPatients({
    visibleBeds: BEDS.filter(bed => !bed.isExtra),
    beds: {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'PRIMERA SINTÉTICA',
        rut: '12345678-5',
        clinicalEpisodeId: 'ep-one',
      }),
      H1C1: DataFactory.createMockPatient('H1C1', {
        patientName: 'SEGUNDA SINTÉTICA',
        rut: '5844865-6',
        clinicalEpisodeId: 'ep-two',
      }),
    },
  });
  if (!first || !second) throw new Error('Synthetic patients are required');
  const props = { censusDate: '2026-11-04', indicationDate: null, onRequestExams: vi.fn() };
  const view = render(<ClinicalExplorerHeader {...props} patient={first} />);
  for (const next of [second, first]) {
    fireEvent.click(screen.getByRole('button', { name: 'Más acciones del paciente' }));
    view.rerender(<ClinicalExplorerHeader {...props} patient={next} />);
    const header = screen.getByTestId('clinical-explorer-patient');
    expect(header).toHaveTextContent(next.data.patientName);
    expect(within(header).getAllByRole('button', { name: 'Receta' })).toHaveLength(1);
    expect(within(header).getAllByRole('button', { name: 'Imprimir indicaciones' })).toHaveLength(
      1
    );
    expect(
      within(header).getByRole('button', { name: 'Más acciones del paciente' }).closest('details')
    ).not.toHaveAttribute('open');
  }
});
