import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import { applyCensusImportDiff, type CensusImportDiff } from '@/features/rayen-import';
import {
  applyClinicalCribDischargeRepairs,
  planClinicalCribDischargeRepairs,
} from '@/features/rayen-import/domain/clinicalCribDischargeRepairs';
import {
  getActiveDischarges,
  getStatisticalDischarges,
} from '@/application/census/movementTombstonePolicy';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  getRecordForDate,
  saveRecordStrict,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { repairRecord } from '@/tests/rayen-import/clinicalCribDischargeRepairs.fixtures';
import { buildRecord } from '@/tests/services/repositories/dailyRecordRepositoryWriteServiceFixtures';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const NOW = new Date('2026-09-30T18:30:00.000Z');

// Use production preparation and Dexie's structured-clone storage, not an in-memory repository.
// Closing/reopening the connection forces the next operation to consume persisted snapshots.
const persistAndReload = async (record: DailyRecord): Promise<DailyRecord> => {
  const prepared = prepareDailyRecordForPersistence(record, record.date);
  expect(await saveRecordStrict(prepared)).toMatchObject({ ok: true, store: 'indexeddb' });
  hospitalDB.close();
  await hospitalDB.open();
  const reloaded = await getRecordForDate(record.date);
  expect(reloaded).not.toBeNull();
  expect(reloaded).not.toBe(prepared);
  return reloaded!;
};

const applyContext = () => {
  let id = 0;
  return {
    now: NOW,
    actor: 'Synthetic operator',
    syncRunId: 'synthetic-sync',
    idFactory: vi.fn(() => `movement-${++id}`),
  };
};

