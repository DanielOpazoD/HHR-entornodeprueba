import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MedicalIndicationRecord,
  MedicalIndicationsPatientOption,
} from '@/shared/contracts/medicalIndications';

// Scenarios from the three independent reviews of W20-IND2 (IND2-REVIEW, IND2-RECHECK,
// IND2-RECHECK2) plus normal use. Real use cases, a Dexie record store, the official PDF form and
// the text pdf.js reads back from the bytes handed to the print dialog. Synthetic data only.

const io = vi.hoisted(() => ({
  list: vi.fn(),
  write: vi.fn(),
  templates: vi.fn(),
  mark: vi.fn(),
  audit: vi.fn(),
  print: vi.fn(),
}));
vi.mock('@/application/ports/medicalIndicationPort', () => ({
  defaultMedicalIndicationRecordPort: {
    listByEpisodeAndTargetDate: io.list,
    createWithAuditEvent: io.write,
  },
  defaultMedicalIndicationTemplatePort: { listActiveByUser: io.templates, markUsed: io.mark },
}));
vi.mock('@/application/audit/writeAuditEventUseCaseLoader', () => ({
  loadExecuteWriteAuditEvent: async () => io.audit,
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'user_test', displayName: 'Médico Test', email: 'medico@example.test' },
    role: 'doctor_urgency',
  }),
}));
vi.mock('@/services/pdf/pdfBase', () => ({ openPdfPrintDialog: io.print }));

import { MedicalIndicationsDialog } from '@/components/layout/date-strip/MedicalIndicationsDialog';
import { buildMedicalIndicationsPatientOptions } from '@/components/layout/app-content/appContentChromeController';

const patient: MedicalIndicationsPatientOption = {
  patientName: 'Paciente Sintético',
  bedId: 'R1',
  label: 'Cama de prueba',
  rut: '12.345.678-5',
  diagnosis: 'Prueba',
  age: '41',
  birthDate: '1985-01-01',
  allergies: 'Prueba',
  admissionDate: '2026-08-13',
  daysOfStay: '2',
  treatingDoctor: 'Equipo prueba',
  sourceDailyRecordDate: '2026-08-14',
  clinicalEpisodeId: 'ep_w20_synthetic',
};
const second: MedicalIndicationsPatientOption = {
  ...patient,
  bedId: 'R2',
  label: 'Cama B',
  patientName: 'Paciente B sintético',
  rut: '11.111.111-1',
  clinicalEpisodeId: 'ep_w20_segundo',
};
const template = {
  id: 'tpl_sintetica',
  userId: 'user_test',
  text: 'Plantilla sintética',
  createdAt: '2026-08-01',
  updatedAt: '2026-08-01',
  createdByName: 'Médico Test',
  useCount: 0,
  isArchived: false,
};
const seed = (indications: string[]): MedicalIndicationRecord => ({
  id: 'version-anterior',
  patientName: patient.patientName,
  patientRut: patient.rut,
  bedId: 'R1',
  episodeId: 'ep_w20_synthetic',
  targetDate: '2026-08-14',
  admissionDate: patient.admissionDate,
  daysOfStayForTargetDate: '2',
  generatedAt: '2026-08-14T13:00:00Z',
  generatedByUserId: 'previo',
  generatedByName: 'Autor previo',
  generatedByRole: 'admin',
  treatingDoctor: 'Tratante anterior',
  reposo: 'Reposo de prueba',
  regimen: 'Régimen de prueba',
  kineType: 'ambas',
  kineTimes: '2',
  pendingNotes: 'Nota previa',
  generatedFromTemplateIds: ['tpl_previa'],
  pdfPrintedAt: null,
  indications,
});
const originalA = seed(['Orden propia de A']);
const originalB: MedicalIndicationRecord = {
  ...seed(['Orden propia de B']),
  id: 'version-B',
  bedId: second.bedId,
  episodeId: 'ep_w20_segundo',
  patientName: second.patientName,
  patientRut: second.rut,
  generatedFromTemplateIds: ['tpl_solo_B'],
};

const db = new Dexie('MedicalIndicationsDialogRecordLifecycle');
db.version(1).stores({ records: 'id,[episodeId+targetDate]' });
const records: Table<MedicalIndicationRecord, string> = db.table('records');
const formBytes = readFileSync('Formularios/indicaciones medicas y plan de enfermreia.pdf');

