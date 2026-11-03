import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MMRADExam, MMRADSearchResult } from '@/services/radiology/mmradService';
import {
  mergeMMRADExamLists,
  openMMRADExamListMemory,
  readRememberedMMRADExams,
} from '@/components/modals/controllers/radiologyExamListMemory';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';

// Synthetic exams only.
const exam = (overrides: Partial<MMRADExam>): MMRADExam => ({
  nombre_examen: 'TC TORAX SINTETICO',
  fecha_examen: '01/11/2026',
  fecha_asignacion: '01/11/2026',
  mod: 'CT',
  estado: 'Informado',
  pdf_url: null,
  dicom_url: null,
  informe_html_url: null,
  portal_web_receipt_url: null,
  report: null,
  ...overrides,
});

const chest = exam({ informe_html_url: 'https://ris.mmrad.cl/synthetic/informe-1' });
const abdomen = exam({
  nombre_examen: 'TC ABDOMEN SINTETICO',
  informe_html_url: 'https://ris.mmrad.cl/synthetic/informe-2',
});
const report = {
  title: 'Informe sintético',
  technique: null,
  antecedentesClinicos: null,
  findings: 'Sin hallazgos agudos.',
  impression: 'Normal.',
};

const rut = '11.111.111-1';
const query = { rut, dateFrom: '', dateTo: '' };
const reply = (examenes: MMRADExam[]): MMRADSearchResult => ({ rut: '11111111-1', examenes });
// setSessionGeneration posts its signal with window.postMessage, delivered on a later task.
const deliverSessionSignals = () => new Promise(resolve => setTimeout(resolve, 0));

describe('mergeMMRADExamLists', () => {
  it('adds new exams and updates the fields a listed exam changed', () => {
    const changed = { ...chest, estado: 'Validado', report };
    const fresh = exam({
      nombre_examen: 'RX TORAX SINTETICO',
      mod: 'CR',
      pdf_url: 'https://ris.mmrad.cl/synthetic/rx.pdf',
    });

    expect(mergeMMRADExamLists([chest, abdomen], [changed, abdomen, fresh])).toEqual([
      changed,
      abdomen,
      fresh,
    ]);
  });

  it('keeps remembered exams a shorter or empty reply leaves out', () => {
    expect(mergeMMRADExamLists([chest, abdomen], [abdomen])).toEqual([abdomen, chest]);
    expect(mergeMMRADExamLists([chest, abdomen], [])).toEqual([chest, abdomen]);
  });

  it('keeps a remembered CT report when the reply could not fetch it', () => {
    const remembered = { ...chest, report };
    expect(mergeMMRADExamLists([remembered], [{ ...chest, estado: 'Validado' }])).toEqual([
      { ...chest, estado: 'Validado', report },
    ]);
  });

  it('replaces a pending exam once MMRAD publishes its report link, without duplicating it', () => {
    const pending = exam({ estado: 'Pendiente' });
    const reported = exam({ informe_html_url: 'https://ris.mmrad.cl/synthetic/informe-3' });
    const otherReported = exam({ informe_html_url: 'https://ris.mmrad.cl/synthetic/informe-4' });

    expect(mergeMMRADExamLists([pending], [reported])).toEqual([reported]);
    // A same-name, same-day exam that already had its own link is a different exam.
    expect(mergeMMRADExamLists([otherReported, pending], [reported])).toEqual([
      reported,
      otherReported,
    ]);
  });

  it('keeps same-key exams apart and pairs them one to one', () => {
    const first = exam({ estado: 'Pendiente' });
    const second = exam({ estado: 'En proceso' });
    expect(mergeMMRADExamLists([first, second], [second])).toEqual([second, first]);
  });
});

