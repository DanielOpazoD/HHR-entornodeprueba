import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { resolveCudyrOwningCensusDay } from '@/domain/evaluationScales/importedCudyr';

const require = createRequire(import.meta.url);
const {
  parseArchiveRequest,
  parseHistoryQuery,
  evaluationKey,
  observationKey,
  owningCensusDate,
} = require('../../../functions/lib/cudyrHistoryContract.js');
const { episodeContext } = require('../../../functions/lib/cudyrHistoryContext.js');
const evaluation = {
  clinicalEpisodeId: 'synthetic-episode',
  sourceEvaluationId: 'synthetic-event',
  source: 'gestion_camas',
  recordedAt: '2026-10-06T03:53:00-05:00',
  category: 'C2',
  authorId: 'synthetic-author',
  author: 'Profesional de prueba',
  items: [],
};
const payload = {
  schemaVersion: 1,
  authorityDate: '2026-10-06',
  runId: 'run-test',
  evaluations: [evaluation],
};

describe('permanent CUDYR source contract', () => {
  it('identifies observations by source content independently of capture run, keeps revisions grouped', () => {
    const original = parseArchiveRequest(payload).evaluations[0];
    const replay = parseArchiveRequest({ ...payload, runId: 'later-run' }).evaluations[0];
    expect(observationKey('hospital', original)).toBe(observationKey('hospital', replay));
    const changed = { ...original, category: 'C3' };
    expect(evaluationKey('hospital', changed)).toBe(evaluationKey('hospital', original));
    expect(observationKey('hospital', changed)).not.toBe(observationKey('hospital', original));
    expect(evaluationKey('other-hospital', original)).not.toBe(evaluationKey('hospital', original));
  });

  it('normalizes item order without losing source identity, time offset, author or opaque version', () => {
    const items = [
      { fieldId: '2', value: '0' },
      { fieldId: '1', value: '3', typeId: 1 },
    ];
    const a = parseArchiveRequest({
      ...payload,
      evaluations: [{ ...evaluation, items, sourceVersion: '00AB' }],
    });
    const b = parseArchiveRequest({
      ...payload,
      evaluations: [{ ...evaluation, items: [...items].reverse(), sourceVersion: '00AB' }],
    });
    expect(a).toEqual(b);
    expect(a.evaluations[0]).toMatchObject({
      recordedAt: evaluation.recordedAt,
      authorId: 'synthetic-author',
      sourceVersion: '00AB',
    });
  });

  it.each([
    { evaluations: [{ ...evaluation, sourceEvaluationId: '' }] },
    { evaluations: [{ ...evaluation, recordedAt: '2026-10-06T03:53:00' }] },
    { evaluations: [{ ...evaluation, recordedAt: '2026-02-30T03:53:00-05:00' }] },
    { evaluations: [{ ...evaluation, riskScore: 25 }] },
    { evaluations: [{ ...evaluation, source: 'ficha_medico' }] },
    { evaluations: [{ ...evaluation, category: 'S/C' }] },
    { evaluations: [evaluation, evaluation] },
    {
      evaluations: Array.from({ length: 33 }, (_, i) => ({
        ...evaluation,
        sourceEvaluationId: String(i),
      })),
    },
    { hospitalId: 'other' },
    { authorityDate: '2026-02-30' },
  ])('rejects an unsupported or ambiguous request %j', change => {
    expect(() => parseArchiveRequest({ ...payload, ...change })).toThrow();
  });

  it.each([
    '2026-10-06T00:00:00-05:00',
    '2026-10-06T00:01:00-05:00',
    '2026-10-06T11:59:59-05:00',
    '2026-10-06T12:00:00-05:00',
    '2026-04-05T02:30:00Z',
    '2026-09-06T04:30:00Z',
  ])('matches established census attribution at %s', instant => {
    expect(owningCensusDate(instant)).toBe(resolveCudyrOwningCensusDay(instant));
  });

  it('bounds period reads and validates pagination', () => {
    expect(parseHistoryQuery({ from: '2026-10-01', to: '2026-10-31' })).toMatchObject({
      limit: 100,
    });
    for (const change of [
      { to: '2026-12-01' },
      { limit: 101 },
      { from: '2026-11-01' },
      { cursor: { date: '2026-09-30', id: 'a'.repeat(64) } },
    ]) {
      expect(() =>
        parseHistoryQuery({ from: '2026-10-01', to: '2026-10-31', ...change })
      ).toThrow();
    }
  });

  it('uses authoritative episode context, including a just-discharged newborn, without matching RUT alone', () => {
    const record = {
      beds: {
        R1: {
          patientName: 'Madre prueba',
          rut: 'shared',
          clinicalEpisodeId: 'mother',
          clinicalCrib: { clinicalEpisodeId: 'newborn', patientName: 'RN prueba', rut: 'shared' },
        },
      },
      discharges: [
        { clinicalEpisodeId: 'discharged', patientName: 'Egresado prueba', bedId: 'R2' },
      ],
    };
    expect(episodeContext(record, 'newborn')).toEqual([
      expect.objectContaining({ section: 'crib', patientName: 'RN prueba' }),
    ]);
    expect(episodeContext(record, 'discharged')[0]).toMatchObject({ section: 'discharges' });
    expect(() => episodeContext(record, 'shared')).toThrow(/absent/);
    expect(() =>
      episodeContext(
        { discharges: [{ ...record.discharges[0], deletedAt: 'removed' }] },
        'discharged'
      )
    ).toThrow();
  });

  it('retains movement identity from its snapshot but never borrows another episode snapshot', () => {
    const originalData = {
      clinicalEpisodeId: 'episode',
      patientName: 'Paciente prueba',
      firstName: 'Paciente',
      rut: 'synthetic-document',
      pathology: 'Diagnóstico prueba',
      bedName: 'R2',
      bedId: 'R2',
    };
    expect(episodeContext({ discharges: [{ originalData }] }, 'episode')[0]).toMatchObject({
      patientName: 'Paciente prueba',
      rut: 'synthetic-document',
      pathology: 'Diagnóstico prueba',
      bedName: 'R2',
      bedId: 'R2',
    });
    const context = episodeContext(
      {
        discharges: [
          {
            clinicalEpisodeId: 'different',
            originalData,
            patientName: 'Paciente distinto',
            rut: 'different-document',
          },
        ],
      },
      'different'
    )[0];
    expect(context).toMatchObject({ patientName: 'Paciente distinto', rut: 'different-document' });
    expect(context).not.toHaveProperty('firstName');
    expect(context).not.toHaveProperty('pathology');
  });
});

