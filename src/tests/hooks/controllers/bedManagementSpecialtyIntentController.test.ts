import { describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import { blocksUnanchoredSpecialtyEdit, isExclusiveSpecialtyIntentPatch,
  resolveManualSpecialtyIntent, preserveExplicitEmptySpecialtyChoice } from
  '@/hooks/controllers/bedManagementSpecialtyIntentController';

vi.mock('@/services/utils/featureFlags', () => ({ isFeatureEnabled: () => true }));

const record = { date: '2026-09-23', beds: { R1: {
  clinicalEpisodeId: 'episode-one', specialty: '',
  clinicalCrib: { clinicalEpisodeId: 'crib-one', specialty: '' },
} } } as unknown as DailyRecord;
const manualDecision = { schemaVersion: 3, episodeId: 'episode-one',
  decisionId: 'already-confirmed', recordDate: '2026-09-23', source: 'manual',
  actorUid: 'synthetic-user', decidedAt: '2026-09-23T10:00:00.000Z' } as const;

describe('episode-bound specialty action projection', () => {
  it('binds the mother and crib to their distinct episodes', () => {
    expect(resolveManualSpecialtyIntent({ type: 'UPDATE_PATIENT', bedId: 'R1',
      field: 'specialty', value: 'Cirugía' }, record)).toMatchObject({
      target: 'bed', episodeId: 'episode-one', value: 'Cirugía',
    });
    expect(resolveManualSpecialtyIntent({ type: 'UPDATE_CLINICAL_CRIB', bedId: 'R1',
      field: 'specialty', value: 'Pediatría' }, record)).toMatchObject({
      target: 'clinicalCrib', episodeId: 'crib-one', value: 'Pediatría',
    });
  });

  it('keeps an explicit empty manual choice as a remote write', () => {
    const intent = resolveManualSpecialtyIntent({ type: 'UPDATE_PATIENT', bedId: 'R1',
      field: 'specialty', value: '' }, record);
    expect(preserveExplicitEmptySpecialtyChoice({}, intent, record))
      .toEqual({ 'beds.R1.specialty': '' });
    const alreadyManual = { ...record, beds: { ...record.beds,
      R1: { ...record.beds.R1, specialtyAssignment: manualDecision } } };
    expect(preserveExplicitEmptySpecialtyChoice({}, intent, alreadyManual as unknown as DailyRecord))
      .toEqual({});
  });

  it('does not audit a repeated manual value, but permits confirming a legacy or rule value', () => {
    const assigned = { ...record, beds: { ...record.beds,
      R1: { ...record.beds.R1, specialty: 'Cirugía' } } } as DailyRecord;
    const action = { type: 'UPDATE_PATIENT', bedId: 'R1',
      field: 'specialty', value: 'Cirugía' } as const;
    const manual = { ...assigned, beds: { ...assigned.beds,
      R1: { ...assigned.beds.R1,
        specialtyAssignment: manualDecision } } };
    expect(resolveManualSpecialtyIntent(action, manual as DailyRecord, {})).toBeNull();

    const legacyIntent = resolveManualSpecialtyIntent(action, assigned, {});
    expect(legacyIntent).not.toBeNull();
    expect(preserveExplicitEmptySpecialtyChoice({}, legacyIntent, assigned))
      .toEqual({ 'beds.R1.specialty': 'Cirugía' });
    const rule = { ...manual, beds: { ...manual.beds,
      R1: { ...manual.beds.R1,
        specialtyAssignment: { ...manualDecision, source: 'rule', decisionId: 'rule-decision' } } } };
    expect(resolveManualSpecialtyIntent(action, rule as DailyRecord, {})).not.toBeNull();
  });

  it('does not suppress a selection from stale or malformed prior-episode provenance', () => {
    const assigned = { ...record, beds: { ...record.beds, R1: {
      ...record.beds.R1, specialty: 'Cirugía',
      specialtyAssignment: { ...manualDecision, episodeId: 'previous-episode' },
    } } } as DailyRecord;
    const action = { type: 'UPDATE_PATIENT', bedId: 'R1',
      field: 'specialty', value: 'Cirugía' } as const;
    const intent = resolveManualSpecialtyIntent(action, assigned, {});
    expect(intent).toMatchObject({ episodeId: 'episode-one', expectedDecisionId: null });
    expect(preserveExplicitEmptySpecialtyChoice({}, intent, assigned))
      .toEqual({ 'beds.R1.specialty': 'Cirugía' });

    const empty = { ...assigned, beds: { ...assigned.beds,
      R1: { ...assigned.beds.R1, specialty: '' } } } as DailyRecord;
    const emptyIntent = resolveManualSpecialtyIntent({ ...action, value: '' }, empty, {});
    expect(preserveExplicitEmptySpecialtyChoice({}, emptyIntent, empty))
      .toEqual({ 'beds.R1.specialty': '' });

    const malformed = { ...assigned, beds: { ...assigned.beds,
      R1: { ...assigned.beds.R1,
        specialtyAssignment: { ...manualDecision, decisionId: '' } } } } as DailyRecord;
    expect(resolveManualSpecialtyIntent(action, malformed, {}))
      .toMatchObject({ expectedDecisionId: null });
  });

  it('ignores a specialty repeated unchanged by a multi-field form', () => {
    const action = { type: 'UPDATE_PATIENT_MULTIPLE', bedId: 'R1',
      fields: { patientName: 'Cambio', specialty: '' } } as const;
    const patch = { 'beds.R1.patientName': 'Cambio' };
    const intent = resolveManualSpecialtyIntent(action, record, patch);
    expect(intent).toBeNull();
    expect(blocksUnanchoredSpecialtyEdit(action, patch, intent)).toBe(false);
  });

  it('keeps an explicit decision in a one-field patch', () => {
    const intent = resolveManualSpecialtyIntent({ type: 'UPDATE_PATIENT', bedId: 'R1',
      field: 'specialty', value: 'Cirugía' }, record);
    expect(intent).not.toBeNull();
    expect(isExclusiveSpecialtyIntentPatch({ 'beds.R1.specialty': 'Cirugía' }, intent!)).toBe(true);
    expect(isExclusiveSpecialtyIntentPatch({ 'beds.R1.specialty': 'Cirugía',
      'beds.R1.diagnosisComments': 'Sintético' }, intent!)).toBe(false);
  });

  it('blocks a combined identity reset and specialty before the first write', () => {
    const action = { type: 'UPDATE_PATIENT_MULTIPLE', bedId: 'R1',
      fields: { rut: '22.222.222-2', specialty: 'Cirugía' } } as const;
    const intent = resolveManualSpecialtyIntent(action, record);
    expect(blocksUnanchoredSpecialtyEdit(action, {
      'beds.R1.clinicalEpisodeId': undefined, 'beds.R1.specialty': 'Cirugía',
    }, intent)).toBe(true);
    expect(blocksUnanchoredSpecialtyEdit(action, {
      'beds.R1.specialty': 'Cirugía',
    }, intent)).toBe(false);
  });
});
