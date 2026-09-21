import { describe, expect, it } from 'vitest';
import {
  buildUpcDraftRecords,
  buildUpcClassificationRows,
  countPendingUpcClassifications,
  isClassifiableUpcBedId,
  resolveUpcEpisodeIdentity,
  resolveUpcQuickEvaluationAvailability,
  sanitizeUpcCriteriaDraft,
  UPC_CLASSIFIABLE_BED_IDS,
} from '@/features/census/components/patient-row/upcClassificationWindowModel';

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

  it('prefers the clinical episode over RUT and bed for the occupant identity', () => {
    expect(
      resolveUpcEpisodeIdentity(
        { patientName: 'Paciente', clinicalEpisodeId: ' episode-1 ', rut: '1-9' },
        'R1'
      )
    ).toBe('episode-1');
    expect(resolveUpcEpisodeIdentity({ patientName: 'Paciente', rut: '1-9' }, 'R1')).toBe('1-9');
    expect(resolveUpcEpisodeIdentity({ patientName: 'Paciente' }, 'R1')).toBe('R1');
    expect(resolveUpcEpisodeIdentity({ patientName: ' ' }, 'R1')).toBeNull();
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

    const records = buildUpcDraftRecords({
      rows,
      checklistOf: () => undefined,
      criteriaOf: row =>
        row.bedId === 'R1'
          ? { uci: ['uci_vmi'], uti: [] }
          : { uci: ['uci_vmi'], uti: ['uti_mon_respiratoria'] },
      noCriteriaSelection: { R1: true },
      actor: { uid: 'uid-1', displayName: 'Enfermera A' },
      date: DATE,
      nurseName: 'Enfermera A',
      nurseFromShift: true,
      episodeIdentityOf: row => row.episodeIdentity,
      evaluationIdFactory: () => 'evaluation-id',
      now: () => '2026-09-15T12:00:00.000Z',
    });

    expect(records.R1).toMatchObject({
      episodeIdentity: '1-9',
      record: {
        evaluationId: 'evaluation-id',
        classification: null,
        evaluatedForDate: DATE,
      },
    });
    expect(records.NEO1).toMatchObject({
      episodeIdentity: 'neo-episode',
      record: {
        classification: 'UPC_UTI',
        uciCriteria: [],
        utiCriteria: ['uti_mon_respiratoria'],
      },
    });
  });

  it('recognizes only beds supported by the UPC protocol', () => {
    expect(isClassifiableUpcBedId('R4')).toBe(true);
    expect(isClassifiableUpcBedId('NEO2')).toBe(true);
    expect(isClassifiableUpcBedId('H1C1')).toBe(false);
    expect(isClassifiableUpcBedId()).toBe(false);
  });

  it('does not count empty beds as pending and reports the day status', () => {
    const rows = buildUpcClassificationRows({ R2: { patientName: 'Paciente R2' } }, DATE);

    expect(countPendingUpcClassifications(rows)).toBe(1);
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
    expect(countPendingUpcClassifications(rows)).toBe(0);
  });
});

describe('resolveUpcQuickEvaluationAvailability', () => {
  const base = {
    hasPatient: true,
    readOnly: false,
    hasActor: true,
    nurseName: 'Enfermera A',
    assignedNurses: ['Enfermera A', 'Enfermero B'],
  };

  it('allows the quick mark with a responsible from the shift', () => {
    expect(resolveUpcQuickEvaluationAvailability(base)).toEqual({ allowed: true, reason: null });
  });

  it('blocks the quick mark without a responsible or with one outside the shift', () => {
    expect(resolveUpcQuickEvaluationAvailability({ ...base, nurseName: '' }).allowed).toBe(false);
    expect(
      resolveUpcQuickEvaluationAvailability({ ...base, nurseName: 'Otra Persona' }).reason
    ).toBe('El responsable debe ser uno de los asignados al turno.');
  });

  it('blocks read-only viewers, sessions without user and empty beds', () => {
    expect(resolveUpcQuickEvaluationAvailability({ ...base, readOnly: true }).allowed).toBe(false);
    expect(resolveUpcQuickEvaluationAvailability({ ...base, hasActor: false }).allowed).toBe(false);
    expect(resolveUpcQuickEvaluationAvailability({ ...base, hasPatient: false }).reason).toBe(
      'Cama sin paciente.'
    );
  });
});
