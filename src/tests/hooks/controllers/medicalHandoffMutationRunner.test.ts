import { describe, expect, it, vi } from 'vitest';
import { runMedicalHandoffMutation } from '@/hooks/controllers/medicalHandoffMutationRunner';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { PatientData } from '@/hooks/contracts/patientHookContracts';

const buildPatient = (): PatientData =>
  ({
    bedId: 'H5C2',
    patientName: 'Paciente Demo',
    rut: '22.222.222-2',
    medicalHandoffEntries: [],
  }) as unknown as PatientData;

const buildContext = () => ({
  patient: buildPatient(),
  recordDate: '2026-05-03',
});

const success = <T>(data: T): ApplicationOutcome<T | null> => ({
  status: 'success',
  data,
  issues: [],
});

const failed = <T>(): ApplicationOutcome<T | null> => ({
  status: 'failed',
  data: null,
  issues: [{ kind: 'unknown', message: 'use case rejected' }],
});

const buildDeps = (overrides: Record<string, unknown> = {}) => ({
  resolveContext: vi.fn().mockReturnValue(buildContext()),
  resolvePersister: vi.fn().mockReturnValue(vi.fn().mockResolvedValue(undefined)),
  logUnexpectedOutcome: vi.fn(),
  logDebouncedEvent: vi.fn(),
  ...overrides,
});

describe('runMedicalHandoffMutation', () => {
  it('returns early without executing when context cannot be resolved (read-only / no patient)', async () => {
    const execute = vi.fn();
    const deps = buildDeps({ resolveContext: vi.fn().mockReturnValue(null) });

    await runMedicalHandoffMutation(deps, {
      bedId: 'H5C2',
      isNested: false,
      handlerName: 'handleMedicalEntryDelete',
      execute,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(deps.logUnexpectedOutcome).not.toHaveBeenCalled();
    expect(deps.logDebouncedEvent).not.toHaveBeenCalled();
  });

  it('executes the use case with the resolved context + persister', async () => {
    const persistFn = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue(success({ entry: { specialty: 'cirugia' } }));
    const deps = buildDeps({ resolvePersister: vi.fn().mockReturnValue(persistFn) });

    await runMedicalHandoffMutation(deps, {
      bedId: 'H5C2',
      isNested: true,
      handlerName: 'handleMedicalEntryAdd',
      execute,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ recordDate: '2026-05-03' }),
      persistFn
    );
    expect(deps.resolvePersister).toHaveBeenCalledWith('H5C2', true);
  });

  it('logs the unexpected outcome and skips audit when the use case fails', async () => {
    const execute = vi.fn().mockResolvedValue(failed());
    const deps = buildDeps();

    await runMedicalHandoffMutation(deps, {
      bedId: 'H5C2',
      isNested: false,
      handlerName: 'handleMedicalEntryDelete',
      execute,
      audit: {
        debounceMs: 10000,
        buildPayload: vi.fn(),
      },
    });

    expect(deps.logUnexpectedOutcome).toHaveBeenCalledWith(
      'handleMedicalEntryDelete',
      expect.objectContaining({ status: 'failed' })
    );
    expect(deps.logDebouncedEvent).not.toHaveBeenCalled();
  });

  it('emits a debounced MEDICAL_HANDOFF_MODIFIED event with the payload built from the outcome', async () => {
    const buildPayload = vi.fn().mockReturnValue({ specialty: 'cirugia', value: 'nota' });
    const execute = vi.fn().mockResolvedValue(success({ entry: { specialty: 'cirugia' } }));
    const deps = buildDeps();

    await runMedicalHandoffMutation(deps, {
      bedId: 'H5C2',
      isNested: false,
      handlerName: 'handleMedicalEntryNoteChange',
      execute,
      audit: { debounceMs: 30000, buildPayload },
    });

    expect(buildPayload).toHaveBeenCalledTimes(1);
    expect(deps.logDebouncedEvent).toHaveBeenCalledWith(
      'MEDICAL_HANDOFF_MODIFIED',
      'patient',
      'H5C2',
      { specialty: 'cirugia', value: 'nota' },
      '22.222.222-2',
      '2026-05-03',
      undefined,
      30000
    );
  });

  it('skips the audit emission when no audit options are provided (e.g., specialty change)', async () => {
    const execute = vi.fn().mockResolvedValue(success({ entry: { specialty: 'medicina' } }));
    const deps = buildDeps();

    await runMedicalHandoffMutation(deps, {
      bedId: 'H5C2',
      isNested: false,
      handlerName: 'handleMedicalEntrySpecialtyChange',
      execute,
    });

    expect(deps.logDebouncedEvent).not.toHaveBeenCalled();
  });
});