describe('Rayen newborn import through persistence and readback', () => {
  beforeEach(async () => {
    window.__HHR_E2E_OVERRIDE__ = undefined;
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
  });

  afterEach(async () => {
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
  });

  it.each(['111111111', '222222222'])(
    'preserves one full newborn snapshot across reload and repeated import (RUN %s)',
    async newbornRun => {
      const crib = {
        ...EMPTY_PATIENT,
        bedId: 'H6C1',
        bedMode: 'Cuna' as const,
        patientName: 'RN sintético',
        rut: newbornRun,
        clinicalEpisodeId: 'synthetic-newborn',
        admissionDate: '2026-09-28',
        admissionTime: '10:00',
        specialty: 'Pediatría' as const,
        pathology: 'Diagnóstico sintético RN',
      };
      const mother = {
        ...EMPTY_PATIENT,
        bedId: 'H6C1',
        patientName: 'Madre sintética',
        rut: '111111111',
        clinicalEpisodeId: 'synthetic-mother',
        admissionDate: '2026-09-27',
        clinicalCrib: crib,
      };
      const current = await persistAndReload({
        ...buildRecord('2026-09-30'),
        beds: { H6C1: mother },
      });
      const diff: CensusImportDiff = {
        admissions: [],
        updates: [],
        moves: [],
        conflicts: [],
        pendingAdministrativeDischarges: [],
        unchangedCount: 0,
        summary: {
          admissions: 0,
          updates: 0,
          moves: 0,
          discharges: 1,
          pendingAdministrativeDischarges: 0,
          conflicts: 0,
          unchanged: 0,
        },
        discharges: [
          {
            bedId: 'H6C1',
            rut: mother.rut,
            patientName: mother.patientName,
            encounterId: mother.clinicalEpisodeId,
            kind: 'alta',
            status: 'Vivo',
            reason: 'administrative-discharge',
            correctedDay: current.date,
            correctedTime: '11:00',
            associatedClinicalCrib: {
              clinicalEpisodeId: crib.clinicalEpisodeId,
              patientName: crib.patientName,
              rut: crib.rut,
            },
          },
        ],
        reportEgresos: [
          {
            run: crib.rut,
            patientName: crib.patientName,
            encounterId: crib.clinicalEpisodeId,
            bedLabel: 'Cuna H6C1',
            diagnostico: 'Diagnóstico oficial RN',
            kind: 'alta',
            status: 'Vivo',
            fromClinicalCrib: true,
            destino: 'Domicilio',
            fechaEgreso: '30-09-2026 13:21',
            correctedDay: current.date,
            correctedTime: '11:21',
          },
        ],
      };
      const context = applyContext();
      const imported = await persistAndReload(applyCensusImportDiff(current, diff, context).record);
      const newbornDischarge = imported.discharges.find(
        row => row.clinicalEpisodeId === crib.clinicalEpisodeId
      );
      expect(newbornDischarge).toMatchObject({
        bedId: 'H6C1',
        bedType: 'Cuna',
        patientName: crib.patientName,
        rut: crib.rut,
        clinicalEpisodeId: crib.clinicalEpisodeId,
        movementDate: current.date,
        status: 'Vivo',
        diagnosis: 'Diagnóstico oficial RN',
        dischargeType: undefined,
        isNested: true,
        time: '11:21',
        admissionDate: crib.admissionDate,
      });
      expect(newbornDischarge?.originalData).toEqual(current.beds.H6C1.clinicalCrib);
      const snapshot = structuredClone(imported.discharges);
      const createdIds = context.idFactory.mock.calls.length;
      const repeated = await persistAndReload(
        applyCensusImportDiff(imported, diff, context).record
      );

      expect(context.idFactory).toHaveBeenCalledTimes(createdIds);
      expect(repeated.discharges).toEqual(snapshot);
      expect(getActiveDischarges(repeated.discharges)).toHaveLength(2);
      expect(getStatisticalDischarges(repeated.discharges)).toHaveLength(1);
      expect(repeated.beds.H6C1?.patientName ?? '').toBe('');
      expect(
        repeated.discharges.find(row => row.clinicalEpisodeId === mother.clinicalEpisodeId)
          ?.originalData?.clinicalCrib
      ).toBeUndefined();
      expect(
        repeated.discharges.find(row => row.clinicalEpisodeId === crib.clinicalEpisodeId)
      ).toMatchObject({
        isNested: true,
        time: '11:21',
        admissionDate: crib.admissionDate,
        originalData: {
          clinicalEpisodeId: crib.clinicalEpisodeId,
          specialty: 'Pediatría',
          admissionTime: '10:00',
          pathology: crib.pathology,
        },
      });
      expect(planClinicalCribDischargeRepairs(repeated)).toEqual([]);
    }
  );

  it('repairs a normalized historical duplicate once and retains its audit tombstone after reload', async () => {
    const raw = repairRecord();
    raw.discharges[1].time = '11:20';
    const saved = await persistAndReload(raw);
    // This additional default made the old raw-fixture-only eligibility check fail.
    expect(saved.discharges[1].originalData?.bedMode).toBe('Cama');
    const repairs = planClinicalCribDischargeRepairs(saved);
    expect(repairs).toHaveLength(1);
    const kept = structuredClone(saved.discharges[0]);
    const duplicate = structuredClone(saved.discharges[1]);
    const mother = structuredClone(saved.discharges[2]);
    const repaired = applyClinicalCribDischargeRepairs(saved, repairs, NOW, 'Synthetic operator');
    expect(repaired.skipped).toEqual([]);
    const reloaded = await persistAndReload({ ...saved, discharges: repaired.discharges });
    expect(reloaded.discharges[0]).toEqual(kept);
    expect(reloaded.discharges[2]).toEqual(mother);
    expect(reloaded.discharges[1]).toEqual({
      ...duplicate,
      deletedAt: NOW.toISOString(),
      deletedBy: 'Synthetic operator',
      deletedReason: 'duplicate_clinical_crib_discharge:canonical-rn',
    });
    expect(getActiveDischarges(reloaded.discharges).filter(row => row.isNested)).toHaveLength(1);
    expect(getStatisticalDischarges(reloaded.discharges)).toHaveLength(1);
    expect(planClinicalCribDischargeRepairs(reloaded)).toEqual([]);
    const retry = applyClinicalCribDischargeRepairs(reloaded, repairs, NOW, 'Other operator');
    expect(retry.skipped).toEqual([]);
    const retried = await persistAndReload({ ...reloaded, discharges: retry.discharges });
    expect(retried.discharges).toEqual(reloaded.discharges);
  });
});
