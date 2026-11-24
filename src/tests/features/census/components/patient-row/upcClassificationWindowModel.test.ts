// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildUpcRoundEvaluation,
  createUpcRowDraft,
  hasUpcDraftChanges,
  upcDraftStillMatches,
  buildUpcClassificationRows,
  sanitizeUpcCriteriaDraft,
  UPC_CLASSIFIABLE_BED_IDS,
} from '@/features/census/components/patient-row/upcClassificationWindowModel';

import { resolveUpcEpisodeIdentity } from '@/domain/upc/upcRoundSubject';

const DATE = '2026-09-15';

describe('upcClassificationWindowModel', () => {
  it('lists only occupied classifiable beds, in census order', () => {
    const rows = buildUpcClassificationRows(
      {
        R1: { patientName: 'Paciente R1', rut: '1-9', isUPC: true },
      },
      DATE
    );

    expect(rows.map(row => row.bedId)).toEqual(['R1']);
    expect(
      rows.map(row => row.bedId).every(bedId => UPC_CLASSIFIABLE_BED_IDS.includes(bedId as never))
    ).toBe(true);
    expect(rows[0]).toMatchObject({
      bedId: 'R1',
      hasPatient: true,
      patientName: 'Paciente R1',
      pendingReason: 'Evaluación UPC pendiente',
      uciAllowed: true,
    });
  });

  it('skips empty beds and keeps Neo 1-2 without UCI criteria once occupied', () => {
    const rows = buildUpcClassificationRows(
      {
        R1: { patientName: '' },
        R2: { patientName: '   ' },
        NEO1: { patientName: 'Recién nacido' },
      },
      DATE
    );

    expect(rows.map(row => row.bedId)).toEqual(['NEO1']);
    expect(rows[0]).toMatchObject({ uciAllowed: false, hasPatient: true });
  });

  it('lists an occupied clinical crib as its own row of the same bed', () => {
    const rows = buildUpcClassificationRows(
      { R1: { patientName: 'Madre', clinicalCrib: { patientName: 'Recién nacido' } } },
      DATE
    );

    expect(rows.map(row => row.key)).toEqual(['R1', 'R1:crib']);
    expect(rows[1]).toMatchObject({
      bedId: 'R1',
      isCrib: true,
      bedName: 'R1 · cuna clínica',
      patientName: 'Recién nacido',
    });
  });

  it('distinguishes an episode, a legacy readmission and an occupant without a document', () => {
    const first = { patientName: 'Paciente A', clinicalEpisodeId: ' episode-1 ', rut: '1-9' };
    expect(resolveUpcEpisodeIdentity(first)).toBe('episode-1');
    const legacy = { ...first, clinicalEpisodeId: 'legacy_ep_1', admissionDate: '2026-09-03' };
    expect(resolveUpcEpisodeIdentity(legacy)).not.toBe(
      resolveUpcEpisodeIdentity({ ...legacy, admissionDate: DATE })
    );
    expect(resolveUpcEpisodeIdentity({ patientName: 'Paciente A' })).not.toBe(
      resolveUpcEpisodeIdentity({ patientName: 'Paciente B' })
    );
    expect(resolveUpcEpisodeIdentity({ patientName: ' ' })).toBeNull();
  });

  it('sanitizes legacy criteria and never hydrates UCI criteria for Neo', () => {
    expect(
      sanitizeUpcCriteriaDraft(
        { uciAllowed: true },
        {
          uci: ['uci_inotropicos', 'uci_obsoleto', 'uci_vasoactivos'],
          uti: ['uti_mon_cardiaca', 'uti_obsoleto'],
        }
      )
    ).toEqual({ uci: ['uci_vasoactivos'], uti: ['uti_mon_cardiaca'] });
    expect(
      sanitizeUpcCriteriaDraft(
        { uciAllowed: false },
        { uci: ['uci_vmi'], uti: ['uti_mon_respiratoria'] }
      )
    ).toEqual({ uci: [], uti: ['uti_mon_respiratoria'] });
  });

  it('builds signed criteria and no-criteria drafts for the selected row identities', () => {
    const rows = buildUpcClassificationRows(
      {
        R1: { patientName: 'Paciente R1', rut: '1-9' },
        NEO1: { patientName: 'Paciente Neo', clinicalEpisodeId: 'neo-episode' },
      },
      DATE
    );

    const actor = { uid: 'uid-1', displayName: 'Enfermera A' };
    const at = '2026-09-15T12:00:00.000Z';
    const first = buildUpcRoundEvaluation(
      { ...createUpcRowDraft(rows[0]), noCriteria: true },
      actor,
      DATE,
      at
    );
    const second = buildUpcRoundEvaluation(
      { ...createUpcRowDraft(rows[1]), uti: ['uti_mon_respiratoria'] },
      actor,
      DATE,
      at
    );
    expect(first.record).toMatchObject({
      classification: null,
      evaluatedForDate: DATE,
      evaluatedBy: actor,
    });
    expect(second).toMatchObject({
      episodeIdentity: 'neo-episode',
      record: { classification: 'UPC_UTI', uciCriteria: [] },
    });
    expect(first.record.evaluationId).not.toBe(second.record.evaluationId);
  });
  it('keeps a stable draft through a retry and recognizes another signed evaluation', () => {
    const subject = { patientName: 'Paciente sintético', clinicalEpisodeId: 'ep_round' };
    const [row] = buildUpcClassificationRows({ R1: subject }, DATE);
    const draft = createUpcRowDraft(row);
    expect(hasUpcDraftChanges(draft)).toBe(false);
    expect(hasUpcDraftChanges({ ...draft, noCriteria: true })).toBe(true);
    expect(hasUpcDraftChanges({ ...draft, uci: ['uci_vmi'] })).toBe(true);
    expect(hasUpcDraftChanges({ ...draft, uti: ['uti_mon_respiratoria'] })).toBe(true);
    const pending = buildUpcRoundEvaluation(
      draft,
      { uid: 'test', displayName: 'Profesional' },
      DATE,
      '2026-09-15T12:00:00Z'
    );
    expect(upcDraftStillMatches(draft, subject)).toBe(true);
    expect(upcDraftStillMatches(draft, { ...subject, upcChecklist: pending.record }, pending)).toBe(
      true
    );
    expect(
      upcDraftStillMatches(
        draft,
        { ...subject, upcChecklist: { ...pending.record, evaluationId: 'other' } },
        pending
      )
    ).toBe(false);
    expect(upcDraftStillMatches(draft, undefined, pending)).toBe(false);
  });

  it('reports the day status of an occupied bed', () => {
    const rows = buildUpcClassificationRows({ R2: { patientName: 'Paciente R2' } }, DATE);

    expect(rows.find(row => row.bedId === 'R2')?.pendingReason).toBe('Evaluación UPC pendiente');
  });

  it('clears the pending state once the day was signed', () => {
    const rows = buildUpcClassificationRows(
      {
        R3: {
          patientName: 'Paciente R3',
          upcChecklist: {
            uciCriteria: [],
            utiCriteria: [],
            classification: null,
            evaluatedAt: '2026-09-15T12:00:00.000Z',
            evaluatedBy: { uid: 'uid-1', displayName: 'Enfermera' },
            evaluatedForDate: DATE,
            evaluatedBedId: 'R3',
            responsibleNurse: { name: 'Enfermera', source: 'assigned' },
          },
        },
      },
      DATE
    );

    const row = rows.find(candidate => candidate.bedId === 'R3');
    expect(row?.pendingReason).toBeNull();
    expect(row?.classification).toBeNull();
  });
});
