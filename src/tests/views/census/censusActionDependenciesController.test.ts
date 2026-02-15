import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { buildCensusActionDependencies } from '@/features/census/controllers/censusActionDependenciesController';

describe('censusActionDependenciesController', () => {
  it('merges data/runtime/ui dependencies into a single runtime contract', () => {
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
      runtime: {
        clearPatient: vi.fn(),
        moveOrCopyPatient: vi.fn(),
        addDischarge: vi.fn(),
        updateDischarge: vi.fn(),
        addTransfer: vi.fn(),
        updateTransfer: vi.fn(),
        addCMA: vi.fn(),
        copyPatientToDate: vi.fn(),
      },
      ui: {
        confirm: vi.fn(),
        notifyError: vi.fn(),
      },
    });

    expect(dependencies.record?.date).toBe('2026-02-15');
    expect(dependencies.stabilityRules.canPerformActions).toBe(true);
    expect(typeof dependencies.moveOrCopyPatient).toBe('function');
    expect(typeof dependencies.confirm).toBe('function');
    expect(typeof dependencies.notifyError).toBe('function');
  });
});
