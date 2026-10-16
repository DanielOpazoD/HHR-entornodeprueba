import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  reconcileNursingShiftProposal,
  hasNursingShiftReview,
  hasPendingStaffingDecision,
  buildNursingShiftProposalPatch,
} from '@/features/rayen-import/domain/applyNursingShiftProposal';
import { RayenNursingShiftProposalModal } from '@/features/rayen-import/components/RayenNursingShiftProposalModal';
import type { NursingStaffingProposal } from '@/features/rayen-import/contracts/nursingShiftInference';
import type { DailyRecord } from '@/types/domain/dailyRecord';
const suggestion = (names: string[]) => ({
  names,
  ambiguous: false,
  ignoredBoundaryRecords: 0,
  candidates: names.map((name, i) => ({
    name,
    records: 4 - i,
    patients: 2,
    activeHours: 2,
    score: 30 - i,
    hasShiftChange: false,
    catalogMatched: false,
  })),
});
const proposal: NursingStaffingProposal = {
  censusDate: '2026-10-16',
  day: {
    ...suggestion(['Ana', 'Berta']),
    candidates: suggestion(['Ana', 'Berta', 'Carla']).candidates,
  },
  night: suggestion([]),
};
const record = (placeholder: string) =>
  ({
    date: proposal.censusDate,
    beds: {},
    nursesDayShift: [placeholder, placeholder],
    nursesNightShift: ['', ''],
    tensDayShift: ['', '', ''],
    tensNightShift: ['', '', ''],
  }) as unknown as DailyRecord;

describe('staffing vacancy review', () => {
  it.each(['', '--', 'Vacante'])(
    'fills %s slots without warning about replacing staff',
    placeholder => {
      const current = record(placeholder);
      const reconciled = reconcileNursingShiftProposal(current, proposal);
      expect(reconciled.day.replaceStandardSlots).toBe(false);
      expect(reconciled.day.names).toEqual(['Ana', 'Berta']);
      expect(buildNursingShiftProposalPatch(current, reconciled)?.nursesDayShift).toEqual([
        'Ana',
        'Berta',
      ]);
      render(
        <RayenNursingShiftProposalModal
          proposal={reconciled}
          isBusy={false}
          error={null}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );
      expect(screen.queryByText(/reemplazar/i)).not.toBeInTheDocument();
    }
  );
  it('retains a boundary-only review in staffing without creating a pending write', () => {
    const boundaryOnly = {
      ...proposal,
      day: { ...suggestion([]), ignoredBoundaryRecords: 9 },
      night: suggestion([]),
    };
    expect(hasNursingShiftReview(boundaryOnly)).toBe(true);
    expect(hasPendingStaffingDecision(boundaryOnly)).toBe(false);
    render(
      <RayenNursingShiftProposalModal
        proposal={boundaryOnly}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('Actividad de relevo')).toBeVisible();
    expect(screen.getByText('Sin cambios de dotación.')).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Enfermería · Turno largo' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Ver detalle · 9 registros'));
    expect(screen.getByTestId('rayen-staffing-observation')).toHaveAttribute('open');
    expect(screen.queryByRole('button', { name: 'Aplicar propuesta' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entendido' })).toBeVisible();
  });
  it('does not display a stale replacement flag for vacant placeholders', () => {
    render(
      <RayenNursingShiftProposalModal
        proposal={{
          ...proposal,
          day: {
            ...proposal.day,
            replaceStandardSlots: true,
            currentNames: ['Vacante', '--'],
          },
        }}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.queryByText(/reemplazar/i)).not.toBeInTheDocument();
  });
});
