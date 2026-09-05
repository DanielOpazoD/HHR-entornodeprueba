import { describe, it, expect, vi } from 'vitest';
import { executeBedManagementAction } from '@/hooks/controllers/bedManagementDispatchController';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { BedAction } from '@/hooks/contracts/bedManagementActionContracts';

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

const setup = () => {
  const currentRecord = DataFactory.createMockDailyRecord('2026-09-04');
  currentRecord.beds.R1 = DataFactory.createMockPatient('R1', {
    patientName: 'Paciente de prueba',
    isUPC: false,
  });
  const action: BedAction = {
    type: 'UPDATE_PATIENT_MULTIPLE',
    bedId: 'R1',
    fields: {
      isUPC: true,
      upcChecklist: {
        uciCriteria: ['uci_vmi'],
        utiCriteria: [],
        classification: 'UPC_UCI',
        evaluatedAt: '2026-09-04T12:00:00Z',
        evaluatedForDate: currentRecord.date,
        evaluatedBedId: 'R1',
        evaluatedBy: { uid: 'test', displayName: 'Cuenta de prueba' },
        responsibleNurse: { name: 'Enfermera A', shift: 'day', source: 'assigned' },
        reviewRequired: false,
      },
    },
  };
  return {
    currentRecord,
    action,
    patchRecord: vi.fn().mockResolvedValue(undefined),
    validation: { processFieldValue: vi.fn((_field, value) => ({ valid: true, value })) },
    bedAudit: {
      auditPatientChange: vi.fn(),
      auditCudyrChange: vi.fn(),
      auditCribCudyrChange: vi.fn(),
      auditPatientCleared: vi.fn(),
      auditPatientModified: vi.fn(),
      auditPatientMovement: vi.fn(),
    },
  };
};

describe('UPC evaluation persistence boundary', () => {
  it('sends checklist, boolean and bed override as one remote-confirmed patch, with no optimistic success', async () => {
    const input = setup();
    let finish!: () => void;
    input.patchRecord.mockReturnValue(
      new Promise<void>(resolve => {
        finish = resolve;
      })
    );
    const completed = vi.fn();
    const pending = executeBedManagementAction(input).then(completed);
    expect(completed).not.toHaveBeenCalled();
    expect(input.patchRecord).toHaveBeenCalledTimes(1);
    expect(input.patchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        'beds.R1.upcChecklist': input.action.fields.upcChecklist,
        'beds.R1.isUPC': true,
        'bedTypeOverrides.R1': 'UCI',
      }),
      { consistency: 'remote_confirmed', requireAtomicCas: true }
    );
    finish();
    await pending;
    expect(completed).toHaveBeenCalledWith(true);
  });
  it('propagates remote failure as false, never auditing success', async () => {
    const input = setup();
    input.patchRecord.mockRejectedValue(new Error('offline'));
    expect(await executeBedManagementAction(input)).toBe(false);
    expect(input.bedAudit.auditPatientChange).not.toHaveBeenCalled();
  });
  it('does not submit to a different day or bed after navigation', async () => {
    const input = setup();
    input.currentRecord.date = '2026-09-05';
    expect(await executeBedManagementAction(input)).toBe(false);
    expect(input.patchRecord).not.toHaveBeenCalled();
    input.currentRecord.date = '2026-09-04';
    input.action.bedId = 'R2';
    expect(await executeBedManagementAction(input)).toBe(false);
    expect(input.patchRecord).not.toHaveBeenCalled();
  });
  it('respects the existing historical-day edit guard', async () => {
    const input = setup();
    expect(
      await executeBedManagementAction({ ...input, ensureStaleDayEditAllowed: async () => false })
    ).toBe(false);
    expect(input.patchRecord).not.toHaveBeenCalled();
  });
  it('keeps a crib evaluation on the crib, with a confirmed write and no parent UPC override', async () => {
    const input = setup();
    input.currentRecord.beds.R1.clinicalCrib = DataFactory.createMockPatient('R1', {
      bedMode: 'Cuna',
    });
    const result = await executeBedManagementAction({
      ...input,
      action: { type: 'UPDATE_CLINICAL_CRIB_MULTIPLE', bedId: 'R1', fields: input.action.fields },
    });
    expect(result).toBe(true);
    expect(input.patchRecord).toHaveBeenCalledWith(
      {
        'beds.R1.clinicalCrib.upcChecklist': input.action.fields.upcChecklist,
        'beds.R1.clinicalCrib.isUPC': true,
      },
      { consistency: 'remote_confirmed', requireAtomicCas: true }
    );
  });
});
