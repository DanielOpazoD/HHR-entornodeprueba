import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RayenNursingShiftProposalModal } from '@/features/rayen-import/components/RayenNursingShiftProposalModal';
import type { NursingStaffingProposal } from '@/features/rayen-import/contracts/nursingShiftInference';

const proposal: NursingStaffingProposal = {
  censusDate: '2026-07-20',
  day: {
    names: ['Ana Pérez'],
    candidates: [
      {
        name: 'Ana Pérez',
        records: 4,
        patients: 3,
        activeHours: 3,
        score: 25,
        hasShiftChange: true,
        catalogMatched: true,
      },
    ],
    ignoredBoundaryRecords: 2,
    ambiguous: false,
  },
  night: {
    names: ['Berta Soto'],
    candidates: [
      {
        name: 'Berta Soto',
        records: 2,
        patients: 2,
        activeHours: 2,
        score: 16,
        hasShiftChange: false,
        catalogMatched: false,
      },
    ],
    ignoredBoundaryRecords: 0,
    ambiguous: false,
  },
};

describe('RayenNursingShiftProposalModal', () => {
  it('shows evidence and requires explicit confirmation before filling vacancies', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <RayenNursingShiftProposalModal
        proposal={proposal}
        isBusy={false}
        error={null}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByText('Berta Soto')).toBeInTheDocument();
    expect(screen.getByText(/4 registros · 3 pacientes/)).toBeInTheDocument();
    expect(screen.getByText(/coincide con nómina HHR/)).toBeInTheDocument();
    expect(screen.getByText(/Se excluyeron 2 registros cercanos al relevo/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Completar vacantes' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('reports an already synchronized shift without proposing another write', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <RayenNursingShiftProposalModal
        proposal={{
          ...proposal,
          day: { ...proposal.day, names: [], alreadyAssigned: ['Ana Pérez'] },
          night: { ...proposal.night, names: [], alreadyAssigned: ['Berta Soto'] },
        }}
        isBusy={false}
        error={null}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText('Ya sincronizado en HHR: Ana Pérez.')).toBeInTheDocument();
    expect(screen.getByText('Ya sincronizado en HHR: Berta Soto.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Completar vacantes' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('surfaces an ambiguous shift without offering an unsafe write', () => {
    render(
      <RayenNursingShiftProposalModal
        proposal={{
          ...proposal,
          day: { ...proposal.day, names: [], ambiguous: true },
          night: { ...proposal.night, names: [], candidates: [] },
        }}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText(/evidencia insuficiente/)).toBeInTheDocument();
    expect(screen.getByText(/Un cupo quedó sin sugerencia/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Completar vacantes' })).not.toBeInTheDocument();
  });
});
