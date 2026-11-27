// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { buildCensusActionDependencies } from '@/features/census/controllers/censusActionDependenciesController';

describe('censusActionDependenciesController', () => {
  it('merges data/runtime/ui dependencies into a single runtime contract', () => {
    const runtime = {
      clearPatient: vi.fn(),
      moveOrCopyPatient: vi.fn(),
      addDischarge: vi.fn(),
      updateDischarge: vi.fn(),
      addTransfer: vi.fn(),
      updateTransfer: vi.fn(),
      addCMA: vi.fn(),
      copyPatientToDate: vi.fn(),
    };
    const ui = {
      confirm: vi.fn(),
      notifyError: vi.fn(),
    };
    const dependencies = buildCensusActionDependencies({
      data: {
        record: DataFactory.createMockDailyRecord('2026-02-15'),
        stabilityRules: {
          isDateLocked: false,
          isDayShiftLocked: false,
          isNightShiftLocked: false,
          canEditField: () => true,
          canPerformActions: true,
        },
      },
      runtime,
      ui,
    });

    expect(dependencies.record?.date).toBe('2026-02-15');
    expect(dependencies.stabilityRules.canPerformActions).toBe(true);
    expect(dependencies.clearPatient).toBe(runtime.clearPatient);
    expect(dependencies.moveOrCopyPatient).toBe(runtime.moveOrCopyPatient);
    expect(dependencies.addDischarge).toBe(runtime.addDischarge);
    expect(dependencies.addTransfer).toBe(runtime.addTransfer);
    expect(dependencies.confirm).toBe(ui.confirm);
    expect(dependencies.notifyError).toBe(ui.notifyError);
  });
});
