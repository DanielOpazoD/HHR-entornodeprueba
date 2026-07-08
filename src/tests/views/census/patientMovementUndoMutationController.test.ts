import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  resolveApplyUndoDischargeRecord,
  resolveApplyUndoTransferRecord,
} from '@/features/census/controllers/patientMovementUndoMutationController';

describe('patientMovementUndoMutationController', () => {
  it('applies undo for discharge by restoring bed and tombstoning discharge entry', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01', {
      discharges: [
        DataFactory.createMockDischarge({ id: 'd-1', bedId: 'R1' }),
        DataFactory.createMockDischarge({ id: 'd-2', bedId: 'R2' }),
      ],
    });

    const updated = resolveApplyUndoDischargeRecord({
      record,
      dischargeId: 'd-1',
      bedId: 'R1',
      updatedBed: DataFactory.createMockPatient('R1', { patientName: 'Paciente Restaurado' }),
    });

    expect(updated.beds.R1.patientName).toBe('Paciente Restaurado');
    expect(updated.discharges.map(d => d.id)).toEqual(['d-1', 'd-2']);
    expect(updated.discharges[0]).toMatchObject({
      id: 'd-1',
      deletedAt: expect.any(String),
      deletedReason: 'manual_delete',
    });
  });

  it('tombstones stale destination entries for the restored patient when undoing discharge', () => {
    const restoredPatient = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Restaurado',
      rut: '11.111.111-1',
    });
    const record = DataFactory.createMockDailyRecord('2025-01-01', {
      discharges: [
        DataFactory.createMockDischarge({
          id: 'd-1',
          bedId: 'R1',
          patientName: restoredPatient.patientName,
          rut: restoredPatient.rut,
        }),
      ],
      transfers: [
        DataFactory.createMockTransfer({
          id: 't-stale',
          bedId: 'R1',
          patientName: restoredPatient.patientName,
          rut: restoredPatient.rut,
        }),
      ],
      cma: [
        DataFactory.createMockCMA({
          id: 'cma-stale',
          originalBedId: 'R1',
          patientName: restoredPatient.patientName,
          rut: restoredPatient.rut,
        }),
      ],
    });

    const updated = resolveApplyUndoDischargeRecord({
      record,
      dischargeId: 'd-1',
      bedId: 'R1',
      updatedBed: restoredPatient,
    });

    expect(updated.discharges[0]).toMatchObject({ id: 'd-1', deletedAt: expect.any(String) });
    expect(updated.transfers[0]).toMatchObject({ id: 't-stale', deletedAt: expect.any(String) });
    expect(updated.cma[0]).toMatchObject({ id: 'cma-stale', deletedAt: expect.any(String) });
  });

  it('does not tombstone same-rut movements from a different clinical episode during undo cleanup', () => {
    const restoredPatient = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Reingresado',
      rut: '11.111.111-1',
      clinicalEpisodeId: 'ep-current',
    });
    const record = DataFactory.createMockDailyRecord('2025-01-01', {
      discharges: [
        DataFactory.createMockDischarge({
          id: 'd-current',
          bedId: 'R1',
          patientName: restoredPatient.patientName,
          rut: restoredPatient.rut,
          clinicalEpisodeId: 'ep-current',
        }),
      ],
      transfers: [
        DataFactory.createMockTransfer({
          id: 't-other-episode',
          bedId: 'R1',
          patientName: restoredPatient.patientName,
          rut: restoredPatient.rut,
          clinicalEpisodeId: 'ep-previous',
        }),
      ],
    });

    const updated = resolveApplyUndoDischargeRecord({
      record,
      dischargeId: 'd-current',
      bedId: 'R1',
      updatedBed: restoredPatient,
    });

    expect(updated.discharges[0]).toMatchObject({ id: 'd-current', deletedAt: expect.any(String) });
    expect(updated.transfers[0].id).toBe('t-other-episode');
    expect(updated.transfers[0].deletedAt).toBeUndefined();
  });

  it('applies undo for transfer by restoring bed and tombstoning transfer entry', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01', {
      transfers: [
        DataFactory.createMockTransfer({ id: 't-1', bedId: 'R1' }),
        DataFactory.createMockTransfer({ id: 't-2', bedId: 'R2' }),
      ],
    });

    const updated = resolveApplyUndoTransferRecord({
      record,
      transferId: 't-2',
      bedId: 'R2',
      updatedBed: DataFactory.createMockPatient('R2', { patientName: 'Transfer Restaurado' }),
    });

    expect(updated.beds.R2.patientName).toBe('Transfer Restaurado');
    expect(updated.transfers.map(t => t.id)).toEqual(['t-1', 't-2']);
    expect(updated.transfers[1]).toMatchObject({
      id: 't-2',
      deletedAt: expect.any(String),
      deletedReason: 'manual_delete',
    });
  });

  it('tombstones stale destination entries for the restored patient when undoing transfer', () => {
    const restoredPatient = DataFactory.createMockPatient('R2', {
      patientName: 'Transfer Restaurado',
      rut: '22.222.222-2',
    });
    const record = DataFactory.createMockDailyRecord('2025-01-01', {
      discharges: [
        DataFactory.createMockDischarge({
          id: 'd-stale',
          bedId: 'R2',
          patientName: restoredPatient.patientName,
          rut: restoredPatient.rut,
        }),
      ],
      transfers: [
        DataFactory.createMockTransfer({
          id: 't-1',
          bedId: 'R2',
          patientName: restoredPatient.patientName,
          rut: restoredPatient.rut,
        }),
      ],
      cma: [
        DataFactory.createMockCMA({
          id: 'cma-stale',
          originalBedId: 'R2',
          patientName: restoredPatient.patientName,
          rut: restoredPatient.rut,
        }),
      ],
    });

    const updated = resolveApplyUndoTransferRecord({
      record,
      transferId: 't-1',
      bedId: 'R2',
      updatedBed: restoredPatient,
    });

    expect(updated.discharges[0]).toMatchObject({ id: 'd-stale', deletedAt: expect.any(String) });
    expect(updated.transfers[0]).toMatchObject({ id: 't-1', deletedAt: expect.any(String) });
    expect(updated.cma[0]).toMatchObject({ id: 'cma-stale', deletedAt: expect.any(String) });
  });
});
