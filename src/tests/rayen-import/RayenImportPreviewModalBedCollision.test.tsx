import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';
import type { CensusImportDiff } from '@/features/rayen-import';

const source = (encounterId: string, familyName: string) => ({
  encounterId,
  run: encounterId,
  firstGivenName: 'Paciente',
  firstFamilyName: familyName,
});

const collisionDiff: CensusImportDiff = {
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  unchangedCount: 0,
  conflicts: [
    {
      bedId: 'R1',
      code: 'cma-physical-bed-collision',
      reason: 'Requiere decisión',
      source: source('CMA-1', 'CMA'),
    },
  ],
  bedOccupancyCollisions: [
    {
      id: 'R1:CMA-1:MQ-1',
      bedId: 'R1',
      availableAlternativeBedIds: ['H3C1'],
      candidates: [
        {
          clinicalEpisodeId: 'CMA-1',
          sourceKind: 'cma',
          patient: { ...EMPTY_PATIENT, bedId: 'R1', patientName: 'Paciente CMA' },
          source: source('CMA-1', 'CMA'),
        },
        {
          clinicalEpisodeId: 'MQ-1',
          sourceKind: 'medical-surgical',
          patient: { ...EMPTY_PATIENT, bedId: 'R1', patientName: 'Paciente MQ' },
          source: source('MQ-1', 'MQ'),
        },
      ],
    },
  ],
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 1,
    unchanged: 0,
  },
};

describe('Rayen equivalent-bed collision review', () => {
  it('requires a complete decision before confirming the import', () => {
    const onConfirm = vi.fn();
    render(
      <RayenImportPreviewModal
        isOpen
        diff={collisionDiff}
        error={null}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    const confirm = screen.getByRole('button', { name: 'Confirmar e importar' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Paciente CMA · CMA R1/));
    fireEvent.change(screen.getByLabelText('Acción para Paciente MQ'), {
      target: { value: 'move' },
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Cama destino para Paciente MQ'), {
      target: { value: 'H3C1' },
    });
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledWith(false, [
      {
        collisionId: 'R1:CMA-1:MQ-1',
        selectedEpisodeId: 'CMA-1',
        otherDisposition: { kind: 'move', targetBedId: 'H3C1' },
      },
    ]);
  });

  it('does not offer beds already reserved by the structural plan', () => {
    render(
      <RayenImportPreviewModal
        isOpen
        diff={{
          ...collisionDiff,
          admissions: [
            {
              bedId: 'H3C1',
              patient: { ...EMPTY_PATIENT, bedId: 'H3C1', patientName: 'Otro paciente' },
              source: source('OTHER-1', 'Otro'),
              isCma: false,
            },
          ],
          summary: { ...collisionDiff.summary, admissions: 1 },
        }}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByLabelText(/Paciente CMA · CMA R1/));
    fireEvent.change(screen.getByLabelText('Acción para Paciente MQ'), {
      target: { value: 'move' },
    });

    expect(screen.queryByRole('option', { name: 'H3C1' })).not.toBeInTheDocument();
  });
});
