import { describe, expect, it } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import { shouldPreservePostImportFlow } from '@/features/rayen-import/domain/rayenPreviewClosePolicy';

const diff = (changes: Partial<CensusImportDiff> = {}): CensusImportDiff => ({
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
  ...changes,
});

describe('rayen preview close policy', () => {
  it('keeps detached clinical and staffing work alive for a conflict-only review', () => {
    expect(
      shouldPreservePostImportFlow(
        diff({
          conflicts: [{ bedId: 'H4C1', code: 'historical-admission-evidence', reason: 'Revisar' }],
          summary: {
            admissions: 0,
            updates: 0,
            moves: 0,
            discharges: 0,
            pendingAdministrativeDischarges: 0,
            conflicts: 1,
            unchanged: 10,
          },
        }),
        null
      )
    ).toBe(true);
  });

  it('cancels a preview whose unapplied census mutations were dismissed', () => {
    expect(
      shouldPreservePostImportFlow(
        diff({ admissions: [{ bedId: 'R1', isCma: false, patient: {} as never }] }),
        null
      )
    ).toBe(false);
  });

  it('cancels a preview whose only unapplied changes target the previous census day', () => {
    expect(
      shouldPreservePostImportFlow(
        diff({
          previousDayAdmissionCandidates: [{ bedId: 'H4C1', isCma: false, patient: {} as never }],
        }),
        null
      )
    ).toBe(false);
  });

  it('cancels a report-egreso-only preview because confirming adds it to census discharges', () => {
    expect(
      shouldPreservePostImportFlow(
        diff({
          reportEgresos: [
            {
              run: '11111111-1',
              patientName: 'Paciente egresado',
              kind: 'alta',
            } as never,
          ],
        }),
        null
      )
    ).toBe(false);
  });

  it('keeps post-import work alive after an applied result', () => {
    expect(shouldPreservePostImportFlow(diff(), {} as never)).toBe(true);
  });
});
