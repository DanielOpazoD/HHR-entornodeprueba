import { describe, expect, it } from 'vitest';
import {
  CLOSED_RECORD,
  buildMedicalIndicationsRecordId,
  reduceMedicalIndicationsRecord as reduce,
  type MedicalIndicationsRecordState,
  type MedicalIndicationsRecordVisit,
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
const version = (generatedAt: string, line: string, treatingDoctor = 'Tratante A') =>
  ({ generatedAt, treatingDoctor, indications: [line] }) as MedicalIndicationRecord;
const retired = version('2026-11-19T10:00:00Z', 'Orden retirada');
const current = version('2026-11-19T11:00:00Z', 'Orden vigente');
const template = { id: 'tpl', text: 'Plantilla' };

const select = (state: MedicalIndicationsRecordState, patient = patientA, targetDate = DAY) =>
  reduce(state, { type: 'select', selection: { patient, targetDate } });
const visitOf = (state: MedicalIndicationsRecordState): MedicalIndicationsRecordVisit => {
  if (state.status === 'closed') throw new Error('no visit');
  return { id: state.id, request: state.request };
};
const load = (
  state: MedicalIndicationsRecordState,
  saved: MedicalIndicationRecord | null,
  visit = visitOf(state),
  patient = patientA
) => reduce(state, { type: 'loaded', visit, saved, patient });
const ready = (state: MedicalIndicationsRecordState) => {
  if (state.status !== 'ready') throw new Error(`expected ready, got ${state.status}`);
  return state;
};
const linesOf = (state: MedicalIndicationsRecordState) => ready(state).draft.lines.filter(Boolean);

describe('medical indications record state', () => {
  it('is identified by episode and day, not by the census snapshot of the patient', () => {
    expect(buildMedicalIndicationsRecordId({ ...patientA, diagnosis: 'Otro' }, DAY)).toBe(idA);
    expect(idB).not.toBe(idA);
    expect(buildMedicalIndicationsRecordId(patientA, '2026-11-20')).not.toBe(idA);
  });

  it('starts a blank record with the census treating doctor, or the saved one', () => {
    expect(ready(load(select(CLOSED_RECORD), null)).draft.treatingDoctor).toBe('Equipo A');
    expect(ready(load(select(CLOSED_RECORD), retired)).draft.treatingDoctor).toBe('Tratante A');
  });

  it('keeps the same state when the same patient and day are selected again', () => {
    const state = load(select(CLOSED_RECORD), null);
    expect(select(state, { ...patientA, diagnosis: 'Actualizado' })).toBe(state);
  });

  it('ignores every answer asked for another record', () => {
    const readyA = load(select(CLOSED_RECORD), null);
    const visitA = visitOf(readyA);
    const loadingB = select(readyA, patientB);
    expect(load(loadingB, retired, visitA)).toBe(loadingB);
    expect(reduce(loadingB, { type: 'loadFailed', visit: visitA, message: 'x' })).toBe(loadingB);
    expect(reduce(loadingB, { type: 'templateAudited', visit: visitA, template })).toBe(loadingB);
    const readyB = load(loadingB, null, visitOf(loadingB), patientB);
    expect(reduce(readyB, { type: 'templateAudited', visit: visitA, template })).toBe(readyB);
  });

  it('coming back to a record is a new visit: answers of the earlier visit never count', () => {
    const firstVisit = visitOf(select(CLOSED_RECORD));
    const back = select(select(select(CLOSED_RECORD), patientA, '2026-11-20'));
    expect(visitOf(back)).toEqual({ id: idA, request: firstVisit.request + 2 });

    expect(load(back, retired, firstVisit)).toBe(back);
    const failed = reduce(back, { type: 'loadFailed', visit: visitOf(back), message: 'x' });
    expect(load(failed, retired, firstVisit)).toBe(failed);
    const readyBack = load(back, current);
    expect(linesOf(readyBack)).toEqual(['Orden vigente']);
    expect(load(readyBack, retired, firstVisit)).toBe(readyBack);
    expect(reduce(readyBack, { type: 'templateAudited', visit: firstVisit, template })).toBe(
      readyBack
    );
  });

  it('keeps counting visits across closing, so a read from before closing never counts', () => {
    const before = select(CLOSED_RECORD);
    const reopened = select(reduce(before, { type: 'select', selection: null }));
    expect(visitOf(reopened).request).toBeGreaterThan(visitOf(before).request);
    expect(load(reopened, retired, visitOf(before))).toBe(reopened);
  });

  it('a newer save of the record from an earlier visit replaces an untouched draft', () => {
    const firstVisit = visitOf(select(CLOSED_RECORD));
    const back = load(select(select(select(CLOSED_RECORD), patientA, '2026-11-20')), retired);
    const draft = ready(back).draft;
    const after = reduce(back, { type: 'saved', visit: firstVisit, draft, record: current });
    expect(linesOf(after)).toEqual(['Orden vigente']);
    expect(ready(after).savedDraft).toBeNull();
    const edited = reduce(back, {
      type: 'edit',
      visit: visitOf(back),
      update: d => ({ ...d, freeText: 'escribiendo' }),
    });
    const keepsEdits = reduce(edited, { type: 'saved', visit: firstVisit, draft, record: current });
    expect(linesOf(keepsEdits)).toEqual(['Orden retirada']);
    expect(ready(keepsEdits).saved).toBe(current);
  });

  it('a save that finishes while the record is read again wins over an older read', () => {
    const firstVisit = visitOf(select(CLOSED_RECORD));
    const back = select(select(select(CLOSED_RECORD), patientA, '2026-11-20'));
    const savedMeanwhile = reduce(back, {
      type: 'saved',
      visit: firstVisit,
      draft: ready(load(select(CLOSED_RECORD), null)).draft,
      record: current,
    });
    expect(linesOf(load(savedMeanwhile, retired))).toEqual(['Orden vigente']);
  });

  it('confirms a save only when the draft on screen is the one that was saved', () => {
    const state = load(select(CLOSED_RECORD), retired);
    const visit = visitOf(state);
    const draft = ready(state).draft;
    const confirmed = ready(reduce(state, { type: 'saved', visit, draft, record: current }));
    expect(confirmed.savedDraft).toBe(confirmed.draft);
    const editedMeanwhile = reduce(state, {
      type: 'edit',
      visit,
      update: d => ({ ...d, treatingDoctor: 'Otro' }),
    });
    const notConfirmed = ready(
      reduce(editedMeanwhile, { type: 'saved', visit, draft, record: current })
    );
    expect(notConfirmed.savedDraft).toBeNull();
  });

  it('offers nothing to edit while loading or after a failed read', () => {
    const loading = select(CLOSED_RECORD);
    const visit = visitOf(loading);
    const failed = reduce(loading, { type: 'loadFailed', visit, message: 'x' });
    expect(failed).toMatchObject({ status: 'failed', id: idA, message: 'x' });
    expect(reduce(failed, { type: 'templateAudited', visit, template })).toBe(failed);
    expect(reduce(failed, { type: 'edit', visit, update: draft => draft })).toBe(failed);
  });

  it('a second answer for the same visit never overwrites the draft', () => {
    const state = load(select(CLOSED_RECORD), null);
    const edited = reduce(state, {
      type: 'edit',
      visit: visitOf(state),
      update: draft => ({ ...draft, treatingDoctor: 'Escrito' }),
    });
    const reread = ready(load(edited, retired));
    expect(reread.draft.treatingDoctor).toBe('Escrito');
    expect(reread.saved).toBe(retired);
  });
});
