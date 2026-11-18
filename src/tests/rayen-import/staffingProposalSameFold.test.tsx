import { render, renderHook, screen } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import { RayenNursingShiftProposalModal } from '@/features/rayen-import/components/RayenNursingShiftProposalModal';
import {
  inferNursingShifts,
  type NursingActivityObservation,
} from '@/features/rayen-import/domain/inferNursingShifts';
import {
  buildNursingShiftProposalPatch,
  reconcileNursingShiftProposal,
} from '@/features/rayen-import/domain/applyNursingShiftProposal';
import { useRayenStaffingProposalActions } from '@/features/rayen-import/hooks/useRayenStaffingProposalActions';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const spies = vi.hoisted(() => ({ fresh: vi.fn(), patch: vi.fn() }));
vi.mock('@/hooks/controllers/dailyRecordMutationFreshnessController', () => ({
  ensureFreshDailyRecordQuery: spies.fresh,
  patchDailyRecordWithCompatibility: spies.patch,
}));

const date = '2026-11-12';

/** Two records per patient of one Eloísa person, so the activity is enough to propose them. */
const activity = (
  role: 'nurse' | 'tens',
  author: string,
  practitionerId: string,
  hour = 12
): NursingActivityObservation[] =>
  ['syn-a', 'syn-b'].map(encounterId => ({
    author,
    encounterId,
    practitionerId,
    role: role === 'nurse' ? 'Enfermera' : 'TENS',
    source: 'vital-signs',
    recordedAt: `${date}T${String(hour).padStart(2, '0')}:00:00`,
    resolvedStaffIdentity: {
      key: practitionerId,
      name: author,
      aliases: [author],
      catalogMatched: true,
    },
  }));

// «Luz Pena» and «Luz Peña» are two Eloísa IDs: the role list has one row for each.
describe.each(['nurse', 'tens'] as const)(
  'a shift proposal with two IDs that spell alike (%s)',
  role => {
    const slot = role === 'nurse' ? 'nursesDayShift' : 'tensDayShift';
    const shift = role === 'nurse' ? 'day' : 'tensDay';
    const infer = (observations: NursingActivityObservation[], catalog: string[]) =>
      inferNursingShifts(
        observations,
        date,
        role === 'nurse' ? catalog : [],
        role === 'tens' ? catalog : []
      );

    it('does not report «Luz Peña» as synchronized where «Luz Pena» works, and adds her', () => {
      const catalog = ['Luz Pena', 'Luz Peña', 'Alba Prado', 'Inés Soto'];
      const record = { date, beds: {}, [slot]: ['Luz Pena'] } as unknown as DailyRecord;
      const proposal = infer(
        [...activity(role, 'Luz Peña', 'syn1'), ...activity(role, 'Alba Prado', 'syn2', 23)],
        catalog
      );
      expect(proposal[shift]?.names).toEqual(['Luz Peña']);
      const reconciled = reconcileNursingShiftProposal(record, proposal);
      render(
        <RayenNursingShiftProposalModal
          proposal={reconciled}
          isBusy={false}
          error={null}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );
      expect(screen.queryByText(/Ya sincronizado en HHR: .*Luz Peña/)).not.toBeInTheDocument();
      const patch = buildNursingShiftProposalPatch(record, reconciled);
      expect(patch?.[slot]?.slice(0, 2)).toEqual(['Luz Pena', 'Luz Peña']);
    });

    it('confirming writes «Luz Peña», never «Luz Pena» in her place', async () => {
      const nurse = role === 'nurse';
      const previous = nurse ? ['Luz Pena', 'Vera Vidal'] : ['Luz Pena'];
      const incoming = nurse ? ['Alba Prado', 'Luz Peña'] : ['Luz Peña'];
      const record = DataFactory.createMockDailyRecord(date, {
        [slot]: previous,
        lastUpdated: `${date}T12:00:00Z`,
      });
      const proposal = infer(
        incoming.flatMap((author, index) => activity(role, author, `id${index}`)),
        [...previous, ...incoming]
      );
      const reviewed = reconcileNursingShiftProposal(record, {
        ...proposal,
        sourceLastUpdated: record.lastUpdated,
      });
      spies.fresh.mockResolvedValue({ record });
      spies.patch.mockReset();
      const { result } = renderHook(() =>
        useRayenStaffingProposalActions({
          proposal: reviewed,
          isBusy: false,
          setProposal: vi.fn(),
          setIsBusy: vi.fn(),
          setError: vi.fn(),
          currentRecordRef: { current: record },
          isAdmin: true,
          dailyRecord: buildMockDailyRecordRepository(),
          queryClient: new QueryClient(),
        })
      );
      expect(await result.current.confirm()).toBe(true);
      expect(spies.patch).toHaveBeenCalledTimes(1);
      const written = spies.patch.mock.calls[0]?.[2]?.[slot] as string[];
      expect(written).toContain('Luz Peña');
      if (nurse) expect(written).not.toContain('Luz Pena');
    });
  }
);
