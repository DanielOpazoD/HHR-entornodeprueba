import { describe, expect, it, vi } from 'vitest';
import { createClinicalCudyrCoordinator } from '@/features/rayen-import/domain/clinicalCudyrCoordinator';
import {
  resolveHistoricalCudyrPatch,
  resolveHistoricalCudyrBatchOperation,
} from '@/features/rayen-import/domain/historicalCudyrPatch';
import { collectDailyCudyrRecoveryEpisodes } from '@/features/rayen-import/hooks/dailyCudyrRecoveryReader';
import { assertDocumentaryCudyrTarget } from '@/domain/evaluationScales/documentaryCudyr';
import { recoverDailyCudyrGap } from '@/services/cudyr/dailyCudyrRecoveryPlan';
import { DailyRecordSchema } from '@/schemas/zodSchemas';
import {
  historicalDay,
  currentDay,
  documentary,
  patient,
  parsedSource,
} from './dailyCudyrRecovery.fixtures';

const official = {
  category: 'D1',
  recordedDate: '2026-10-26',
  source: 'Eloísa · Gestión de Camas',
};

describe('accepted documentary CUDYR authority', () => {
  it('preserves the accepted result against a later ordinary live capture without counting an administrative override', async () => {
    const onAdministrativeOverridePreserved = vi.fn();
    const subject = { ...patient(), evaluationScores: { cudyr: documentary() } };
    const coordinator = createClinicalCudyrCoordinator({
      censusDate: '2026-10-26',
      clinicalEpisodeIds: [subject.clinicalEpisodeId],
      source: {
        historyAvailable: true,
        map: new Map([
          [
            subject.clinicalEpisodeId,
            {
              encId: subject.clinicalEpisodeId,
              source: 'gestion_camas',
              crdValue: 'D1',
              crdDateTime: '2026-10-27T03:00:00-05:00',
            },
          ],
        ]),
      },
      enqueueWrite: operation => operation(),
      onPersistenceEvidence: vi.fn(),
      onRetries: vi.fn(),
      onHistoricalPatch: vi.fn(),
      onAdministrativeOverridePreserved,
      onError: vi.fn(),
    });
    const result = await coordinator.apply(subject, subject.clinicalEpisodeId, 'R1');
    expect(result.patient.evaluationScores?.cudyr).toEqual(documentary());
    expect(onAdministrativeOverridePreserved).not.toHaveBeenCalled();
  });
  it('does not propose a historical replacement for a documentary result', () => {
    const record = historicalDay();
    record.beds.R1.evaluationScores = { cudyr: documentary() };
    expect(resolveHistoricalCudyrPatch(record, patient().clinicalEpisodeId, official)).toEqual({
      matched: true,
      patch: null,
    });
    expect(
      resolveHistoricalCudyrBatchOperation(record, patient().clinicalEpisodeId, official)
    ).toEqual({ matched: true, operation: null });
  });
  it('accepts equivalent document formatting and full-name token order without changing the proof', () => {
    const record = historicalDay();
    record.beds.R1.rut = '11111111-1';
    record.beds.R1.patientName = 'Sintetico Paciente';
    expect(() => assertDocumentaryCudyrTarget(record, record.beds.R1, documentary())).not.toThrow();
  });
  it.each(['documentType', 'neonatalMaternalRut'])(
    'retains the %s marker from a sparse movement after schema readback',
    marker => {
      const record = historicalDay();
      const movement = {
        ...currentDay().discharges[0],
        originalData: undefined,
        ...(marker === 'documentType'
          ? { documentType: 'Pasaporte' }
          : { neonatalMaternalRut: patient().rut }),
      };
      const reread = DailyRecordSchema.parse({ ...record, discharges: [movement] });
      const gap = {
        date: record.date,
        sourceDate: '2026-10-27',
        clinicalEpisodeId: patient().clinicalEpisodeId,
        patient: reread.beds.R1,
      };
      expect(recoverDailyCudyrGap(gap, [reread], parsedSource())).toBeNull();
      expect(() => assertDocumentaryCudyrTarget(reread, reread.beds.R1, documentary())).toThrow(
        /evidencia/
      );
    }
  );
  it('isolates a conflict on a new occupant from the discharged episode and blocks a conflict on that episode', () => {
    const record = currentDay();
    record.beds = { R1: { ...patient(), clinicalEpisodeId: 'new-occupant' } };
    const input = {
      acceptedRecord: record,
      currentRecord: record,
      pendingEpisodeIds: [patient().clinicalEpisodeId],
    };
    expect(
      collectDailyCudyrRecoveryEpisodes({
        ...input,
        conflicts: [
          { bedId: 'R1', clinicalEpisodeId: 'new-occupant', reason: 'synthetic conflict' },
        ],
      })
    ).toEqual([patient().clinicalEpisodeId]);
    expect(
      collectDailyCudyrRecoveryEpisodes({
        ...input,
        conflicts: [
          {
            bedId: 'R1',
            clinicalEpisodeId: patient().clinicalEpisodeId,
            reason: 'synthetic conflict',
          },
        ],
      })
    ).toEqual([]);
  });
});
