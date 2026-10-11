import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { buildUndoCmaPatch } from '@/application/census/cmaUndoPatchUseCase';
import { resolveApplyUndoCmaRecord } from '@/features/census/controllers/patientMovementUndoMutationController';
import { preparePatchedRecordPersistence } from '@/services/repositories/dailyRecordPatchPersistenceController';

const date = '2026-10-10';
const createScenario = (rut = '11.111.111-1') => {
  const restored = DataFactory.createMockPatient('R1', {
    patientName: 'Paciente Sintetico',
    rut,
    clinicalEpisodeId: 'ep-current',
    admissionDate: date,
    firstSeenDate: date,
  });
  const identity = {
    patientName: restored.patientName,
    rut,
    clinicalEpisodeId: 'ep-prior',
    admissionDate: date,
    movementDate: date,
    bedId: 'R1',
    bedName: 'R1',
  };
  const item = DataFactory.createMockCMA({
    id: 'cma-current',
    ...identity,
    clinicalEpisodeId: restored.clinicalEpisodeId,
    originalBedId: 'R1',
    originalData: restored,
  });
  const current = DataFactory.createMockDailyRecord(date, {
    beds: { R1: createEmptyPatient('R1') },
    discharges: [DataFactory.createMockDischarge(identity)],
    transfers: [DataFactory.createMockTransfer(identity)],
    cma: [
      DataFactory.createMockCMA({
        ...identity,
        id: 'cma-prior',
        originalBedId: 'R1',
        originalData: { ...restored, clinicalEpisodeId: 'ep-prior' },
      }),
      item,
    ],
  });
  return { current, item, restored };
};

describe('CMA undo episode isolation', () => {
  it.each(['11.111.111-1', ''])(
    'keeps prior discharges, transfers and CMA in both undo paths (document=%s)',
    rut => {
      const { current, item, restored } = createScenario(rut);
      const patch = buildUndoCmaPatch(current, item)!;
      const alternate = resolveApplyUndoCmaRecord({
        record: current,
        cmaId: item.id,
        bedId: 'R1',
        updatedBed: restored,
      });

      for (const result of [patch, alternate]) {
        expect(result.discharges?.[0].deletedAt).toBeUndefined();
        expect(result.transfers?.[0].deletedAt).toBeUndefined();
        expect(result.cma?.[0].deletedAt).toBeUndefined();
        expect(result.cma?.[1].deletedAt).toEqual(expect.any(String));
      }
    }
  );

  it.each(['11.111.111-1', ''])(
    'restores the current episode through persistence without retiring prior movements (document=%s)',
    rut => {
      const { current, item } = createScenario(rut);
      const { record } = preparePatchedRecordPersistence(
        current,
        date,
        buildUndoCmaPatch(current, item)!
      );

      expect(record.beds.R1.clinicalEpisodeId).toBe('ep-current');
      expect(record.beds.R1.patientName).toBe('Paciente Sintetico');
      expect(record.beds.R1.rut).toBe(rut);
      expect(record.discharges[0].deletedAt).toBeUndefined();
      expect(record.transfers[0].deletedAt).toBeUndefined();
      expect(record.cma[0].deletedAt).toBeUndefined();
      expect(record.cma[1].deletedAt).toEqual(expect.any(String));
    }
  );

  it('still retires destinations in the same episode and source bed', () => {
    const { current, item } = createScenario();
    current.transfers[0].clinicalEpisodeId = 'ep-current';
    current.discharges[0].clinicalEpisodeId = 'ep-current';
    current.discharges[0].bedId = 'R2';

    const patch = buildUndoCmaPatch(current, item)!;
    expect(patch.transfers?.[0].deletedAt).toEqual(expect.any(String));
    expect(patch.discharges?.[0].deletedAt).toBeUndefined();
  });

  it('does not restore an entry without a source snapshot', () => {
    const { current, item } = createScenario();
    expect(buildUndoCmaPatch(current, { ...item, originalData: undefined })).toBeNull();
  });
});
