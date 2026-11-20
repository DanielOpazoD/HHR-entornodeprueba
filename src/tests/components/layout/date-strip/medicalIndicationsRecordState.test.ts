import { describe, expect, it } from 'vitest';
import {
  CLOSED_RECORD,
  buildMedicalIndicationsRecordId,
  reduceMedicalIndicationsRecord as reduce,
  type MedicalIndicationsRecordState,
} from '@/components/layout/date-strip/medicalIndicationsRecordState';
import type {
  MedicalIndicationRecord,
  MedicalIndicationsPatientOption,
} from '@/shared/contracts/medicalIndications';

const patientA: MedicalIndicationsPatientOption = {
  bedId: 'R1',
  label: 'R1',
  patientName: 'Paciente A',
  rut: '12.345.678-5',
  diagnosis: 'Prueba',
  age: '41',
  birthDate: '1985-01-01',
  allergies: '',
  admissionDate: '2026-11-18',
  clinicalEpisodeId: 'ep_a',
  daysOfStay: '2',
  treatingDoctor: 'Equipo A',
};
const patientB = { ...patientA, patientName: 'Paciente B', clinicalEpisodeId: 'ep_b' };
const DAY = '2026-11-19';
const idA = buildMedicalIndicationsRecordId(patientA, DAY);
const idB = buildMedicalIndicationsRecordId(patientB, DAY);
const savedA = {
  treatingDoctor: 'Tratante A',
  indications: ['Orden A'],
} as MedicalIndicationRecord;
const template = { id: 'tpl', text: 'Plantilla' };

const select = (state: MedicalIndicationsRecordState, patient = patientA, targetDate = DAY) =>
  reduce(state, { type: 'select', selection: { patient, targetDate } });
const readyA = () =>
  reduce(select(CLOSED_RECORD), { type: 'loaded', id: idA, saved: null, patient: patientA });

describe('medical indications record state', () => {
  it('is identified by episode and day, not by the census snapshot of the patient', () => {
    expect(buildMedicalIndicationsRecordId({ ...patientA, diagnosis: 'Otro' }, DAY)).toBe(idA);
    expect(idB).not.toBe(idA);
    expect(buildMedicalIndicationsRecordId(patientA, '2026-11-20')).not.toBe(idA);
  });

  it('starts a blank record with the census treating doctor, or the saved one', () => {
    const blank = readyA();
    expect(blank.status === 'ready' && blank.draft.treatingDoctor).toBe('Equipo A');
    const saved = reduce(select(CLOSED_RECORD), {
      type: 'loaded',
      id: idA,
      saved: savedA,
      patient: patientA,
    });
    expect(saved.status === 'ready' && saved.draft.treatingDoctor).toBe('Tratante A');
  });

  it('keeps the same state when the same patient and day are selected again', () => {
    const ready = readyA();
    expect(select(ready, { ...patientA, diagnosis: 'Actualizado' })).toBe(ready);
  });

  it('ignores every answer asked for another record', () => {
    const loadingB = select(readyA(), patientB);
    expect(reduce(loadingB, { type: 'loaded', id: idA, saved: savedA, patient: patientA })).toBe(
      loadingB
    );
    expect(reduce(loadingB, { type: 'loadFailed', id: idA, message: 'x' })).toBe(loadingB);
    expect(reduce(loadingB, { type: 'templateAudited', id: idA, template })).toBe(loadingB);
    const readyB = reduce(loadingB, { type: 'loaded', id: idB, saved: null, patient: patientB });
    expect(reduce(readyB, { type: 'templateAudited', id: idA, template })).toBe(readyB);
  });

  it('offers nothing to edit while loading or after a failed read', () => {
    const failed = reduce(select(CLOSED_RECORD), { type: 'loadFailed', id: idA, message: 'x' });
    expect(failed).toEqual({ status: 'failed', id: idA, message: 'x' });
    expect(reduce(failed, { type: 'templateAudited', id: idA, template })).toBe(failed);
    expect(reduce(failed, { type: 'edit', id: idA, update: draft => draft })).toBe(failed);
  });

  it('a second read of the record being edited never overwrites the draft', () => {
    const edited = reduce(readyA(), {
      type: 'edit',
      id: idA,
      update: draft => ({ ...draft, treatingDoctor: 'Escrito' }),
    });
    const reread = reduce(edited, { type: 'loaded', id: idA, saved: savedA, patient: patientA });
    expect(reread.status === 'ready' && reread.draft.treatingDoctor).toBe('Escrito');
    expect(reread.status === 'ready' && reread.saved).toBe(savedA);
  });

  it('closing forgets the record so reopening reads it again', () => {
    const closed = reduce(readyA(), { type: 'select', selection: null });
    expect(closed).toBe(CLOSED_RECORD);
    expect(select(closed).status).toBe('loading');
  });
});