type User = ReturnType<typeof userEvent.setup>;
const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => `Serie ${String(index + 1).padStart(2, '0')}`);
const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name });
const lines = () => Array.from(document.querySelectorAll('div.group\\/row p'), p => p.textContent);
const newest = async () =>
  (await records.toArray()).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
const newVersionsOf = async (episodeId: string) =>
  (await newest()).filter(
    record => record.episodeId === episodeId && ![originalA.id, originalB.id].includes(record.id)
  );
const summarize = (record: MedicalIndicationRecord) => ({
  episode: record.episodeId,
  rut: record.patientRut,
  lines: record.indications,
  ids: record.generatedFromTemplateIds,
});
const dialog = (patients: MedicalIndicationsPatientOption[]) => (
  <MedicalIndicationsDialog isOpen patients={patients} onClose={() => undefined} />
);
const selectPatient = (user: User, bedId: string) =>
  user.selectOptions(screen.getByRole('combobox', { name: 'Seleccionar paciente' }), bedId);
const freeTextBox = () => screen.getByPlaceholderText('Escribe una indicación y presiona Enter…');
const physicianBox = () =>
  screen.getByText('Médico tratante', { selector: 'label' }).parentElement!.querySelector('input')!;
const censusWith = (diagnosis = patient.diagnosis) => ({
  date: patient.sourceDailyRecordDate,
  beds: { R1: { ...patient, pathology: diagnosis } },
});
const censusOptions = (census: ReturnType<typeof censusWith>) =>
  buildMedicalIndicationsPatientOptions(census as never);

/** Every page of the last printed PDF, as the text pdf.js reads from its bytes. */
const printedText = async (call = 0) => {
  const bytes = io.print.mock.calls[call]?.[0] as Uint8Array;
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      pages.push(content.items.map(item => ('str' in item ? item.str : '')).join('\n'));
    }
    return pages.join('\n');
  } finally {
    await task.destroy();
  }
};

const print = async (user: User) => {
  await user.click(button('Imprimir PDF'));
  await waitFor(() => expect(io.print).toHaveBeenCalledTimes(1));
  return printedText();
};
const save = async (user: User) => {
  await user.click(button('Guardar indicaciones'));
  await screen.findByText('Indicaciones guardadas para este paciente.');
  return (await newest())[0]!;
};

/** Clicks «Insertar» with its audit held; the returned function lets the audit finish. */
const insertWithPendingAudit = async (user: User) => {
  let release: (() => void) | undefined;
  io.audit.mockImplementationOnce(
    () => new Promise(resolve => (release = () => resolve({ status: 'success' })))
  );
  await user.click(button(/Insertar/));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  return async () => {
    await act(async () => release?.());
    expect(io.mark).toHaveBeenCalledTimes(1);
  };
};

/** Holds the answer of the next record read (taken from Dexie at once) until released. */
const holdNextRead = (expectedEpisode: string) => {
  let snapshotTaken!: () => void;
  let deliver!: () => void;
  const taken = new Promise<void>(resolve => (snapshotTaken = resolve));
  const gate = new Promise<void>(resolve => (deliver = resolve));
  const read = io.list.getMockImplementation()!;
  let answer: Promise<MedicalIndicationRecord[]> | undefined;
  io.list.mockImplementationOnce((...args: [string, string]) => {
    answer = (async () => {
      expect(args[0]).toBe(expectedEpisode);
      const result = await read(...args);
      snapshotTaken();
      await gate;
      return result;
    })();
    return answer;
  });
  return {
    taken,
    release: async () => {
      await act(async () => {
        deliver();
        await answer;
      });
    },
  };
};

const openWithA = async (patients = [patient, second]) => {
  await records.bulkAdd([originalA, originalB]);
  const user = userEvent.setup();
  const view = render(dialog(patients));
  await waitFor(() => expect(lines()).toEqual(originalA.indications));
  return { user, view };
};
const openWithPendingTemplateInA = async (patients = [patient, second]) => {
  const opened = await openWithA(patients);
  return { ...opened, finishAudit: await insertWithPendingAudit(opened.user) };
};

