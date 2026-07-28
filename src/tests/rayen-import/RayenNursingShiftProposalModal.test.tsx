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
    ignoredBoundaryEvidence: [
      {
        name: 'Claudia Saliente',
        role: 'Enfermera(o)',
        recordedAt: '2026-07-20T08:35:00',
        source: 'vital-signs',
        boundary: 'day_start',
      },
      {
        name: 'Ana Pérez',
        role: 'Enfermera(o)',
        recordedAt: '2026-07-20T08:42:00',
        source: 'medication-administration',
        boundary: 'day_start',
      },
    ],
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
    expect(screen.getByText(/HHR conservó 2 firmas cercanas al relevo/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Ver actividad cercana al relevo (2)'));
    expect(screen.getByText(/Claudia Saliente · 20-07 08:35/)).toBeVisible();
    expect(screen.getAllByText(/Ventana de relevo: primeros 60 min del turno día/)).toHaveLength(2);

    expect(screen.getByRole('dialog', { name: 'Dotación clínica identificada' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar propuesta' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows TENS separately from nursing with its own shift evidence', () => {
    renderProposal({
      proposal: {
        ...proposal,
        tensDay: {
          names: ['Jimena Yáñez'],
          candidates: [
            {
              name: 'Jimena Yáñez',
              records: 5,
              patients: 2,
              activeHours: 3,
              score: 21,
              hasShiftChange: false,
              catalogMatched: false,
            },
          ],
          ignoredBoundaryRecords: 0,
          ambiguous: false,
        },
      },
      isBusy: false,
      error: null,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(screen.getByText('TENS · Turno largo')).toBeVisible();
    expect(screen.getByText('Jimena Yáñez')).toBeVisible();
  });

  it('reports an already synchronized shift without proposing another write', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderProposal({
      proposal: {
        ...proposal,
        day: {
          ...proposal.day,
          names: [],
          alreadyAssigned: ['Ana Pérez'],
          ignoredBoundaryRecords: 0,
          ignoredBoundaryEvidence: [],
        },
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
    const onCancel = vi.fn();
    renderProposal({
      proposal: {
        ...proposal,
        day: { ...proposal.day, names: [], ambiguous: true },
        night: { ...proposal.night, names: [], candidates: [] },
      },
      isBusy: false,
      error: null,
      onConfirm: vi.fn(),
      onCancel,
    });

    expect(screen.getByTestId('rayen-nursing-shift-proposal')).toBeVisible();
    expect(screen.getByText(/Un cupo quedó sin sugerencia/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Aplicar propuesta' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps exclusion-only evidence visible without offering a write', () => {
    renderProposal({
      proposal: {
        censusDate: proposal.censusDate,
        day: { ...proposal.day, names: [], candidates: [] },
        night: { names: [], candidates: [], ignoredBoundaryRecords: 0, ambiguous: false },
      },
      isBusy: false,
      error: null,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(screen.getByTestId('rayen-nursing-shift-proposal')).toBeVisible();
    expect(screen.getByText(/HHR conservó 2 firmas cercanas al relevo/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Aplicar propuesta' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entendido' })).toBeVisible();
  });

  it('keeps a concurrent no-op visible so the user can review the current assignment', () => {
    const error =
      'La dotación clínica ya está sincronizada o cambió mientras revisabas la propuesta. Revisa la asignación actual.';

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

  it('warns explicitly when confirmation will replace the standard nurse roster', () => {
    renderProposal({
      proposal: {
        ...proposal,
        day: {
          ...proposal.day,
          names: ['Ana Pérez', 'Berta Soto'],
          currentNames: ['Noche 1', 'Noche 2'],
          replaceStandardSlots: true,
        },
        night: { ...proposal.night, names: [], candidates: [] },
      },
      isBusy: false,
      error: null,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(
      screen.getByText('Se reemplazará la asignación actual: Noche 1, Noche 2.')
    ).toBeVisible();
    expect(screen.getByText(/los cupos adicionales no cambiarán/)).toBeVisible();
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
