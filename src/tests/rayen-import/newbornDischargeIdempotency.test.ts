import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  type ApplyContext,
  type CensusImportDiff,
} from '@/features/rayen-import';
import { getStatisticalDischarges } from '@/application/census/movementTombstonePolicy';
import { resolveUndoPatientMovement } from '@/features/census/controllers/patientMovementUndoController';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const NOW = new Date(2026, 6, 8, 15, 30, 0);

const makeCtx = (): ApplyContext => {
  let n = 0;
  return {
    idFactory: () => `id-${++n}`,
    now: NOW,
    actor: 'Enfermera Rayen',
    syncRunId: 'sync-run-1',
  };
};

const makeRecord = (beds: Record<string, PatientData>): DailyRecord => ({
  date: '2026-07-08',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const makeDiff = (over: Partial<CensusImportDiff> = {}): CensusImportDiff => ({
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
  ...over,
});

describe('newborn discharge idempotency', () => {
  it.each(['222222222', '111111111'])(
    'records a reported newborn departure only once alongside the maternal discharge (RN RUN %s)',
    newbornRun => {
      const crib = {
        ...EMPTY_PATIENT,
        bedId: 'H6C1',
        bedMode: 'Cuna' as const,
        patientName: 'RN sintético',
        rut: newbornRun,
        clinicalEpisodeId: 'synthetic-newborn',
        admissionDate: '2026-07-07',
        admissionTime: '10:00',
        pathology: 'Diagnóstico sintético RN',
      };
      const mother = {
        ...EMPTY_PATIENT,
        bedId: 'H6C1',
        patientName: 'Madre sintética',
        rut: '111111111',
        clinicalEpisodeId: 'synthetic-mother',
        admissionDate: '2026-07-07',
        clinicalCrib: crib,
      };
      const current = makeRecord({ H6C1: mother });
      const original = structuredClone(current);
      const diff = makeDiff({
        discharges: [
          {
            bedId: 'H6C1',
            rut: mother.rut,
            patientName: mother.patientName,
            kind: 'alta',
            status: 'Vivo',
            reason: 'administrative-discharge',
            encounterId: mother.clinicalEpisodeId,
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
            fechaEgreso: '08-07-2026 13:21',
            correctedDay: current.date,
            correctedTime: '11:21',
          },
        ],
      });
      const result = applyCensusImportDiff(current, diff, makeCtx());
      expect(result.record.discharges).toHaveLength(2);
      const newbornRows = result.record.discharges.filter(
        row => row.clinicalEpisodeId === crib.clinicalEpisodeId
      );
      expect(newbornRows).toHaveLength(1);
      expect(newbornRows[0]).toMatchObject({
        isNested: true,
        time: '11:21',
        bedId: 'H6C1',
        admissionDate: crib.admissionDate,
        diagnosis: 'Diagnóstico oficial RN',
        originalData: { clinicalEpisodeId: crib.clinicalEpisodeId, pathology: crib.pathology },
      });
      expect(
        applyCensusImportDiff(
          current,
          { ...diff, reportEgresos: [...diff.reportEgresos!, ...diff.reportEgresos!] },
          makeCtx()
        ).record.discharges
      ).toEqual(result.record.discharges);
      const blankReportDiagnosis = applyCensusImportDiff(
        current,
        { ...diff, reportEgresos: diff.reportEgresos!.map(row => ({ ...row, diagnostico: '  ' })) },
        makeCtx()
      );
      expect(
        blankReportDiagnosis.record.discharges.find(
          row => row.clinicalEpisodeId === crib.clinicalEpisodeId
        )?.diagnosis
      ).toBe(crib.pathology);
      const alreadyRecordedNewborn = { ...newbornRows[0], id: 'persisted-newborn' };
      const concurrentlyUpdated = applyCensusImportDiff(
        { ...current, discharges: [alreadyRecordedNewborn] },
        diff,
        makeCtx()
      );
      expect(concurrentlyUpdated.record.discharges).toHaveLength(2);
      expect(
        concurrentlyUpdated.record.discharges.filter(
          row => row.clinicalEpisodeId === crib.clinicalEpisodeId
        )
      ).toEqual([alreadyRecordedNewborn]);
      expect(
        concurrentlyUpdated.record.discharges.find(
          row => row.clinicalEpisodeId === mother.clinicalEpisodeId
        )?.originalData?.clinicalCrib
      ).toBeUndefined();
      expect(getStatisticalDischarges(result.record.discharges)).toHaveLength(1);
      expect(
        result.record.discharges.find(row => row.clinicalEpisodeId === mother.clinicalEpisodeId)
          ?.originalData?.clinicalCrib
      ).toBeUndefined();
      expect(result.record.beds.H6C1).toBeUndefined();
      expect(current).toEqual(original);
      const motherRow = result.record.discharges.find(
        row => row.clinicalEpisodeId === mother.clinicalEpisodeId
      )!;
      const restoredMother = resolveUndoPatientMovement({
        bedData: createEmptyPatient('H6C1'),
        bedId: 'H6C1',
        originalData: motherRow.originalData,
        createEmptyPatient,
      });
      expect(restoredMother.ok).toBe(true);
      if (restoredMother.ok) {
        const restoredCrib = resolveUndoPatientMovement({
          bedData: restoredMother.value.updatedBed,
          bedId: 'H6C1',
          isNested: true,
          originalData: newbornRows[0].originalData,
          createEmptyPatient,
        });
        expect(restoredCrib.ok).toBe(true);
        if (restoredCrib.ok)
          expect(restoredCrib.value.updatedBed.clinicalCrib?.clinicalEpisodeId).toBe(
            crib.clinicalEpisodeId
          );
      }
      expect(applyCensusImportDiff(result.record, diff, makeCtx()).record.discharges).toEqual(
        result.record.discharges
      );
    }
  );
});
