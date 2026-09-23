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
      R1: { ...record.beds.R1, specialtyAssignment: { source: 'manual' } } } };
    expect(preserveExplicitEmptySpecialtyChoice({}, intent, alreadyManual as unknown as DailyRecord))
      .toEqual({});
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