beforeAll(async () => {
  await db.open();
});
afterAll(async () => {
  await db.delete();
});
beforeEach(async () => {
  await records.clear();
  io.list.mockImplementation(async (episodeId: string, targetDate: string) =>
    (await records.where('[episodeId+targetDate]').equals([episodeId, targetDate]).toArray()).sort(
      (a, b) => b.generatedAt.localeCompare(a.generatedAt)
    )
  );
  io.write.mockImplementation(async (record: MedicalIndicationRecord) => {
    await records.add(record);
  });
  io.templates.mockResolvedValue([template]);
  io.mark.mockResolvedValue(undefined);
  io.audit.mockResolvedValue({ status: 'success' });
  io.print.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', async (url: string) => {
    expect(decodeURIComponent(String(url))).toContain('indicaciones medicas y plan de enfermreia');
    return new Response(new Uint8Array(formBytes), { status: 200 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  // Also drops a held read a test queued but never used.
  vi.resetAllMocks();
});

describe('medical indications dialog: editing one record', () => {
  it('normal use of a new record: add, edit, insert, save and print', async () => {
    const user = userEvent.setup();
    render(dialog([patient]));
    await user.type(
      await screen.findByPlaceholderText(/Escribe una indicación/),
      'Orden inicial{Enter}'
    );
    await user.click(button('Editar indicación #1'));
    const edit = screen.getByDisplayValue('Orden inicial');
    await user.clear(edit);
    await user.type(edit, 'Orden editada{Enter}');
    await user.click(button(/Insertar/));
    await waitFor(() => expect(lines()).toEqual(['Orden editada', template.text]));

    await save(user);
    const pdf = await print(user);

    const expected = {
      episodeId: originalA.episodeId,
      patientRut: patient.rut,
      indications: ['Orden editada', template.text],
      generatedFromTemplateIds: [template.id],
    };
    const versions = await records.toArray();
    expect(versions).toHaveLength(2);
    versions.forEach(version => expect(version).toMatchObject(expected));
    expect(pdf).toContain(patient.patientName);
    expect(pdf).toContain('1. Orden editada');
    expect(pdf).toContain(`2. ${template.text}`);
  });

  it('add, second click, edit, move and remove reach the store and the PDF', async () => {
    const user = userEvent.setup();
    render(dialog([patient]));
    const box = await screen.findByPlaceholderText(/Escribe una indicación/);
    await user.type(box, 'Texto A{Enter}');
    await user.type(box, 'Texto B');
    await user.click(button('Agregar'));
    await user.click(button('Agregar'));
    await user.type(box, 'Texto C{Enter}');
    expect(lines()).toEqual(['Texto A', 'Texto B', 'Texto C']);
    await user.type(box, 'En espera');
    await user.click(button('Editar indicación #2'));
    const edit = screen.getByDisplayValue('Texto B');
    await user.clear(edit);
    await user.type(edit, 'Texto B corregido{Enter}');
    await user.click(button('Ordenar'));
    await user.click(button('Subir indicación #3'));
    await user.click(button('Bajar indicación #1'));
    await user.click(button('Quitar indicación #2'));
    expect(box).toHaveValue('En espera');
    await user.type(box, '{Enter}');

    const expected = ['Texto C', 'Texto B corregido', 'En espera'];
    expect(lines()).toEqual(expected);
    expect((await save(user)).indications).toEqual(expected);
    const pdf = await print(user);
    const labels = expected.map((line, index) => `${index + 1}. ${line}`);
    labels.forEach(label => expect(pdf.split(label)).toHaveLength(2));
    const positions = labels.map(label => pdf.indexOf(label));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('saving an old record unchanged keeps the original and its content', async () => {
    const old = seed([...rows(12), 'Texto con  dos espacios', 'Repetida', 'Repetida']);
    await records.add(old);
    const user = userEvent.setup();
    render(dialog([patient]));
    await waitFor(() => expect(lines()).toEqual(old.indications));

    const copy = await save(user);

    const content = ({
      id: _id,
      generatedAt: _at,
      generatedByUserId: _uid,
      generatedByName: _name,
      generatedByRole: _role,
      ...rest
    }: MedicalIndicationRecord) => rest;
    expect(copy.id).not.toBe(old.id);
    expect(content(copy)).toEqual(content(old));
    expect(await records.get(old.id)).toEqual(old);
  });

  it('a template taking the last line while typing keeps the draft until a line is freed', async () => {
    const initial = rows(14);
    await records.add(seed(initial));
    const user = userEvent.setup();
    render(dialog([patient]));
    await waitFor(() => expect(lines()).toEqual(initial));
    const finishAudit = await insertWithPendingAudit(user);
    await user.type(freeTextBox(), 'Borrador a');
    await finishAudit();
    await user.type(freeTextBox(), ' continuar{Enter}');

    expect(freeTextBox()).toHaveValue('Borrador a continuar');
    expect(button('Agregar')).toBeDisabled();
    expect((await save(user)).indications).toEqual([...initial, template.text]);
    await user.click(button('Quitar indicación #1'));
    await user.click(button('Agregar'));
    expect((await save(user)).indications).toEqual([
      ...initial.slice(1),
      template.text,
      'Borrador a continuar',
    ]);
  });

  it('a template that finds the last line taken during its audit is neither added nor credited', async () => {
    const initial = rows(14);
    await records.add(seed(initial));
    const user = userEvent.setup();
    render(dialog([patient]));
    await waitFor(() => expect(lines()).toEqual(initial));
    const finishAudit = await insertWithPendingAudit(user);
    await user.type(freeTextBox(), 'Última manual{Enter}');
    await finishAudit();

    expect(screen.getByText(/No quedan espacios/)).toBeVisible();
    const record = await save(user);
    expect(record.indications).toEqual([...initial, 'Última manual']);
    expect(record.generatedFromTemplateIds).toEqual(['tpl_previa']);
  });

  it.each([
    ['one indication over three rows', true],
    ['fifteen short indications', false],
  ])('prints every saved indication: %s', async (_name, long) => {
    const all = rows(15);
    if (long) all[0] = 'Indicación extensa de prueba. '.repeat(5).trim();
    await records.add(seed(all));
    const user = userEvent.setup();
    render(dialog([patient]));
    await waitFor(() => expect(lines()).toEqual(all));

    const pdf = await print(user);

    const shortOnes = long ? all.slice(1) : all;
    const missing = shortOnes.filter(line => !pdf.includes(`${all.indexOf(line) + 1}. ${line}`));
    expect(missing).toEqual([]);
  });
});

describe('medical indications dialog: a record belongs to one patient and day', () => {
  it.each(['bed occupant change', 'patient selector'])(
    'a template asked for A never lands in B (%s)',
    async mode => {
      const b = mode === 'bed occupant change' ? { ...second, bedId: patient.bedId } : second;
      const { user, view, finishAudit } = await openWithPendingTemplateInA(
        mode === 'bed occupant change' ? [patient] : [patient, second]
      );
      if (mode === 'bed occupant change') view.rerender(dialog([b]));
      else await selectPatient(user, second.bedId);
      await waitFor(() => expect(lines()).toEqual(originalB.indications));
      await finishAudit();

      const pdf = await print(user);
      expect(summarize((await newest())[0]!)).toEqual(summarize(originalB));
      expect(pdf).toContain(second.patientName);
      expect(pdf).not.toContain(template.text);
    }
  );

  it.each(['wait for B', 'act before B arrives'])(
    'the A audit ends while B is still loading (%s)',
    async mode => {
      const { user, finishAudit } = await openWithPendingTemplateInA();
      const heldB = holdNextRead(originalB.episodeId);
      await selectPatient(user, second.bedId);
      await heldB.taken;
      await finishAudit();

      expect(screen.getAllByText(second.patientName, { selector: 'span' }).length).toBeGreaterThan(
        0
      );
      expect(lines()).toEqual([]);
      expect(button('Guardar indicaciones')).toBeDisabled();
      expect(button('Imprimir PDF')).toBeDisabled();
      if (mode === 'act before B arrives') {
        await user.click(button('Guardar indicaciones'));
        await user.click(button('Imprimir PDF'));
        expect(io.write).not.toHaveBeenCalled();
        expect(io.print).not.toHaveBeenCalled();
      }

      await heldB.release();
      await waitFor(() => expect(lines()).toEqual(originalB.indications));
      const pdf = await print(user);
      const versions = await newVersionsOf(originalB.episodeId);
      expect(versions.map(summarize)).toEqual([summarize(originalB)]);
      expect(pdf).toContain(originalB.indications[0]);
      expect(pdf).not.toContain(originalA.indications[0]);
      expect(pdf).not.toContain(template.text);
    }
  );

  it('back from B to A before the audit ends, the template lands in A and never in B', async () => {
    const { user, finishAudit } = await openWithPendingTemplateInA();
    await selectPatient(user, second.bedId);
    await waitFor(() => expect(lines()).toEqual(originalB.indications));
    await selectPatient(user, patient.bedId);
    await waitFor(() => expect(lines()).toEqual(originalA.indications));
    await finishAudit();

    const pdf = await print(user);
    expect(summarize((await newest())[0]!)).toEqual({
      ...summarize(originalA),
      lines: [...originalA.indications, template.text],
      ids: [...originalA.generatedFromTemplateIds, template.id],
    });
    expect((await records.toArray()).filter(r => r.episodeId === originalB.episodeId)).toEqual([
      originalB,
    ]);
    expect(pdf).toContain(patient.rut);
    expect(pdf).toContain(template.text);
  });

  it('changing the day drops on the new day the template asked for the previous one', async () => {
    const day = '2026-08-15';
    const order = 'Orden solo del segundo día';
    const { user, finishAudit } = await openWithPendingTemplateInA();
    await records.add({
      ...originalA,
      id: 'dia-2',
      targetDate: day,
      indications: [order],
      generatedFromTemplateIds: ['tpl_dia_2'],
    });
    fireEvent.change(screen.getByLabelText('Fecha objetivo'), { target: { value: day } });
    await waitFor(() => expect(lines()).toEqual([order]));
    await finishAudit();

    const pdf = await print(user);
    expect((await newest())[0]).toMatchObject({
      targetDate: day,
      indications: [order],
      generatedFromTemplateIds: ['tpl_dia_2'],
    });
    expect(pdf).toContain(order);
    expect(pdf).not.toContain(template.text);
  });

  it('a new admission of the same patient in the same bed starts empty', async () => {
    const readmission = {
      ...patient,
      clinicalEpisodeId: 'ep_nuevo_mismo_paciente',
      admissionTime: '19:30',
    };
    const { user, view, finishAudit } = await openWithPendingTemplateInA();
    const heldB = holdNextRead(originalB.episodeId);
    await selectPatient(user, second.bedId);
    await heldB.taken;
    view.rerender(dialog([readmission]));
    await screen.findByPlaceholderText(/Escribe una indicación/);
    expect(lines()).toEqual([]);
    await finishAudit();
    await heldB.release();
    expect(lines()).toEqual([]);

    await user.type(freeTextBox(), 'Solo reingreso{Enter}');
    await save(user);
    const pdf = await print(user);
    const writes = io.write.mock.calls.map(([record]) => record as MedicalIndicationRecord);
    expect(writes).toHaveLength(2);
    writes.forEach(record =>
      expect(record).toMatchObject({
        episodeId: readmission.clinicalEpisodeId,
        indications: ['Solo reingreso'],
        generatedFromTemplateIds: [],
      })
    );
    expect(pdf).toContain('Solo reingreso');
    expect(pdf).not.toContain(template.text);
    expect(pdf).not.toContain(originalA.indications[0]);
    expect(pdf).not.toContain(originalB.indications[0]);
  });
});

describe('medical indications dialog: census refreshes keep the work in progress', () => {
  it.each(['stable', 'identical refresh'])('the pending template stays with A (%s)', async mode => {
    const census = censusWith();
    const options = censusOptions(census);
    const { user, view, finishAudit } = await openWithPendingTemplateInA(options);
    if (mode === 'identical refresh') {
      const refreshed = censusOptions(structuredClone(census));
      expect(refreshed[0]).toEqual(options[0]);
      expect(refreshed[0]).not.toBe(options[0]);
      view.rerender(dialog(refreshed));
      await act(async () => {
        await Promise.all(io.list.mock.results.map(result => result.value));
      });
    }
    await finishAudit();

    const pdf = await print(user);
    expect(summarize((await newest())[0]!)).toEqual({
      ...summarize(originalA),
      lines: [...originalA.indications, template.text],
      ids: [...originalA.generatedFromTemplateIds, template.id],
    });
    expect(pdf).toContain(patient.rut);
    expect(pdf).toContain(template.text);
  });

  it('an identical refresh keeps the documented treating doctor', async () => {
    const census = censusWith();
    await records.add(originalA);
    const user = userEvent.setup();
    const view = render(dialog(censusOptions(census)));
    await waitFor(() => expect(physicianBox()).toHaveValue(originalA.treatingDoctor));
    view.rerender(dialog(censusOptions(structuredClone(census))));
    await act(async () => {
      await Promise.all(io.list.mock.results.map(result => result.value));
    });

    expect(physicianBox()).toHaveValue(originalA.treatingDoctor);
    await save(user);
    const pdf = await print(user);
    const versions = await newVersionsOf(originalA.episodeId);
    expect(versions.map(version => version.treatingDoctor)).toEqual([
      originalA.treatingDoctor,
      originalA.treatingDoctor,
    ]);
    expect(pdf).toContain(originalA.treatingDoctor);
  });

  it.each(['audit first', 'read first'])(
    'a diagnosis refresh of the same episode and day keeps typed lines and the template (%s)',
    async order => {
      const census = censusWith();
      const { user, view, finishAudit } = await openWithPendingTemplateInA(censusOptions(census));
      await user.type(freeTextBox(), 'Indicación escrita por el médico{Enter}');
      const readsBefore = io.list.mock.calls.length;
      const held = holdNextRead(originalA.episodeId);
      view.rerender(dialog(censusOptions(censusWith('Diagnóstico sintético actualizado'))));
      const reread = io.list.mock.calls.length > readsBefore;
      if (reread) await held.taken;
      if (order === 'audit first') await finishAudit();
      if (reread) await held.release();
      if (order === 'read first') await finishAudit();

      const expected = [
        ...originalA.indications,
        'Indicación escrita por el médico',
        template.text,
      ];
      expect(lines()).toEqual(expected);
      await save(user);
      const pdf = await print(user);
      const versions = await newVersionsOf(originalA.episodeId);
      expect(versions).toHaveLength(2);
      versions.forEach(version =>
        expect(summarize(version)).toMatchObject({
          lines: expected,
          ids: [...originalA.generatedFromTemplateIds, template.id],
        })
      );
      expect(pdf).toContain(template.text);
      expect(pdf).toContain('Indicación escrita por el médico');
      expect(pdf).toContain('Diagnóstico sintético actualizado');
    }
  );
});

describe('medical indications dialog: a failed read offers nothing to save', () => {
  const tryEverything = async (user: User) => {
    await user.click(button(/Insertar/));
    await user.click(button('Guardar indicaciones'));
    await user.click(button('Imprimir PDF'));
  };

  it.each(['patient selector', 'bed occupant change'])(
    'the read of B fails when moving from A (%s)',
    async mode => {
      const b = mode === 'patient selector' ? second : { ...second, bedId: patient.bedId };
      const { user, view, finishAudit } = await openWithPendingTemplateInA(
        mode === 'patient selector' ? [patient, b] : [patient]
      );
      io.list.mockRejectedValueOnce(new Error('Fallo sintético al leer B'));
      if (mode === 'patient selector') await selectPatient(user, b.bedId);
      else view.rerender(dialog([b]));
      await screen.findByText('Fallo sintético al leer B');
      await finishAudit();
      const auditsBefore = io.audit.mock.calls.length;

      await tryEverything(user);

      expect(lines()).toEqual([]);
      expect(button('Guardar indicaciones')).toBeDisabled();
      expect(button('Imprimir PDF')).toBeDisabled();
      expect(io.audit.mock.calls.length - auditsBefore).toBe(0);
      expect(io.write).not.toHaveBeenCalled();
      expect(io.print).not.toHaveBeenCalled();
    }
  );

  it('going back to B and failing to read it never saves its old orders', async () => {
    await records.bulkAdd([originalA, originalB]);
    const user = userEvent.setup();
    render(dialog([second, patient]));
    await waitFor(() => expect(lines()).toEqual(originalB.indications));
    const heldA = holdNextRead(originalA.episodeId);
    await selectPatient(user, patient.bedId);
    await heldA.taken;
    await records.add({
      ...originalB,
      id: 'actualizacion-B',
      generatedAt: '2026-09-01T12:00:00Z',
      indications: ['Nueva orden vigente de B'],
      generatedFromTemplateIds: ['tpl_nueva_B'],
    });
    io.list.mockRejectedValueOnce(new Error('No se pudo releer B'));
    await selectPatient(user, second.bedId);
    await screen.findByText('No se pudo releer B');
    await heldA.release();

    expect(lines()).toEqual([]);
    expect(button('Guardar indicaciones')).toBeDisabled();
    expect(button('Imprimir PDF')).toBeDisabled();
    await tryEverything(user);
    expect(io.write).not.toHaveBeenCalled();
    expect(io.print).not.toHaveBeenCalled();
    expect(io.mark).not.toHaveBeenCalled();
  });
});
