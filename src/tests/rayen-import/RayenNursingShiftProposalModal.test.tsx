import type { ComponentProps } from 'react';
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

const renderProposal = (props: ComponentProps<typeof RayenNursingShiftProposalModal>) =>
  render(
    <>
      <div id="rayen-nursing-shift-slot" />
      <RayenNursingShiftProposalModal {...props} />
    </>
  );

describe('RayenNursingShiftProposalModal', () => {
  it('shows evidence and requires explicit confirmation before filling vacancies', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderProposal({
      proposal,
      isBusy: false,
      error: null,
      onConfirm,
      onCancel,
    });

    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByText('Berta Soto')).toBeInTheDocument();
    expect(screen.getByText(/4 registros · 3 pacientes/)).toBeInTheDocument();
    expect(screen.getByText(/coincide con nómina HHR/)).toBeInTheDocument();
    expect(screen.getByText(/Se excluyeron 2 registros cercanos al relevo/)).toBeInTheDocument();

    expect(screen.getByRole('dialog', { name: 'Enfermería identificada' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar propuesta' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('reports an already synchronized shift without proposing another write', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderProposal({
      proposal: {
        ...proposal,
        day: { ...proposal.day, names: [], alreadyAssigned: ['Ana Pérez'] },
        night: { ...proposal.night, names: [], alreadyAssigned: ['Berta Soto'] },
      },
      isBusy: false,
      error: null,
      onConfirm,
      onCancel,
    });

    expect(screen.queryByTestId('rayen-nursing-shift-proposal')).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('surfaces an ambiguous shift without offering an unsafe write', () => {
    renderProposal({
      proposal: {
        ...proposal,
        day: { ...proposal.day, names: [], ambiguous: true },
        night: { ...proposal.night, names: [], candidates: [] },
      },
      isBusy: false,
      error: null,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(screen.queryByTestId('rayen-nursing-shift-proposal')).not.toBeInTheDocument();
  });

  it('keeps a concurrent no-op visible so the user can review the current assignment', () => {
    const error =
      'La dotación de enfermería ya está sincronizada o cambió mientras revisabas la propuesta. Revisa la asignación actual.';

    renderProposal({
      proposal,
      isBusy: false,
      error,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(screen.getByText(error)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Aplicar propuesta' })).toBeEnabled();
  });

  it('keeps an explicit no-data result inside the synchronization flow', () => {
    renderProposal({
      proposal: {
        censusDate: proposal.censusDate,
        day: { names: [], candidates: [], ignoredBoundaryRecords: 0, ambiguous: false },
        night: { names: [], candidates: [], ignoredBoundaryRecords: 0, ambiguous: false },
      },
      isBusy: false,
      error: null,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(screen.queryByTestId('rayen-nursing-shift-proposal')).not.toBeInTheDocument();
  });
});