describe('session exam list memory', () => {
  let session = 0;
  const admit = (owner: string, generation = `synthetic-generation-${++session}`) => {
    localStorage.setItem(SESSION_OWNER_KEY, owner);
    setSessionGeneration(generation);
    return generation;
  };

  beforeEach(() => {
    admit('user:synthetic-A');
  });

  afterEach(() => {
    setSessionGeneration(null);
    localStorage.removeItem(SESSION_OWNER_KEY);
  });

  it('remembers one list per normalized RUT and date filters', () => {
    openMMRADExamListMemory(query).remember(reply([chest]));

    expect(readRememberedMMRADExams({ ...query, rut: '11111111-1' })?.examenes).toEqual([chest]);
    expect(readRememberedMMRADExams({ ...query, dateFrom: '2026-01-01' })).toBeUndefined();
    expect(readRememberedMMRADExams({ ...query, rut: '22.222.222-2' })).toBeUndefined();
  });

  it('merges each reply into what the session already remembers', () => {
    openMMRADExamListMemory(query).remember(reply([chest, abdomen]));
    const shown = openMMRADExamListMemory(query).remember(reply([abdomen]));

    expect(shown?.examenes).toEqual([abdomen, chest]);
    expect(readRememberedMMRADExams(query)?.examenes).toEqual([abdomen, chest]);
  });

  it('keeps the check-digit result when the exact answer arrives after it', () => {
    const memory = openMMRADExamListMemory(query);
    memory.remember({ ...reply([abdomen]), check_digit_search: 'partial' });
    const shown = memory.remember(reply([chest]));

    expect(shown?.check_digit_search).toBe('partial');
    expect(shown?.examenes).toEqual([chest, abdomen]);
  });

  it('forgets every list when the user, the session generation or the session itself changes', () => {
    openMMRADExamListMemory(query).remember(reply([chest]));
    admit('user:synthetic-B');
    expect(readRememberedMMRADExams(query)).toBeUndefined();

    openMMRADExamListMemory(query).remember(reply([chest]));
    admit('user:synthetic-B');
    expect(readRememberedMMRADExams(query)).toBeUndefined();

    openMMRADExamListMemory(query).remember(reply([chest]));
    setSessionGeneration(null);
    expect(readRememberedMMRADExams(query)).toBeUndefined();
  });

  it('forgets every list when another tab stores a different owner in this browser', () => {
    openMMRADExamListMemory(query).remember(reply([chest]));
    // Same document generation; the shared owner key alone changed.
    localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic-B');
    expect(readRememberedMMRADExams(query)).toBeUndefined();
  });

  it('forgets on the session signal even if the same owner and generation come back', async () => {
    const generation = admit('user:synthetic-A');
    await deliverSessionSignals();
    openMMRADExamListMemory(query).remember(reply([chest]));

    setSessionGeneration(null);
    admit('user:synthetic-A', generation);
    await deliverSessionSignals();

    expect(readRememberedMMRADExams(query)).toBeUndefined();
  });

  it('drops a reply in flight across a logout, even if the same session comes back', async () => {
    const generation = admit('user:synthetic-A');
    await deliverSessionSignals();
    const memory = openMMRADExamListMemory(query);

    setSessionGeneration(null);
    admit('user:synthetic-A', generation);
    await deliverSessionSignals();

    expect(memory.remember(reply([chest]))).toBeNull();
    expect(readRememberedMMRADExams(query)).toBeUndefined();
  });

  it('drops a reply whose session ended while it was in flight', () => {
    const memory = openMMRADExamListMemory(query);
    admit('user:synthetic-B');

    expect(memory.remember(reply([chest]))).toBeNull();
    expect(readRememberedMMRADExams(query)).toBeUndefined();
  });

  it('never stores a reply for another patient under this RUT', () => {
    const otherPatient = { rut: '22222222-2', examenes: [chest] };
    expect(openMMRADExamListMemory(query).remember(otherPatient)).toBe(otherPatient);
    expect(readRememberedMMRADExams(query)).toBeUndefined();
  });

  it('keeps nothing without an admitted session', () => {
    setSessionGeneration(null);
    const data = reply([chest]);
    expect(openMMRADExamListMemory(query).remember(data)).toBe(data);
    admit('user:synthetic-A');
    expect(readRememberedMMRADExams(query)).toBeUndefined();
  });
});
