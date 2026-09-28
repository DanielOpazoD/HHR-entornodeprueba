import { describe, expect, it } from 'vitest';
import {
  captureFor,
  emptyRecordFor,
  syntheticEncounter,
  vitalSignsForm,
} from './deterministicClinicalReplay.fixtures';
import { replay } from './deterministicClinicalReplay.harness';

const officialCudyr = (episode: string, at: string) => ({
  items: [
    {
      encId: episode,
      crdValue: 'C2',
      crdDateTime: at,
      history: [
        { id: 'synthetic-cudyr', category: 'C2', recordedAt: at, author: 'Profesional sintético' },
      ],
    },
  ],
  source: 'gestion_camas' as const,
  historyAvailable: true,
});

describe('CUDYR through the persisted clinical replay', () => {
  it.each([
    ['2026-08-15', '2026-08-16T01:00:00-06:00', '2026-08-16T01:05:00-06:00'],
    ['2026-09-27', '2026-09-28T01:00:00-05:00', '2026-09-28T01:05:00-05:00'],
  ])(
    'keeps a post-midnight CUDYR on census %s and reaches a fixed point on repetition',
    async (day, at, now) => {
      const patient = syntheticEncounter('admission');
      const capture = captureFor(day, [patient]);
      const evidence = {
        formsByEpisode: { [patient.encounterId]: [vitalSignsForm(day, 1001)] },
        cudyrResponse: officialCudyr(patient.encounterId, at),
      };
      const first = await replay(emptyRecordFor(day), capture, evidence, new Date(now));
      expect(first.terminalEvent.status).toBe('complete');
      expect(first.record.beds.H1C1.evaluationScores?.cudyr).toMatchObject({
        category: 'C2',
        recordedDate: day,
        recordedAt: at,
        source: 'Eloísa · Gestión de Camas',
      });
      expect(first.record.beds.H1C1.evaluationScores?.cudyr?.history).toHaveLength(1);
      const repeated = await replay(first.record, capture, evidence, new Date(now));
      expect(repeated.terminalEvent.status).toBe('complete');
      expect(repeated.clinical.patched).toBe(0);
      expect(repeated.record.beds.H1C1.evaluationScores).toEqual(
        first.record.beds.H1C1.evaluationScores
      );
      expect(repeated.record.beds.H1C1.vitalSignsHistory).toHaveLength(1);
    }
  );

  it('completes missing CUDYR after a source failure without duplicating independently saved vitals', async () => {
    const day = '2026-09-27';
    const now = new Date('2026-09-28T01:05:00-05:00');
    const patient = syntheticEncounter('admission');
    const capture = captureFor(day, [patient]);
    const formsByEpisode = { [patient.encounterId]: [vitalSignsForm(day, 1001)] };
    const partial = await replay(
      emptyRecordFor(day),
      capture,
      {
        formsByEpisode,
        cudyrResponse: { items: [], error: 'Fuente CUDYR no disponible' },
      },
      now
    );
    expect(partial.terminalEvent.status).toBe('partial');
    expect(partial.record.beds.H1C1.evaluationScores?.cudyr).toBeUndefined();
    expect(partial.record.beds.H1C1.vitalSigns).toMatchObject({ heartRate: 76, spo2: 98 });
    const recovered = await replay(
      partial.record,
      capture,
      {
        formsByEpisode,
        cudyrResponse: officialCudyr(patient.encounterId, '2026-09-28T01:00:00-05:00'),
      },
      now
    );
    expect(recovered.terminalEvent.status).toBe('complete');
    expect(recovered.recovery).toBeNull();
    expect(recovered.record.beds.H1C1.evaluationScores?.cudyr).toMatchObject({
      category: 'C2',
      recordedDate: day,
    });
    expect(recovered.record.beds.H1C1.evaluationScores?.cudyr?.history).toHaveLength(1);
    expect(recovered.record.beds.H1C1.vitalSignsHistory).toHaveLength(1);
  });

  it('preserves existing CUDYR on unavailable source and removes it only with official empty evidence', async () => {
    const day = '2026-09-27';
    const now = new Date('2026-09-28T01:05:00-05:00');
    const patient = syntheticEncounter('admission');
    const capture = captureFor(day, [patient]);
    const formsByEpisode = { [patient.encounterId]: [vitalSignsForm(day, 1001)] };
    const first = await replay(
      emptyRecordFor(day),
      capture,
      {
        formsByEpisode,
        cudyrResponse: officialCudyr(patient.encounterId, '2026-09-28T01:00:00-05:00'),
      },
      now
    );
    const failed = await replay(
      first.record,
      capture,
      {
        formsByEpisode,
        cudyrResponse: { items: [], error: 'Fuente sintética temporalmente indisponible' },
      },
      now
    );
    expect(failed.terminalEvent.status).toBe('partial');
    expect(failed.recovery).not.toBeNull();
    expect(failed.record.beds.H1C1.evaluationScores?.cudyr).toEqual(
      first.record.beds.H1C1.evaluationScores?.cudyr
    );
    expect(failed.record.beds.H1C1.vitalSignsHistory).toHaveLength(1);
    const recovered = await replay(
      failed.record,
      capture,
      {
        formsByEpisode,
        cudyrResponse: { items: [], source: 'gestion_camas', historyAvailable: true },
      },
      now
    );
    expect(recovered.terminalEvent.status).toBe('complete');
    expect(recovered.recovery).toBeNull();
    expect(recovered.record.beds.H1C1.evaluationScores?.cudyr).toBeUndefined();
    expect(recovered.record.beds.H1C1.vitalSignsHistory).toHaveLength(1);
  });
});
