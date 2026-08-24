import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';
import type { CensusImportDiff } from '@/features/rayen-import';

const cmaAdmissionDiff: CensusImportDiff = {
  admissions: [
    {
      bedId: 'R1',
      isCma: true,
      patient: { ...EMPTY_PATIENT, bedId: 'R1', patientName: 'Paciente CMA' },
      source: {
        encounterId: 'CMA-1',
        run: '11.111.111-1',
        firstGivenName: 'Paciente',
        firstFamilyName: 'CMA',
        service: 'Área quirúrgica indiferenciada',
        room: 'CMA R1',
        bed: 'CMAR1',
      },
    },
  ],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 1,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
};

describe('Rayen CMA first-sync admission review', () => {
  it('requires an explicit incorporate decision before confirming a CMA-source admission', () => {
    const onConfirm = vi.fn();
    render(
      <RayenImportPreviewModal
        isOpen
        diff={cmaAdmissionDiff}
        error={null}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Revisar ingresos provenientes de CMA (1)')).toBeVisible();
    expect(screen.getByTestId('rayen-import-preview')).toHaveTextContent('Paciente CMA');
    expect(screen.getByText('(procedencia CMA)')).toBeVisible();
    const confirm = screen.getByRole('button', { name: 'Confirmar e importar' });
    expect(confirm).toBeDisabled();

    fireEvent.click(
      screen.getByRole('radio', {
        name: 'Incorporar al censo en la cama R1',
      })
    );
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledWith(false, undefined, [
      { admissionKey: '["CMA-1","R1",null,"","Paciente CMA"]', disposition: 'admit' },
    ]);
  });

  it('allows deferring the patient and explains that a future sync will propose it again', () => {
    const onConfirm = vi.fn();
    render(
      <RayenImportPreviewModal
        isOpen
        diff={cmaAdmissionDiff}
        error={null}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('radio', { name: /No incorporar por ahora/i }));
    expect(
      screen.getByText('Se volverá a proponer mientras continúe presente en Eloísa.')
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e importar' }));

    expect(onConfirm).toHaveBeenCalledWith(false, undefined, [
      { admissionKey: '["CMA-1","R1",null,"","Paciente CMA"]', disposition: 'defer' },
    ]);
  });

  it('requires a new decision when the proposed physical bed changes', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <RayenImportPreviewModal
        isOpen
        diff={cmaAdmissionDiff}
        error={null}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Incorporar al censo en la cama R1' }));
    expect(screen.getByRole('button', { name: 'Confirmar e importar' })).toBeEnabled();

    const changedDiff: CensusImportDiff = {
      ...cmaAdmissionDiff,
      admissions: cmaAdmissionDiff.admissions.map(admission => ({
        ...admission,
        bedId: 'R2',
        patient: { ...admission.patient, bedId: 'R2' },
      })),
    };
    rerender(
      <RayenImportPreviewModal
        isOpen
        diff={changedDiff}
        error={null}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Confirmar e importar' })).toBeDisabled();
    expect(
      screen.getByRole('radio', { name: 'Incorporar al censo en la cama R2' })
    ).not.toBeChecked();
  });
});
