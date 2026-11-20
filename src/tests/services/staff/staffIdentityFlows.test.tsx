import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaffSelector } from '@/features/census/components/StaffSelector';
import { StaffShiftDetailsModal } from '@/features/census/components/StaffShiftDetailsModal';
import { inferNursingShifts } from '@/features/rayen-import/domain/inferNursingShifts';
import {
  buildNursingShiftProposalPatch,
  reconcileNursingShiftProposal,
} from '@/features/rayen-import/domain/applyNursingShiftProposal';
import { mergeEloisaStaff } from '@/services/staff/eloisaStaffDiscovery';
import {
  mergeStaffCatalog,
  savedStaffRows,
  type EloisaStaffIdentity,
  type NursingRole,
} from '@/services/staff/eloisaStaffIdentity';
import { countStaffUsage } from '@/services/staff/staffUsage';
import { formatStaffDisplayName } from '@/services/staff/staffDisplayName';
import type { DailyRecordStaffingDetailsV1 } from '@/types/domain/dailyRecordStaffingDetails';
import { DataFactory } from '@/tests/factories/DataFactory';

const staff = vi.hoisted(() => ({ staffIdentities: [] as EloisaStaffIdentity[] }));
vi.mock('@/context/StaffContext', () => ({ useStaffContext: () => staff }));
afterEach(cleanup);

/**
 * One table of every flow that reads, compares, shows or writes staff names, run through the
 * four identity scenarios. `people` is how many persons the two spellings are; `kept` is the
 * spelling a single person shows. The catalog save, its reopening and its late confirmation
 * run against Firestore in the emulator suites (shared-staff-catalog, staffCatalogEloisaDerived).
 */
const SCENARIOS = [
  { name: 'two IDs', a: 'Luz Pena', b: 'Luz Peña', ids: ['syn1', 'syn2'], people: 2 },
  { name: 'one ID', a: 'Luz Pena', b: 'Luz Peña', ids: ['syn1', 'syn1'], people: 1 },
  { name: 'no ID', a: 'Luz Pena', b: 'Luz Peña', ids: [], people: 1 },
  { name: 'cedilla, no ID', a: 'Ana Franca', b: 'Ana França', ids: [], people: 2 },
] as const;

const peopleOf = (role: NursingRole, scenario: (typeof SCENARIOS)[number]): EloisaStaffIdentity[] =>
  mergeEloisaStaff(
    [],
    scenario.ids.map((practitionerId, index) => ({
      practitionerId,
      author: index === 0 ? scenario.a : scenario.b,
      role: role === 'nurse' ? 'Enfermera' : 'TENS',
      recordedAt: '2026-11-01T12:00',
    }))
  );

describe.each(['nurse', 'tens'] as const)('staff identity flows (%s)', role => {
  describe.each(SCENARIOS)('$name', scenario => {
    const { a, b, people: expected } = scenario;
    const people = peopleOf(role, scenario);
    // The role list as the editor and the census get it: saved texts grouped by person.
    const list = mergeStaffCatalog([a, b], people, role);
    const kept = expected === 1 ? b : undefined;

    it('role list (editor rows and Eloísa publication)', () => {
      expect(list).toHaveLength(expected);
      if (kept) expect(list).toEqual([kept]);
      expect(savedStaffRows([a, b], people, role)).toHaveLength(expected);
    });

    it('header selector: options and the saved «a»', () => {
      staff.staffIdentities = people;
      const slots = role === 'nurse' ? 2 : 3;
      render(
        <StaffSelector
          role={role}
          dayShift={[a, ...Array(slots - 1).fill('')]}
          nightShift={Array(slots).fill('')}
          catalog={list}
          onUpdate={vi.fn()}
        />
      );
      const [select] = screen.getAllByRole('combobox') as HTMLSelectElement[];
      const options = Array.from(select.options, option => option.value).filter(
        option => option !== 'Vacante'
      );
      expect(options).toHaveLength(expected);
      expect(select.value).toBe(kept ?? a);
    });

    it('shift detail: options and the saved «a»', () => {
      staff.staffIdentities = people;
      const assignments = (who: 'nurses' | 'tens') =>
        role === (who === 'nurses' ? 'nurse' : 'tens')
          ? [
              {
                id: 'slot-1',
                name: a,
                role,
                slotType: 'standard' as const,
                standardSlotIndex: 0,
                startTime: '08:00',
                endTime: '20:00',
              },
            ]
          : [];
      const detail = {
        day: { nurses: assignments('nurses'), tens: assignments('tens') },
        night: { nurses: [], tens: [] },
      } as unknown as DailyRecordStaffingDetailsV1;
      render(
        <StaffShiftDetailsModal
          isOpen
          onClose={vi.fn()}
          role={role}
          initialShift="day"
          recordDate="2026-11-12"
          detail={detail}
          nursesList={list}
          tensList={list}
          onSave={vi.fn()}
        />
      );
      const [select] = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(Array.from(select.options).filter(option => option.value !== 'Vacante')).toHaveLength(
        expected
      );
      expect(select.value).toBe(kept ?? a);
    });

    it('shift proposal: «b» proposed where «a» already works', () => {
      const slot = role === 'nurse' ? 'nursesDayShift' : 'tensDayShift';
      const proposal = inferNursingShifts(
        ['syn-a', 'syn-b'].map(encounterId => ({
          author: b,
          encounterId,
          practitionerId: scenario.ids[1],
          role: role === 'nurse' ? 'Enfermera' : 'TENS',
          source: 'vital-signs' as const,
          recordedAt: '2026-11-12T12:00:00',
        })),
        '2026-11-12',
        role === 'nurse' ? list : [],
        role === 'tens' ? list : []
      );
      const record = DataFactory.createMockDailyRecord('2026-11-12', { beds: {}, [slot]: [a] });
      const patch = buildNursingShiftProposalPatch(
        record,
        reconcileNursingShiftProposal(record, proposal)
      );
      // One person is already there; two people get the second slot.
      expect(patch?.[slot]?.filter(Boolean) ?? [a]).toHaveLength(expected);
    });

    it('less-used names: one count per person', () => {
      const usage = countStaffUsage(
        [
          { nursesDayShift: [a], tensDayShift: [a] },
          { nursesDayShift: [b], tensDayShift: [b] },
        ],
        people
      );
      expect(Object.keys(usage[role])).toHaveLength(expected);
    });

    it("Eloísa registry and short label: one record per ID, the person's own spelling", () => {
      expect(people).toHaveLength(new Set(scenario.ids).size);
      // Only one ID turns «a» into that person's spelling; two IDs or none keep it as written.
      expect(formatStaffDisplayName(a, people, role)).toBe(scenario.name === 'one ID' ? b : a);
    });
  });
});