describe('CUDYR captured discharge context', () => {
  it('does not publish the containing census date as a missing effective movement date', () => {
    const result = episodeContext(
      {
        date: '2026-10-06',
        transfers: [
          {
            id: 'movement-test',
            clinicalEpisodeId: 'episode-test',
            bedId: 'R1',
            movementProvenance: { source: 'manual', classifiedAt: '2026-10-06T15:00:00Z' },
          },
        ],
      },
      'episode-test'
    )[0];
    expect(result).not.toHaveProperty('movementDate');
    expect(result.movementRecordedAt).toBe('2026-10-06T15:00:00Z');
  });
  it('keeps the system movement, classification time and epicrisis as separate evidence', () => {
    const result = episodeContext(
      {
        date: '2026-10-06',
        discharges: [
          {
            id: 'movement-test',
            clinicalEpisodeId: 'episode-test',
            bedId: 'H2C2',
            movementDate: '2026-10-05',
            time: '11:30',
            isNested: true,
            movementProvenance: {
              source: 'gestion_camas',
              classifiedAt: '2026-10-06T15:00:00Z',
              syncRunId: 'source-run',
              lineageId: 'lineage-test',
            },
            originalData: {
              clinicalEpisodeId: 'episode-test',
              admissionDate: '2026-10-01',
              dischargeVerification: {
                encounterId: 'episode-test',
                medicalEpicrisis: 'confirmed',
                nursingEpicrisis: 'not-detected',
                registeredAt: '2026-10-04T10:00:00-05:00',
              },
            },
          },
        ],
      },
      'episode-test'
    )[0];
    expect(result).toMatchObject({
      movementDate: '2026-10-05',
      movementTime: '11:30',
      movementRecordedAt: '2026-10-06T15:00:00Z',
      movementSource: 'gestion_camas',
      bedMode: 'Cuna',
      epicrisisRegisteredAt: '2026-10-04T10:00:00-05:00',
    });
    expect(result).not.toHaveProperty('actualDischargeDate');
  });
  it('does not attach epicrisis from a different episode', () => {
    expect(
      episodeContext(
        {
          beds: {
            R1: {
              clinicalEpisodeId: 'new-episode',
              dischargeVerification: { encounterId: 'old-episode', medicalEpicrisis: 'confirmed' },
            },
          },
        },
        'new-episode'
      )[0]
    ).not.toHaveProperty('medicalEpicrisisStatus');
  });
});
